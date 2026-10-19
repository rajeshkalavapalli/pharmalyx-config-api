// What the MR does and what MR / manager / head office see: stock in the MR's hands, direct supply to a
// chemist (stamped receipt photo + GPS at the chemist), payments collected, and each chemist's ledger.
// Every rupee and unit is recorded in the company's name; nothing here is ever deleted.

const crypto = require('crypto');

const sql = require('./sql');
const rules = require('./rules');
const { loadSettings } = require('./settings');
const { access, targetUser } = require('./scope');

const fileStore = require('../../utils/fileStore');
const { customQuery, runInTransaction } = require('../../utils/dbFunctions');
const { generateUUID } = require('../../utils/commonUtils');
const { auditQuery } = require('../../utils/audit');
const { distanceMeters } = require('../../utils/doctorMatching');
const { fail, isGuid, optionalText, requireActingUser, sameId } = require('../../utils/access');

const q = (name, inputs = {}) => customQuery(sql[name](), inputs);
const run = async (steps) => {
    try {
        return await runInTransaction(steps);
    } catch (error) {
        if (error.number === 50409) throw fail(409, error.message);
        throw error;
    }
};
const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const lower = (value) => String(value || '').toLowerCase();
const json = (list) => JSON.stringify(list.map((id) => String(id)));

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_ID = /^[0-9a-f-]{36}\.(jpg|png|webp)$/i;
const MAX_LINES = 30;
const MAX_QTY = 100000;
const MODES = ['CASH', 'UPI', 'CHEQUE', 'BANK'];
const photoKey = (userId, photoId) => `ledger/${lower(userId)}/${lower(photoId)}`;
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

// =========================================================
// Photos (in-app camera only; uploaded first, attached when the record is saved)
// =========================================================

exports.uploadPhoto = async (actingUserId, buffer) => {
    requireActingUser(actingUserId);
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw fail(400, 'No photo received.');
    if (buffer.length > MAX_PHOTO_BYTES) throw fail(413, 'Photo is larger than 5 MB.');
    const type = fileStore.sniffImage(buffer);
    if (!type) throw fail(400, 'Only JPEG, PNG or WebP photos are accepted.');
    const photoId = `${generateUUID()}.${type.ext}`;
    await fileStore.put(photoKey(actingUserId, photoId), buffer);
    return { photoId };
};

const loadPhoto = async (actingUserId, photoId, label) => {
    if (!PHOTO_ID.test(String(photoId || ''))) throw fail(400, `Take a photo of ${label}.`);
    const key = photoKey(actingUserId, photoId);
    const buffer = await fileStore.get(key).catch(() => null);
    if (!buffer) throw fail(400, 'The photo was not found. Take it again.');
    const type = fileStore.sniffImage(buffer);
    return { key, contentType: type?.contentType || 'image/jpeg', sha: sha256(buffer) };
};

// Live GPS at the chemist: within the chemist's radius (or saves the chemist's first location).
const atChemist = (location, pharmacy, radius) => {
    const fix = location || {};
    if (String(fix.status || '').toUpperCase() !== 'CAPTURED') throw fail(400, 'Turn on location: this is recorded at the chemist.');
    const lat = Number(fix.latitude);
    const lng = Number(fix.longitude);
    const accuracy = fix.accuracy == null ? null : Math.round(Number(fix.accuracy));
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw fail(400, 'Location is invalid.');
    if (fix.isMock === true) throw fail(400, 'Fake (mock) GPS is not allowed.');

    if (pharmacy.Latitude != null) {
        const distance = Math.round(distanceMeters(lat, lng, Number(pharmacy.Latitude), Number(pharmacy.Longitude)));
        if (distance - Math.min(accuracy || 0, 100) > radius) {
            throw fail(400, `You are about ${distance} m from ${pharmacy.PharmacyName}. Record this at the chemist (within ${radius} m).`);
        }
        return { lat, lng, accuracy, distance, pin: false };
    }
    if (accuracy == null || accuracy > 100) throw fail(400, 'GPS is too weak to save the chemist location. Wait for a better fix (under 100 m) and try again.');
    return { lat, lng, accuracy, distance: 0, pin: true };
};

