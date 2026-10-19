// Head office only: issue saleable stock to MRs and take it back, credit limits, confirm that collected
// money reached the company, close or write off dues, record schemes / special prices from stockist
// billing, and exit clearance. Nothing is deleted: corrections are voids with a reason, and every change
// goes to the audit log in the same transaction.

const sql = require('./sql');
const rules = require('./rules');
const { loadSettings } = require('./settings');
const { access, requireHeadOffice } = require('./scope');
const Ledger = require('./LedgerService');

const { customQuery, runInTransaction } = require('../../utils/dbFunctions');
const { generateUUID } = require('../../utils/commonUtils');
const { auditQuery } = require('../../utils/audit');
const { fail, isGuid, optionalText, sameId, toDateKey } = require('../../utils/access');

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
const rupees = (value) => `Rs ${Number(value || 0).toLocaleString('en-IN')}`;

const headOffice = async (actingUserId) => {
    const scope = await access(actingUserId, 'ledger.approve');
    requireHeadOffice(scope);
    return scope;
};

const reasonText = (value, label = 'Reason') => {
    const text = optionalText(value, 300, label);
    if (!text || text.length < 10) throw fail(400, `${label} is required (at least 10 characters).`);
    return text;
};

const money = (value, label, { allowZero = false } = {}) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0) || n > 100000000) throw fail(400, `${label} must be a positive amount.`);
    return rules.toRupees(rules.toPaise(n));
};

const count = (value, label) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 1000000) throw fail(400, `${label} must be a whole number from 1.`);
    return n;
};

const recordDate = (value, label) => {
    const date = toDateKey(value || todayIst(), label);
    if (date > todayIst()) throw fail(400, `${label} cannot be in the future.`);
    return date;
};

const activeUser = async (userId, label = 'Employee') => {
    if (!isGuid(userId)) throw fail(400, `Choose the ${label.toLowerCase()}.`);
    const user = (await q('USER', { UserId: userId }))[0];
    if (!user) throw fail(404, `${label} not found.`);
    return user;
};

// =========================================================
// Saleable stock with MRs
// =========================================================

exports.getHoldings = async (actingUserId) => {
    await headOffice(actingUserId);
    const settings = await loadSettings();
    const today = todayIst();
    const [holdings, lotRows, users] = await Promise.all([q('HOLDINGS'), q('LOT_ENTRIES', { UserId: null }), q('ACTIVE_USERS')]);

    const groups = new Map();
    lotRows.forEach((row) => {
        const key = `${lower(row.UserId)}|${lower(row.BatchId)}`;
        if (!groups.has(key)) groups.set(key, { row, list: [] });
        groups.get(key).list.push(row);
    });
    const heldLong = [];
    groups.forEach(({ row, list }) => {
        rules.heldTooLong(rules.openLots(list), today, settings.MR_STOCK_HOLD_DAYS).forEach((lot) => heldLong.push({ UserId: row.UserId, UserName: row.UserName, ProductName: row.ProductName, BatchNumber: row.BatchNumber, ...lot }));
    });

    return {
        limit: settings.MR_STOCK_LIMIT,
        holdDays: settings.MR_STOCK_HOLD_DAYS,
        holdings: holdings.map((h) => ({ ...h, Quantity: Number(h.Quantity), Value: Number(h.Value), overLimit: Number(h.Value) > settings.MR_STOCK_LIMIT })),
        heldLong: heldLong.sort((a, b) => b.ageDays - a.ageDays),
        users,
    };
};