const PIN_PHARMACY = `
    UPDATE dbo.Pharmacy SET Latitude = @Latitude, Longitude = @Longitude, GpsAccuracy = @Accuracy, GpsCapturedAt = @Now, GpsCapturedBy = @UserId
    WHERE PharmacyId = @PharmacyId AND Latitude IS NULL
`;

// =========================================================
// Credit status of chemists (also used to block POBs)
// =========================================================

const creditStatuses = async (pharmacyIds, settings) => {
    if (!pharmacyIds.length) return new Map();
    const Pharmacies = json(pharmacyIds);
    const [entries, limits] = await Promise.all([q('DUE_ENTRIES', { Pharmacies }), q('CREDIT_LIMITS', { Pharmacies })]);
    const limitOf = new Map(limits.map((row) => [lower(row.PharmacyId), Number(row.CreditLimit)]));
    const byChemist = new Map(pharmacyIds.map((id) => [lower(id), []]));
    entries.forEach((row) => byChemist.get(lower(row.PharmacyId))?.push(row));
    const today = todayIst();
    const result = new Map();
    byChemist.forEach((list, id) => {
        const ageing = rules.dueAgeing(list, today);
        const limit = limitOf.has(id) ? limitOf.get(id) : null;
        const check = rules.creditCheck({ balance: ageing.balance, oldestDays: ageing.oldestDays, limit, blockDays: settings.CHEMIST_DUE_BLOCK_DAYS });
        result.set(id, { ...ageing, limit, blocked: check.blocked, reasons: check.reasons, entries: list });
    });
    return result;
};

exports.creditStatuses = creditStatuses;

// For the POB booking screen: refuses a new POB for a chemist whose dues are over the limit or too old.
exports.assertChemistCanOrder = async (pharmacyId) => {
    const settings = await loadSettings();
    let status;
    try {
        status = (await creditStatuses([pharmacyId], settings)).get(lower(pharmacyId));
    } catch (error) {
        if (error.number === 208) return; // ledger tables not installed yet: nothing to check
        throw error;
    }
    if (status?.blocked) throw fail(409, `New orders for this chemist are on hold: ${status.reasons.join('; ')}. Collect the dues first.`);
};

// =========================================================
// MR stock
// =========================================================

exports.getStock = async (actingUserId, query) => {
    const scope = await access(actingUserId, 'ledger.approve');
    const userId = targetUser(scope, query.userId);
    const settings = await loadSettings();
    const today = todayIst();

    const [balances, entries, lotRows] = await Promise.all([q('STOCK_BALANCES', { UserId: userId }), q('STOCK_ENTRIES', { UserId: userId }), q('LOT_ENTRIES', { UserId: userId })]);
    const totals = rules.stockTotals(entries.filter((e) => !e.VoidedOn));

    const byBatch = new Map();
    lotRows.forEach((row) => {
        if (!byBatch.has(lower(row.BatchId))) byBatch.set(lower(row.BatchId), { row, list: [] });
        byBatch.get(lower(row.BatchId)).list.push(row);
    });
    const heldLong = [];
    byBatch.forEach(({ row, list }) => {
        rules.heldTooLong(rules.openLots(list), today, settings.MR_STOCK_HOLD_DAYS).forEach((lot) => heldLong.push({ ProductName: row.ProductName, BatchNumber: row.BatchNumber, ...lot }));
    });

    return {
        userId,
        limit: settings.MR_STOCK_LIMIT,
        holdDays: settings.MR_STOCK_HOLD_DAYS,
        totals,
        balances: balances.map((b) => ({ ...b, Quantity: Number(b.Quantity), Value: Number(b.Value) })),
        heldLong,
        entries,
        people: scope.users.length > 1 ? scope.users : [],
    };
};

// =========================================================
// Delivery options (MR): my chemists with their credit status, my stock
// =========================================================

exports.getOptions = async (actingUserId) => {
    requireActingUser(actingUserId);
    const settings = await loadSettings();
    const [chemists, balances, products] = await Promise.all([
        q('MY_CHEMISTS', { UserId: actingUserId }),
        q('STOCK_BALANCES', { UserId: actingUserId }),
        customQuery('SELECT ProductId, UnitPrice FROM dbo.Products'),
    ]);
    const status = await creditStatuses(chemists.map((c) => c.PharmacyId), settings);
    const price = new Map(products.map((p) => [lower(p.ProductId), Number(p.UnitPrice) || 0]));
    return {
        chemistRadius: settings.CHEMIST_RADIUS_METERS,
        chemists: chemists.map((c) => {
            const s = status.get(lower(c.PharmacyId));
            return { PharmacyId: c.PharmacyId, PharmacyName: c.PharmacyName, balance: s.balance, limit: s.limit, oldestDays: s.oldestDays, blocked: s.blocked, reasons: s.reasons };
        }),
        stock: balances.filter((b) => Number(b.Quantity) > 0).map((b) => ({ ...b, Quantity: Number(b.Quantity), Value: Number(b.Value), UnitPrice: price.get(lower(b.ProductId)) || 0 })),
    };
};

// =========================================================
// Direct supply to a chemist (MR)
// =========================================================