exports.issueStock = async (actingUserId, payload) => {
    await headOffice(actingUserId);
    const user = await activeUser(payload.UserId, 'MR');
    if (!user.IsActive) throw fail(400, 'This person is not active.');
    if ((await q('OPEN_CLEARANCE_OF', { UserId: user.UserId })).length) throw fail(409, 'This MR is leaving (open exit clearance). Stock cannot be issued.');
    if (!isGuid(payload.BatchId)) throw fail(400, 'Choose the batch.');
    const batch = (await q('BATCH', { BatchId: payload.BatchId }))[0];
    if (!batch) throw fail(400, 'Batch not found.');
    if (batch.ExpiryDate <= todayIst()) throw fail(400, `Batch ${batch.BatchNumber} has expired.`);

    const quantity = count(payload.Quantity, 'Quantity');
    const value = money(payload.Value, 'Value');
    const settings = await loadSettings();

    // Most stock value an MR may hold (checked again inside the transaction).
    const held = (await q('STOCK_BALANCES', { UserId: user.UserId })).reduce((sum, b) => sum + Number(b.Value || 0), 0);
    const check = rules.issueCheck(held, value, settings.MR_STOCK_LIMIT);
    if (!check.allowed) throw fail(409, `Not issued: ${user.Name} already holds ${rupees(held)} of stock; this issue would take it to ${rupees(check.after)}, over the limit of ${rupees(check.limit)}.`);

    const row = {
        EntryId: generateUUID(),
        UserId: user.UserId,
        ProductId: batch.ProductId,
        BatchId: batch.BatchId,
        Quantity: quantity,
        UnitValue: rules.toRupees(Math.round(rules.toPaise(value) / quantity)),
        Value: value,
        EntryDate: recordDate(payload.EntryDate, 'Issue date'),
        Remarks: optionalText(payload.Remarks, 300, 'Remarks'),
        Limit: settings.MR_STOCK_LIMIT,
        ActorId: actingUserId,
        Now: new Date(),
    };
    await run([{ sqlQuery: sql.INSERT_ISSUE(), inputs: row }, auditQuery({ entityType: 'MR_STOCK', entityId: row.EntryId, action: 'ISSUE', actorId: actingUserId, after: row })]);
    return { message: `${quantity} of ${batch.ProductName} (${batch.BatchNumber}) issued to ${user.Name}.`, EntryId: row.EntryId };
};

// Stock the MR hands back to the company.
exports.returnStock = async (actingUserId, payload) => {
    await headOffice(actingUserId);
    const user = await activeUser(payload.UserId, 'MR');
    if (!isGuid(payload.BatchId)) throw fail(400, 'Choose the batch.');
    const balance = (await q('STOCK_BALANCES', { UserId: user.UserId })).find((b) => sameId(b.BatchId, payload.BatchId));
    if (!balance || Number(balance.Quantity) <= 0) throw fail(400, 'This MR holds none of that batch.');
    const quantity = count(payload.Quantity, 'Quantity');
    const value = rules.outflowValue(Number(balance.Quantity), Number(balance.Value), quantity);
    const row = {
        EntryId: generateUUID(),
        UserId: user.UserId,
        ProductId: balance.ProductId,
        BatchId: balance.BatchId,
        BatchNumber: balance.BatchNumber,
        EntryType: 'RETURN',
        Quantity: quantity,
        UnitValue: rules.toRupees(Math.round(rules.toPaise(value) / quantity)),
        Value: value,
        EntryDate: recordDate(payload.EntryDate, 'Return date'),
        DeliveryId: null,
        ClearanceId: null,
        Remarks: optionalText(payload.Remarks, 300, 'Remarks'),
        ActorId: actingUserId,
        Now: new Date(),
    };
    await run([{ sqlQuery: sql.INSERT_OUTFLOW(), inputs: row }, auditQuery({ entityType: 'MR_STOCK', entityId: row.EntryId, action: 'RETURN', actorId: actingUserId, after: row })]);
    return { message: `${quantity} of ${balance.ProductName} returned to the company by ${user.Name}.` };
};

exports.voidStockEntry = async (actingUserId, entryId, payload) => {
    await headOffice(actingUserId);
    if (!isGuid(entryId)) throw fail(400, 'Entry is invalid.');
    const entry = (await q('GET_STOCK_ENTRY', { EntryId: entryId }))[0];
    if (!entry) throw fail(404, 'Entry not found.');
    const reason = reasonText(payload.Reason);
    await run([
        { sqlQuery: sql.VOID_STOCK_ENTRY(), inputs: { EntryId: entryId, ActorId: actingUserId, Now: new Date(), Reason: reason } },
        auditQuery({ entityType: 'MR_STOCK', entityId: entryId, action: 'VOID', actorId: actingUserId, reason, before: entry }),
    ]);
    return { message: 'Entry voided.' };
};

// =========================================================
// Chemist dues
// =========================================================

exports.setCreditLimit = async (actingUserId, pharmacyId, payload) => {
    await headOffice(actingUserId);
    if (!isGuid(pharmacyId)) throw fail(400, 'Chemist is invalid.');
    const pharmacy = (await q('PHARMACY', { PharmacyId: pharmacyId }))[0];
    if (!pharmacy) throw fail(404, 'Chemist not found.');
    const limit = money(payload.CreditLimit, 'Credit limit', { allowZero: true });
    const before = (await q('CREDIT_LIMITS', { Pharmacies: JSON.stringify([pharmacyId]) }))[0] || null;
    const reason = optionalText(payload.Reason, 300, 'Reason');
    await run([
        { sqlQuery: sql.UPSERT_CREDIT_LIMIT(), inputs: { PharmacyId: pharmacyId, CreditLimit: limit, ActorId: actingUserId, Now: new Date() } },
        auditQuery({ entityType: 'CHEMIST_CREDIT', entityId: pharmacyId, action: 'SET_LIMIT', actorId: actingUserId, reason, before, after: { CreditLimit: limit } }),
    ]);
    return { message: `Credit limit for ${pharmacy.PharmacyName} set to ${rupees(limit)}.` };
};

exports.confirmDeposit = async (actingUserId, entryId) => {
    await headOffice(actingUserId);
    if (!isGuid(entryId)) throw fail(400, 'Payment is invalid.');
    const entry = (await q('GET_LEDGER_ENTRY', { EntryId: entryId }))[0];
    if (!entry) throw fail(404, 'Payment not found.');
    await run([
        { sqlQuery: sql.CONFIRM_DEPOSIT(), inputs: { EntryId: entryId, ActorId: actingUserId, Now: new Date() } },
        auditQuery({ entityType: 'CHEMIST_PAYMENT', entityId: entryId, action: 'DEPOSIT_CONFIRMED', actorId: actingUserId, before: { DepositStatus: entry.DepositStatus } }),
    ]);
    return { message: `Payment of ${rupees(-Number(entry.Amount))} confirmed as received by the company.` };
};

exports.paymentsWithMr = async (actingUserId, query) => {
    await headOffice(actingUserId);
    return { payments: await q('PAYMENTS_WITH_MR', { UserId: isGuid(query.userId) ? query.userId : null }) };
};

// Close dues: WRITE_OFF reduces the dues (bad debt), ADJUSTMENT adds or removes an amount (corrections).
exports.adjustDues = async (actingUserId, pharmacyId, payload) => {
    await headOffice(actingUserId);
    if (!isGuid(pharmacyId)) throw fail(400, 'Chemist is invalid.');
    const pharmacy = (await q('PHARMACY', { PharmacyId: pharmacyId }))[0];
    if (!pharmacy) throw fail(404, 'Chemist not found.');
    const type = String(payload.Type || '').toUpperCase();
    if (!['ADJUSTMENT', 'WRITE_OFF'].includes(type)) throw fail(400, 'Choose write-off or adjustment.');
    const amount = Number(payload.Amount);
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100000000) throw fail(400, 'Enter the amount.');
    if (type === 'WRITE_OFF' && amount < 0) throw fail(400, 'Enter the write-off as a positive amount.');
    const signed = type === 'WRITE_OFF' ? -rules.toRupees(rules.toPaise(amount)) : rules.toRupees(rules.toPaise(amount));
    const reason = reasonText(payload.Reason);
    const entryId = generateUUID();
    await run([
        {
            sqlQuery: sql.INSERT_LEDGER(),
            inputs: {
                EntryId: entryId,
                PharmacyId: pharmacyId,
                EntryType: type,
                Amount: signed,
                EntryDate: todayIst(),
                UserId: null,
                DeliveryId: null,
                PaymentMode: null,
                PaymentRef: null,
                ReceiptStorageKey: null,
                ReceiptContentType: null,
                Latitude: null,
                Longitude: null,
                DepositStatus: null,
                Remarks: reason,
                ActorId: actingUserId,
                Now: new Date(),
            },
        },
        auditQuery({ entityType: 'CHEMIST_LEDGER', entityId: entryId, action: type, actorId: actingUserId, reason, after: { pharmacyId, amount: signed } }),
    ]);
    return { message: `${type === 'WRITE_OFF' ? 'Write-off' : 'Adjustment'} of ${rupees(Math.abs(signed))} recorded for ${pharmacy.PharmacyName}.` };
};