exports.createDelivery = async (actingUserId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(payload.PharmacyId)) throw fail(400, 'Choose the chemist.');

    const chemists = await q('MY_CHEMISTS', { UserId: actingUserId });
    const pharmacy = chemists.find((c) => sameId(c.PharmacyId, payload.PharmacyId));
    if (!pharmacy) throw fail(400, 'This chemist is not assigned to you.');

    const settings = await loadSettings();
    const photo = await loadPhoto(actingUserId, payload.ReceiptPhotoId, "the chemist's stamped receipt");
    const reused = (await q('RECEIPT_REUSED', { Sha: photo.sha }))[0];
    if (reused) throw fail(409, `This receipt photo was already used for ${reused.DeliveryNumber}. Take a photo of this delivery's receipt.`);
    const gps = atChemist(payload.Location, pharmacy, settings.CHEMIST_RADIUS_METERS);

    // Lines: batch and quantity from the MR's own stock; price always from the catalogue (no MR pricing).
    const raw = Array.isArray(payload.Lines) ? payload.Lines : [];
    if (!raw.length) throw fail(400, 'Add at least one product.');
    if (raw.length > MAX_LINES) throw fail(400, `At most ${MAX_LINES} lines per delivery.`);
    const [balances, products] = await Promise.all([q('STOCK_BALANCES', { UserId: actingUserId }), customQuery('SELECT ProductId, UnitPrice FROM dbo.Products')]);
    const price = new Map(products.map((p) => [lower(p.ProductId), Number(p.UnitPrice) || 0]));
    const seen = new Set();
    const deliveryId = generateUUID();
    const lines = raw.map((line, index) => {
        const label = `Line ${index + 1}`;
        const batch = isGuid(line?.BatchId) ? balances.find((b) => sameId(b.BatchId, line.BatchId)) : null;
        if (!batch || Number(batch.Quantity) <= 0) throw fail(400, `${label}: choose a batch you hold.`);
        if (seen.has(lower(batch.BatchId))) throw fail(400, `${label}: batch ${batch.BatchNumber} is already in this delivery.`);
        seen.add(lower(batch.BatchId));
        const quantity = Number(line.Quantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) throw fail(400, `${label}: quantity must be a whole number from 1.`);
        if (quantity > Number(batch.Quantity)) throw fail(400, `${label}: you hold only ${batch.Quantity} of batch ${batch.BatchNumber}.`);
        const unitPrice = price.get(lower(batch.ProductId)) || 0;
        if (unitPrice <= 0) throw fail(400, `${label}: ${batch.ProductName} has no catalogue price. Ask head office.`);
        return {
            batch,
            quantity,
            unitPrice,
            value: rules.toRupees(rules.toPaise(unitPrice) * quantity),
            stockValue: rules.outflowValue(Number(batch.Quantity), Number(batch.Value), quantity),
        };
    });
    const total = rules.toRupees(lines.reduce((sum, l) => sum + rules.toPaise(l.value), 0));

    // Credit rule: no delivery when dues are over the limit or too old.
    const status = (await creditStatuses([pharmacy.PharmacyId], settings)).get(lower(pharmacy.PharmacyId));
    const check = rules.creditCheck({ balance: status.balance, oldestDays: status.oldestDays, limit: status.limit, addAmount: total, blockDays: settings.CHEMIST_DUE_BLOCK_DAYS });
    if (check.blocked) throw fail(409, `Delivery not allowed: ${check.reasons.join('; ')}.`);

    const now = new Date();
    const today = todayIst();
    const steps = [
        {
            sqlQuery: sql.INSERT_DELIVERY(),
            inputs: {
                DeliveryId: deliveryId,
                UserId: actingUserId,
                PharmacyId: pharmacy.PharmacyId,
                DeliveryDate: today,
                TotalValue: total,
                ReceiptStorageKey: photo.key,
                ReceiptContentType: photo.contentType,
                ReceiptSha256: photo.sha,
                Latitude: Number(gps.lat.toFixed(6)),
                Longitude: Number(gps.lng.toFixed(6)),
                Accuracy: gps.accuracy,
                DistanceFromChemistM: gps.distance,
                Remarks: optionalText(payload.Remarks, 300, 'Remarks'),
                Now: now,
            },
        },
    ];
    lines.forEach((l) => {
        steps.push({
            sqlQuery: sql.INSERT_DELIVERY_LINE(),
            inputs: { LineId: generateUUID(), DeliveryId: deliveryId, ProductId: l.batch.ProductId, BatchId: l.batch.BatchId, Quantity: l.quantity, UnitPrice: l.unitPrice, Value: l.value },
        });
        steps.push({
            sqlQuery: sql.INSERT_OUTFLOW(),
            inputs: {
                EntryId: generateUUID(),
                UserId: actingUserId,
                ProductId: l.batch.ProductId,
                BatchId: l.batch.BatchId,
                BatchNumber: l.batch.BatchNumber,
                EntryType: 'DELIVERY',
                Quantity: l.quantity,
                UnitValue: rules.toRupees(Math.round(rules.toPaise(l.stockValue) / l.quantity)),
                Value: l.stockValue,
                EntryDate: today,
                DeliveryId: deliveryId,
                ClearanceId: null,
                Remarks: null,
                ActorId: actingUserId,
                Now: now,
            },
        });
    });
    steps.push({
        sqlQuery: sql.INSERT_LEDGER(),
        inputs: {
            EntryId: generateUUID(),
            PharmacyId: pharmacy.PharmacyId,
            EntryType: 'DELIVERY',
            Amount: total,
            EntryDate: today,
            UserId: actingUserId,
            DeliveryId: deliveryId,
            PaymentMode: null,
            PaymentRef: null,
            ReceiptStorageKey: null,
            ReceiptContentType: null,
            Latitude: null,
            Longitude: null,
            DepositStatus: null,
            Remarks: null,
            ActorId: actingUserId,
            Now: now,
        },
    });
    if (gps.pin) {
        steps.push({ sqlQuery: PIN_PHARMACY, inputs: { PharmacyId: pharmacy.PharmacyId, Latitude: Number(gps.lat.toFixed(6)), Longitude: Number(gps.lng.toFixed(6)), Accuracy: gps.accuracy, Now: now, UserId: actingUserId } });
        steps.push(auditQuery({ entityType: 'PHARMACY', entityId: pharmacy.PharmacyId, action: 'PIN_LOCATION', actorId: actingUserId, after: { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy, source: 'first delivery' } }));
    }
    steps.push(
        auditQuery({
            entityType: 'CHEMIST_DELIVERY',
            entityId: deliveryId,
            action: 'CREATE',
            actorId: actingUserId,
            after: { pharmacyId: pharmacy.PharmacyId, total, lines: lines.map((l) => ({ batchId: l.batch.BatchId, quantity: l.quantity, unitPrice: l.unitPrice })), distance: gps.distance },
        })
    );

    await run(steps);
    return { message: `Delivery of Rs ${total.toLocaleString('en-IN')} to ${pharmacy.PharmacyName} recorded. It is added to the chemist's dues.`, DeliveryId: deliveryId };
};

// =========================================================
// Payment collected from a chemist (MR)
// =========================================================