exports.voidLedgerEntry = async (actingUserId, entryId, payload) => {
    await headOffice(actingUserId);
    if (!isGuid(entryId)) throw fail(400, 'Entry is invalid.');
    const entry = (await q('GET_LEDGER_ENTRY', { EntryId: entryId }))[0];
    if (!entry) throw fail(404, 'Entry not found.');
    const reason = reasonText(payload.Reason);
    await run([
        { sqlQuery: sql.VOID_LEDGER_ENTRY(), inputs: { EntryId: entryId, ActorId: actingUserId, Now: new Date(), Reason: reason } },
        auditQuery({ entityType: 'CHEMIST_LEDGER', entityId: entryId, action: 'VOID', actorId: actingUserId, reason, before: entry }),
    ]);
    return { message: 'Entry voided.' };
};

exports.voidDelivery = async (actingUserId, deliveryId, payload) => {
    await headOffice(actingUserId);
    if (!isGuid(deliveryId)) throw fail(400, 'Delivery is invalid.');
    const delivery = (await q('GET_DELIVERY', { DeliveryId: deliveryId }))[0];
    if (!delivery) throw fail(404, 'Delivery not found.');
    const reason = reasonText(payload.Reason);
    await run([
        { sqlQuery: sql.VOID_DELIVERY(), inputs: { DeliveryId: deliveryId, ActorId: actingUserId, Now: new Date(), Reason: reason } },
        auditQuery({ entityType: 'CHEMIST_DELIVERY', entityId: deliveryId, action: 'VOID', actorId: actingUserId, reason, before: { total: delivery.TotalValue, pharmacyId: delivery.PharmacyId } }),
    ]);
    return { message: `Delivery ${delivery.DeliveryNumber} voided: the stock is back with the MR and the due is removed.` };
};

// =========================================================
// Schemes and special prices (from stockist billing; never by the MR)
// =========================================================

exports.getLookups = async (actingUserId) => {
    await headOffice(actingUserId);
    const [stockists, territories, chemists, doctors, products] = await Promise.all([q('LOOKUP_STOCKISTS'), q('TERRITORY_NAMES'), q('LOOKUP_CHEMISTS'), q('LOOKUP_DOCTORS'), q('LOOKUP_PRODUCTS')]);
    return { stockists, territories, chemists, doctors, products };
};

exports.listSchemes = async (actingUserId, query) => {
    await headOffice(actingUserId);
    const to = query.to ? toDateKey(query.to, 'To') : todayIst();
    const from = query.from ? toDateKey(query.from, 'From') : `${to.slice(0, 7)}-01`;
    return { from, to, schemes: await q('LIST_SCHEMES', { From: from, To: to }) };
};

exports.createScheme = async (actingUserId, payload) => {
    await headOffice(actingUserId);
    const kind = String(payload.Kind || '').toUpperCase();
    if (!['SCHEME', 'SPECIAL_PRICE'].includes(kind)) throw fail(400, 'Choose scheme or special price.');
    if (!isGuid(payload.StockistId) || !(await q('STOCKIST_EXISTS', { StockistId: payload.StockistId })).length) throw fail(400, 'Choose the stockist whose bill this is on.');
    const description = optionalText(payload.Description, 200, 'Description');
    if (!description) throw fail(400, kind === 'SCHEME' ? 'Describe the scheme, e.g. 10+1.' : 'Describe the special price, e.g. Rs 85 instead of Rs 100.');

    let territoryId = isGuid(payload.TerritoryId) ? payload.TerritoryId : null;
    let pharmacyId = null;
    let doctorId = null;
    if (payload.PharmacyId) {
        if (!isGuid(payload.PharmacyId)) throw fail(400, 'Chemist is invalid.');
        const pharmacy = (await q('PHARMACY', { PharmacyId: payload.PharmacyId }))[0];
        if (!pharmacy) throw fail(400, 'Chemist not found.');
        pharmacyId = pharmacy.PharmacyId;
        territoryId = territoryId || pharmacy.TerritoryId;
    }
    if (payload.DoctorId) {
        if (!isGuid(payload.DoctorId)) throw fail(400, 'Doctor is invalid.');
        const doctor = (await q('DOCTOR', { DoctorId: payload.DoctorId }))[0];
        if (!doctor) throw fail(400, 'Doctor not found.');
        doctorId = doctor.DoctorId;
        territoryId = territoryId || doctor.TerritoryId;
    }
    if (!territoryId || !(await q('TERRITORY_EXISTS', { TerritoryId: territoryId })).length) throw fail(400, 'Choose the territory (or a chemist / doctor that has one).');
    let productId = null;
    if (payload.ProductId) {
        if (!isGuid(payload.ProductId) || !(await q('PRODUCT', { ProductId: payload.ProductId })).length) throw fail(400, 'Product not found.');
        productId = payload.ProductId;
    }

    const row = {
        SchemeId: generateUUID(),
        Kind: kind,
        BillingDate: recordDate(payload.BillingDate, 'Billing date'),
        StockistId: payload.StockistId,
        BillReference: optionalText(payload.BillReference, 60, 'Bill reference'),
        TerritoryId: territoryId,
        PharmacyId: pharmacyId,
        DoctorId: doctorId,
        ProductId: productId,
        Description: description,
        Value: money(payload.Value, 'Value (cost to the company)'),
        ActorId: actingUserId,
        Now: new Date(),
    };
    await run([{ sqlQuery: sql.INSERT_SCHEME(), inputs: row }, auditQuery({ entityType: 'TRADE_SCHEME', entityId: row.SchemeId, action: 'CREATE', actorId: actingUserId, after: row })]);
    return { message: `${kind === 'SCHEME' ? 'Scheme' : 'Special price'} of ${rupees(row.Value)} recorded.`, SchemeId: row.SchemeId };
};

exports.voidScheme = async (actingUserId, schemeId, payload) => {
    await headOffice(actingUserId);
    if (!isGuid(schemeId)) throw fail(400, 'Entry is invalid.');
    const scheme = (await q('GET_SCHEME', { SchemeId: schemeId }))[0];
    if (!scheme) throw fail(404, 'Entry not found.');
    const reason = reasonText(payload.Reason);
    await run([
        { sqlQuery: sql.VOID_SCHEME(), inputs: { SchemeId: schemeId, ActorId: actingUserId, Now: new Date(), Reason: reason } },
        auditQuery({ entityType: 'TRADE_SCHEME', entityId: schemeId, action: 'VOID', actorId: actingUserId, reason, before: scheme }),
    ]);
    return { message: 'Entry voided.' };
};

// =========================================================
// Exit clearance
// =========================================================

const safeRows = async (name, inputs) => {
    try {
        return await q(name, inputs);
    } catch (error) {
        if (error.number === 208) return []; // module not installed yet
        throw error;
    }
};