exports.createPayment = async (actingUserId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(payload.PharmacyId)) throw fail(400, 'Choose the chemist.');
    const chemists = await q('MY_CHEMISTS', { UserId: actingUserId });
    const pharmacy = chemists.find((c) => sameId(c.PharmacyId, payload.PharmacyId));
    if (!pharmacy) throw fail(400, 'This chemist is not assigned to you.');

    const amount = Number(payload.Amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) throw fail(400, 'Enter the amount collected.');
    const rupees = rules.toRupees(rules.toPaise(amount));
    const mode = String(payload.Mode || '').toUpperCase();
    if (!MODES.includes(mode)) throw fail(400, 'Choose how the chemist paid: cash, UPI, cheque or bank transfer.');
    const reference = optionalText(payload.Reference, 100, 'Reference');
    if (mode !== 'CASH' && !reference) throw fail(400, 'Enter the UPI / cheque / bank reference number.');

    const settings = await loadSettings();
    const status = (await creditStatuses([pharmacy.PharmacyId], settings)).get(lower(pharmacy.PharmacyId));
    if (rules.toPaise(rupees) > rules.toPaise(status.balance)) throw fail(400, `The chemist owes Rs ${status.balance.toLocaleString('en-IN')}; the payment cannot be more than that.`);

    // Cash: photo of the receipt given to the chemist is required (in-app camera).
    const photo = mode === 'CASH' || payload.ReceiptPhotoId ? await loadPhoto(actingUserId, payload.ReceiptPhotoId, 'the payment receipt') : null;
    const fix = payload.Location || {};
    const hasFix = String(fix.status || '').toUpperCase() === 'CAPTURED' && Number.isFinite(Number(fix.latitude)) && Number.isFinite(Number(fix.longitude));

    const entryId = generateUUID();
    const now = new Date();
    await run([
        {
            sqlQuery: sql.INSERT_LEDGER(),
            inputs: {
                EntryId: entryId,
                PharmacyId: pharmacy.PharmacyId,
                EntryType: 'PAYMENT',
                Amount: -rupees,
                EntryDate: todayIst(),
                UserId: actingUserId,
                DeliveryId: null,
                PaymentMode: mode,
                PaymentRef: reference,
                ReceiptStorageKey: photo?.key || null,
                ReceiptContentType: photo?.contentType || null,
                Latitude: hasFix ? Number(Number(fix.latitude).toFixed(6)) : null,
                Longitude: hasFix ? Number(Number(fix.longitude).toFixed(6)) : null,
                DepositStatus: 'WITH_MR',
                Remarks: optionalText(payload.Remarks, 300, 'Remarks'),
                ActorId: actingUserId,
                Now: now,
            },
        },
        auditQuery({ entityType: 'CHEMIST_PAYMENT', entityId: entryId, action: 'CREATE', actorId: actingUserId, after: { pharmacyId: pharmacy.PharmacyId, amount: rupees, mode, reference } }),
    ]);
    return { message: `Payment of Rs ${rupees.toLocaleString('en-IN')} from ${pharmacy.PharmacyName} recorded. Head office confirms it when the money reaches the company.`, EntryId: entryId };
};

// =========================================================
// Chemist dues (list) and one chemist's ledger
// =========================================================

const visibleChemists = async (scope) => {
    if (scope.viewAll) return q('ALL_LEDGER_CHEMISTS');
    return q('CHEMISTS_OF_USERS', { Users: json(scope.userIds) });
};