// What the leaving MR still holds or owes the company, as clearance items.
const buildItems = async (userId) => {
    const settings = await loadSettings();
    const items = [];

    (await q('STOCK_BALANCES', { UserId: userId }))
        .filter((b) => Number(b.Quantity) > 0)
        .forEach((b) =>
            items.push({ ItemType: 'STOCK', RefId: String(b.BatchId), Label: `${b.ProductName} batch ${b.BatchNumber}: ${b.Quantity} in hand`, Quantity: Number(b.Quantity), Amount: Number(b.Value) })
        );

    // Dues from this MR's own deliveries that chemists have not paid yet.
    const delivered = (await q('CHEMISTS_DELIVERED_BY', { UserId: userId })).map((row) => row.PharmacyId);
    if (delivered.length) {
        const statuses = await Ledger.creditStatuses(delivered, settings);
        const names = new Map((await q('PHARMACY_NAMES', { Pharmacies: JSON.stringify(delivered) })).map((row) => [lower(row.PharmacyId), row.PharmacyName]));
        statuses.forEach((status, pharmacyId) => {
            const mine = new Set(status.entries.filter((e) => sameId(e.DeliveredBy, userId) && e.DeliveryId).map((e) => lower(e.DeliveryId)));
            const unpaid = status.unpaid.filter((u) => u.ref && mine.has(lower(u.ref)));
            const amount = rules.toRupees(unpaid.reduce((sum, u) => sum + rules.toPaise(u.amount), 0));
            if (amount > 0) {
                items.push({ ItemType: 'CHEMIST_DUES', RefId: pharmacyId, Label: `${names.get(pharmacyId) || 'Chemist'}: unpaid from this MR's deliveries (oldest ${Math.max(...unpaid.map((u) => u.ageDays))} days)`, Quantity: null, Amount: amount });
            }
        });
    }

    (await q('PAYMENTS_WITH_MR', { UserId: userId })).forEach((p) =>
        items.push({ ItemType: 'PAYMENT_WITH_MR', RefId: String(p.EntryId), Label: `${p.PaymentMode} from ${p.PharmacyName} on ${p.EntryDate}, not yet confirmed received`, Quantity: null, Amount: Number(p.Amount) })
    );

    (await safeRows('PENDING_SPEND', { UserId: userId })).forEach((r) =>
        items.push({ ItemType: 'PENDING_SPEND', RefId: String(r.RequestId), Label: `${r.RequestNumber} for Dr. ${r.DoctorName} (${r.Status.toLowerCase().replace('_', ' ')})`, Quantity: null, Amount: Number(r.Amount) })
    );

    return items;
};

const itemSteps = (clearanceId, items, now) => items.map((item) => ({ sqlQuery: sql.INSERT_ITEM(), inputs: { ItemId: generateUUID(), ClearanceId: clearanceId, ...item, Now: now } }));

exports.listClearances = async (actingUserId) => {
    await headOffice(actingUserId);
    return { clearances: await q('LIST_CLEARANCES', { UserId: null }), users: await q('ACTIVE_USERS') };
};

exports.getClearance = async (actingUserId, clearanceId) => {
    await headOffice(actingUserId);
    if (!isGuid(clearanceId)) throw fail(400, 'Clearance is invalid.');
    const clearance = (await q('LIST_CLEARANCES', { UserId: null })).find((c) => sameId(c.ClearanceId, clearanceId));
    if (!clearance) throw fail(404, 'Clearance not found.');
    const items = await q('CLEARANCE_ITEMS', { ClearanceId: clearanceId });
    const open = items.filter((i) => i.Status === 'OPEN');
    return {
        clearance,
        settlement: clearance.Status === 'CLOSED' ? 'RELEASED' : 'ON_HOLD',
        summary: {
            stockValue: rules.toRupees(open.filter((i) => i.ItemType === 'STOCK').reduce((s, i) => s + rules.toPaise(i.Amount), 0)),
            chemistDues: rules.toRupees(open.filter((i) => i.ItemType === 'CHEMIST_DUES').reduce((s, i) => s + rules.toPaise(i.Amount), 0)),
            paymentsWithMr: rules.toRupees(open.filter((i) => i.ItemType === 'PAYMENT_WITH_MR').reduce((s, i) => s + rules.toPaise(i.Amount), 0)),
            pendingSpend: open.filter((i) => i.ItemType === 'PENDING_SPEND').length,
            openItems: open.length,
        },
        items,
    };
};

// "Mark as leaving": opens the clearance and lists everything to settle. Full and final is on hold until closed.
exports.createClearance = async (actingUserId, payload) => {
    await headOffice(actingUserId);
    const user = await activeUser(payload.UserId);
    const leavingDate = toDateKey(payload.LeavingDate, 'Leaving date');
    let successor = null;
    if (payload.SuccessorUserId) {
        successor = await activeUser(payload.SuccessorUserId, 'New MR');
        if (sameId(successor.UserId, user.UserId)) throw fail(400, 'The new MR must be someone else.');
        if (!successor.IsActive) throw fail(400, 'The new MR is not active.');
    }
    const clearanceId = generateUUID();
    const now = new Date();
    const items = await buildItems(user.UserId);
    const row = { ClearanceId: clearanceId, UserId: user.UserId, LeavingDate: leavingDate, SuccessorUserId: successor?.UserId || null, Reason: optionalText(payload.Reason, 300, 'Reason'), ActorId: actingUserId, Now: now };
    await run([
        { sqlQuery: sql.INSERT_CLEARANCE(), inputs: row },
        ...itemSteps(clearanceId, items, now),
        auditQuery({ entityType: 'EXIT_CLEARANCE', entityId: clearanceId, action: 'CREATE', actorId: actingUserId, after: { ...row, items: items.length } }),
    ]);
    return { message: `Exit clearance opened for ${user.Name} with ${items.length} item(s). Full and final settlement is on hold until head office closes each item.`, ClearanceId: clearanceId };
};

// Adds anything new (e.g. a payment logged after the clearance was opened).
exports.refreshClearance = async (actingUserId, clearanceId) => {
    await headOffice(actingUserId);
    const clearance = (await q('GET_CLEARANCE', { ClearanceId: clearanceId }))[0];
    if (!clearance) throw fail(404, 'Clearance not found.');
    if (clearance.Status !== 'OPEN') throw fail(409, 'This clearance is closed.');
    const before = (await q('CLEARANCE_ITEMS', { ClearanceId: clearanceId })).length;
    await run(itemSteps(clearanceId, await buildItems(clearance.UserId), new Date()));
    const after = (await q('CLEARANCE_ITEMS', { ClearanceId: clearanceId })).length;
    return { message: after > before ? `${after - before} new item(s) added.` : 'Nothing new to add.' };
};

exports.closeItem = async (actingUserId, itemId, payload) => {
    await headOffice(actingUserId);
    if (!isGuid(itemId)) throw fail(400, 'Item is invalid.');
    const item = (await q('GET_ITEM', { ItemId: itemId }))[0];
    if (!item) throw fail(404, 'Item not found.');
    if (item.ClearanceStatus !== 'OPEN') throw fail(409, 'This clearance is closed.');
    const note = optionalText(payload.Note, 500, 'Note');
    if (!note || note.length < 10) throw fail(400, 'Say how it was settled (at least 10 characters), e.g. "stock returned to depot" or "chemist paid by NEFT".');
    await run([
        { sqlQuery: sql.CLOSE_ITEM(), inputs: { ItemId: itemId, ActorId: actingUserId, Now: new Date(), Note: note } },
        auditQuery({ entityType: 'EXIT_CLEARANCE_ITEM', entityId: itemId, action: 'CLOSE', actorId: actingUserId, reason: note, before: { label: item.Label, amount: item.Amount } }),
    ]);
    return { message: 'Item closed.' };
};