exports.listChemists = async (actingUserId, query) => {
    const scope = await access(actingUserId, 'ledger.approve');
    const settings = await loadSettings();
    let chemists = await visibleChemists(scope);
    if (query.userId) {
        const userId = targetUser(scope, query.userId);
        chemists = await q('CHEMISTS_OF_USERS', { Users: json([userId]) });
    }
    const status = await creditStatuses(chemists.map((c) => c.PharmacyId), settings);
    const owners = new Map((await q('CHEMIST_OWNERS')).map((row) => [lower(row.PharmacyId), row.Owners]));
    const rows = chemists
        .map((c) => {
            const s = status.get(lower(c.PharmacyId));
            return {
                PharmacyId: c.PharmacyId,
                PharmacyName: c.PharmacyName,
                Owners: owners.get(lower(c.PharmacyId)) || 'Head office',
                balance: s.balance,
                buckets: s.buckets,
                oldestDays: s.oldestDays,
                limit: s.limit,
                blocked: s.blocked,
                reasons: s.reasons,
                hasLedger: s.entries.length > 0,
            };
        })
        .filter((row) => !scope.viewAll || row.hasLedger || row.limit != null || query.all === '1')
        .sort((a, b) => b.balance - a.balance || a.PharmacyName.localeCompare(b.PharmacyName));

    const totals = rows.reduce(
        (t, r) => {
            t.balance += rules.toPaise(r.balance);
            Object.keys(t.buckets).forEach((k) => (t.buckets[k] += rules.toPaise(r.buckets[k])));
            if (r.blocked) t.blocked++;
            return t;
        },
        { balance: 0, buckets: { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 }, blocked: 0 }
    );
    return {
        blockDays: settings.CHEMIST_DUE_BLOCK_DAYS,
        headOffice: scope.headOffice,
        totals: { balance: rules.toRupees(totals.balance), buckets: Object.fromEntries(Object.entries(totals.buckets).map(([k, v]) => [k, rules.toRupees(v)])), blocked: totals.blocked },
        chemists: rows,
    };
};

const canSeeChemist = async (scope, pharmacyId) => {
    if (scope.viewAll) return true;
    const mine = await q('CHEMISTS_OF_USERS', { Users: json(scope.userIds) });
    if (mine.some((c) => sameId(c.PharmacyId, pharmacyId))) return true;
    const delivered = await q('LIST_DELIVERIES', { UserId: null, PharmacyId: pharmacyId });
    return delivered.some((d) => scope.canSee(d.UserId));
};

exports.getChemistLedger = async (actingUserId, pharmacyId) => {
    const scope = await access(actingUserId, 'ledger.approve');
    if (!isGuid(pharmacyId)) throw fail(400, 'Chemist is invalid.');
    const pharmacy = (await q('PHARMACY', { PharmacyId: pharmacyId }))[0];
    if (!pharmacy) throw fail(404, 'Chemist not found.');
    if (!(await canSeeChemist(scope, pharmacyId))) throw fail(403, "You can only see your own or your team's chemists.");

    const settings = await loadSettings();
    const [entries, deliveries] = await Promise.all([q('CHEMIST_LEDGER', { PharmacyId: pharmacyId }), q('LIST_DELIVERIES', { UserId: null, PharmacyId: pharmacyId })]);
    const status = (await creditStatuses([pharmacyId], settings)).get(lower(pharmacyId));
    return {
        pharmacy: { PharmacyId: pharmacy.PharmacyId, PharmacyName: pharmacy.PharmacyName },
        balance: status.balance,
        buckets: status.buckets,
        unpaid: status.unpaid,
        oldestDays: status.oldestDays,
        limit: status.limit,
        blocked: status.blocked,
        reasons: status.reasons,
        blockDays: settings.CHEMIST_DUE_BLOCK_DAYS,
        headOffice: scope.headOffice,
        entries,
        deliveries,
    };
};

exports.listDeliveries = async (actingUserId, query) => {
    const scope = await access(actingUserId, 'ledger.approve');
    const userId = query.userId ? targetUser(scope, query.userId) : scope.viewAll ? null : actingUserId;
    const rows = await q('LIST_DELIVERIES', { UserId: userId, PharmacyId: null });
    return { deliveries: rows.filter((row) => scope.canSee(row.UserId)) };
};

// Receipt photo of a delivery or a payment: the MR, anyone above them, or head office.
exports.getReceipt = async (actingUserId, kind, id) => {
    const scope = await access(actingUserId, 'ledger.approve');
    if (!isGuid(id)) throw fail(400, 'Record is invalid.');
    const row = kind === 'delivery' ? (await q('GET_DELIVERY', { DeliveryId: id }))[0] : (await q('GET_LEDGER_ENTRY', { EntryId: id }))[0];
    if (!row || !row.ReceiptStorageKey) throw fail(404, 'No receipt photo for this record.');
    if (!scope.canSee(row.UserId)) throw fail(403, 'You cannot see this receipt.');
    return { buffer: await fileStore.get(row.ReceiptStorageKey), contentType: row.ReceiptContentType || 'image/jpeg' };
};

exports._test = { atChemist, PHOTO_ID };