exports.closeClearance = async (actingUserId, clearanceId) => {
    await headOffice(actingUserId);
    if (!isGuid(clearanceId)) throw fail(400, 'Clearance is invalid.');
    await run([
        { sqlQuery: sql.CLOSE_CLEARANCE(), inputs: { ClearanceId: clearanceId, ActorId: actingUserId, Now: new Date() } },
        auditQuery({ entityType: 'EXIT_CLEARANCE', entityId: clearanceId, action: 'CLOSE', actorId: actingUserId, after: { settlement: 'RELEASED' } }),
    ]);
    return { message: 'Exit clearance closed. Full and final settlement can be released.' };
};

/**
 * Handover: the leaver's chemists and doctors move to the new MR (or to head office), with history kept,
 * and stock in hand is transferred to the new MR. Runs automatically on the leaving date (see checks.js)
 * or when head office presses "Hand over now". actorId: who did it (head office, or the system sweep).
 */
const handover = async (clearanceId, by) => {
    const clearance = (await q('GET_CLEARANCE', { ClearanceId: clearanceId }))[0];
    if (!clearance) throw fail(404, 'Clearance not found.');
    if (clearance.HandedOverOn) throw fail(409, 'This handover was already done.');
    const actorId = by || clearance.CreatedBy; // the automatic run acts for the head office user who opened the clearance
    const now = new Date();
    const today = todayIst();
    const successorId = clearance.SuccessorUserId || null;
    const steps = [{ sqlQuery: sql.MARK_HANDED_OVER(), inputs: { ClearanceId: clearanceId, Now: now } }, { sqlQuery: sql.HANDOVER_MAPPINGS(), inputs: { UserId: clearance.UserId, SuccessorUserId: successorId, Now: now } }];

    const moved = [];
    if (successorId) {
        (await q('STOCK_BALANCES', { UserId: clearance.UserId }))
            .filter((b) => Number(b.Quantity) > 0)
            .forEach((b) => {
                const quantity = Number(b.Quantity);
                const value = Number(b.Value);
                const unit = rules.toRupees(Math.round(rules.toPaise(value) / quantity));
                const common = { ProductId: b.ProductId, BatchId: b.BatchId, Quantity: quantity, UnitValue: unit, Value: value, EntryDate: today, ClearanceId: clearanceId, ActorId: actorId, Now: now };
                steps.push({ sqlQuery: sql.INSERT_OUTFLOW(), inputs: { ...common, EntryId: generateUUID(), UserId: clearance.UserId, BatchNumber: b.BatchNumber, EntryType: 'TRANSFER_OUT', DeliveryId: null, Remarks: 'Handed over on exit' } });
                steps.push({ sqlQuery: sql.INSERT_TRANSFER_IN(), inputs: { ...common, EntryId: generateUUID(), UserId: successorId, Remarks: 'Taken over from a leaving MR' } });
                moved.push({ batchId: b.BatchId, quantity, value });
            });
    }
    steps.push(auditQuery({ entityType: 'EXIT_CLEARANCE', entityId: clearanceId, action: 'HANDOVER', actorId, after: { from: clearance.UserId, to: successorId || 'HEAD_OFFICE', stock: moved } }));
    const results = await run(steps);
    const counts = results[1]?.recordset?.[0] || { Chemists: 0, Doctors: 0 };
    return { counts, moved };
};

exports.handover = handover;

exports.handoverNow = async (actingUserId, clearanceId) => {
    await headOffice(actingUserId);
    if (!isGuid(clearanceId)) throw fail(400, 'Clearance is invalid.');
    const { counts, moved } = await handover(clearanceId, actingUserId);
    return { message: `Handed over: ${counts.Chemists} chemist(s), ${counts.Doctors} doctor(s)${moved.length ? `, ${moved.length} batch(es) of stock` : ''}. History is kept.` };
};

exports._test = { buildItems };
