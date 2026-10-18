const crypto = require('crypto');

const OrdersDA = require('./OrdersDA');
const OrderChecks = require('../BusinessTracking/orderChecks');
const { loadSettings } = require('../BusinessTracking/settings');
const fileStore = require('../../utils/fileStore');
const { auditQuery, writeAudit } = require('../../utils/audit');
const { getPermissions } = require('../../utils/permissions');
const { distanceMeters } = require('../../utils/doctorMatching');

const { generateUUID } = require('../../utils/commonUtils');
const {
    fail,
    isGuid,
    optionalText,
    requireActingUser,
    sameId,
    todayKey,
    toDateKey,
    toMonthStart,
} = require('../../utils/access');

const MAX_BACKDATE_DAYS = 7;
const MAX_LINES = 30;
const MAX_QUANTITY = 100000;

const CUSTOMER_TYPES = ['DOCTOR', 'CHEMIST'];

// POB workflow (follow-up only, never used for incentives):
//   Raised (BOOKED) -> Under follow-up (CONFIRMED, manager) -> Supplied (MR, one tap) -> Verified (manager, one tap)
// Who may make each move: OWNER = the MR who booked it, MANAGER = their reporting manager.
const TRANSITIONS = {
    BOOKED: ['CONFIRMED', 'SUPPLIED', 'CANCELLED'],
    CONFIRMED: ['SUPPLIED', 'CANCELLED'],
    SUPPLIED: [],
    CANCELLED: [],
};

const MOVED_BY = { CONFIRMED: 'MANAGER', SUPPLIED: 'OWNER', CANCELLED: 'OWNER', VERIFIED: 'MANAGER' };

const STATUS_MESSAGES = {
    CONFIRMED: 'put under follow-up',
    SUPPLIED: 'marked as supplied',
    CANCELLED: 'cancelled',
    VERIFIED: 'verified',
};

const MAX_SLIP_BYTES = 5 * 1024 * 1024;
const SLIP_ID = /^[0-9a-f-]{36}\.(jpg|png|webp)$/i;
const DHASH = /^[0-9a-f]{16}$/i;
const slipKey = (userId, photoId) => `pob/${String(userId).toLowerCase()}/${String(photoId).toLowerCase()}`;
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const addDays = (key, days) => {
    const date = new Date(`${key}T00:00:00`);
    date.setDate(date.getDate() + days);
    return todayKey(date);
};

const monthEnd = (monthStart) => {
    const date = new Date(`${monthStart}T00:00:00`);
    return todayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
};

const lower = (value) => String(value).toLowerCase();

const toCount = (value, label, { min = 0 } = {}) => {
    const count = value === '' || value == null ? 0 : Number(value);

    if (!Number.isInteger(count) || count < min || count > MAX_QUANTITY) {
        throw fail(400, `${label} must be a whole number between ${min} and ${MAX_QUANTITY}.`);
    }

    return count;
};

const toPercent = (value, label) => {
    const percent = value === '' || value == null ? 0 : Number(value);

    if (!Number.isFinite(percent) || percent < 0 || percent > 100 || Math.abs(Math.round(percent * 100) - percent * 100) > 1e-6) {
        throw fail(400, `${label} must be between 0 and 100 with at most 2 decimals.`);
    }

    return Math.round(percent * 100) / 100;
};

// Money is worked out in paise (integers) so rounding is exact, then returned in rupees.
const toPaise = (rupees) => Math.round(Number(rupees) * 100);
const toRupees = (paise) => paise / 100;

const priceLine = (unitPrice, quantity, discountPercent) => {
    const gross = toPaise(unitPrice) * quantity;
    const discount = Math.round((gross * discountPercent) / 100);

    return { gross, discount, net: gross - discount };
};

const money = (value) => (value == null ? null : Number(value));

const normalizeOrder = (order, lines = []) => ({
    OrderId: order.OrderId,
    OrderNumber: order.OrderNumber,
    UserId: order.UserId,
    UserName: order.UserName,
    OrderDate: order.OrderDate,
    CustomerType: order.CustomerType,
    DoctorId: order.DoctorId,
    PharmacyId: order.PharmacyId,
    CustomerName: order.CustomerName,
    DoctorCategory: order.DoctorCategory,
    StockistId: order.StockistId,
    StockistName: order.StockistName,
    Status: order.Status,
    TotalQuantity: order.TotalQuantity,
    TotalFreeQuantity: order.TotalFreeQuantity,
    GrossAmount: money(order.GrossAmount),
    DiscountAmount: money(order.DiscountAmount),
    NetAmount: money(order.NetAmount),
    Remarks: order.Remarks,
    StatusRemarks: order.StatusRemarks,
    HasSlip: Boolean(order.HasSlip),
    DistanceFromChemistM: order.DistanceFromChemistM,
    FollowUpOn: order.FollowUpOn,
    FollowUpByName: order.FollowUpByName,
    VerifiedOn: order.VerifiedOn,
    VerifiedByName: order.VerifiedByName,
    CreatedOn: order.CreatedOn,
    ConfirmedOn: order.ConfirmedOn,
    SuppliedOn: order.SuppliedOn,
    CancelledOn: order.CancelledOn,
    lines: lines.map((line) => ({
        ...line,
        UnitPrice: money(line.UnitPrice),
        DiscountPercent: money(line.DiscountPercent),
        GrossAmount: money(line.GrossAmount),
        DiscountAmount: money(line.DiscountAmount),
        NetAmount: money(line.NetAmount),
    })),
});

const summarize = (orders) => {
    const live = orders.filter((order) => order.Status !== 'CANCELLED');
    const sum = (list) => toRupees(list.reduce((total, order) => total + toPaise(order.NetAmount), 0));

    const byStatus = Object.fromEntries(Object.keys(TRANSITIONS).map((status) => [status, 0]));
    orders.forEach((order) => {
        byStatus[order.Status] = (byStatus[order.Status] || 0) + 1;
    });

    const products = new Map();
    live.forEach((order) =>
        order.lines.forEach((line) => {
            const product = products.get(lower(line.ProductId)) || {
                ProductId: line.ProductId,
                ProductName: line.ProductName,
                quantity: 0,
                freeQuantity: 0,
                netPaise: 0,
            };

            product.quantity += line.Quantity;
            product.freeQuantity += line.FreeQuantity;
            product.netPaise += toPaise(line.NetAmount);
            products.set(lower(line.ProductId), product);
        })
    );

    return {
        orders: live.length,
        value: sum(live),
        suppliedValue: sum(live.filter((order) => order.Status === 'SUPPLIED')),
        pending: byStatus.BOOKED + byStatus.CONFIRMED,
        customers: new Set(live.map((order) => lower(order.DoctorId || order.PharmacyId))).size,
        byStatus,
        topProducts: [...products.values()]
            .sort((a, b) => b.netPaise - a.netPaise)
            .slice(0, 6)
            .map(({ netPaise, ...product }) => ({ ...product, value: toRupees(netPaise) })),
    };
};

// =========================================================
// READS
// =========================================================

// Own orders, or (scope=team) the direct reports' orders for the month.
exports.getOrders = async (actingUserId, query) => {
    requireActingUser(actingUserId);

    const scope = query.scope === 'team' ? 'team' : 'self';
    const fromDate = toMonthStart(query.month || todayKey().slice(0, 7));
    const inputs = { UserId: actingUserId, Scope: scope, FromDate: fromDate, ToDate: monthEnd(fromDate) };

    const [rows, lines, hasTeam] = await Promise.all([
        OrdersDA.getOrders(inputs),
        OrdersDA.getLines(inputs),
        OrdersDA.hasTeam(actingUserId),
    ]);

    const linesByOrder = new Map();
    lines.forEach((line) => {
        const key = lower(line.OrderId);
        linesByOrder.set(key, [...(linesByOrder.get(key) || []), line]);
    });

    const orders = rows.map((row) => normalizeOrder(row, linesByOrder.get(lower(row.OrderId))));
    const settings = await loadSettings();
    const followUpDue = hasTeam ? await OrdersDA.followUpDue(actingUserId, settings.FOLLOW_UP_AFTER_DAYS).catch(() => []) : [];

    return { month: fromDate, scope, hasTeam, summary: summarize(orders), orders, followUpDue, followUpAfterDays: settings.FOLLOW_UP_AFTER_DAYS };
};

// Everything the booking form needs, limited to what's mapped to the MR.
exports.getOptions = async (actingUserId) => {
    requireActingUser(actingUserId);

    const [doctors, pharmacies, stockists, products] = await Promise.all([
        OrdersDA.getMyDoctors(actingUserId),
        OrdersDA.getMyPharmacies(actingUserId),
        OrdersDA.getMyStockists(actingUserId),
        OrdersDA.getOrderableProducts(),
    ]);

    return {
        doctors,
        pharmacies,
        stockists,
        products: products.map((product) => ({ ...product, UnitPrice: money(product.UnitPrice) })),
        maxBackdateDays: MAX_BACKDATE_DAYS,
        maxLines: MAX_LINES,
        chemistRadius: (await loadSettings()).CHEMIST_RADIUS_METERS,
    };
};

// =========================================================
// CREATE
// =========================================================

exports.createOrder = async (actingUserId, payload) => {
    requireActingUser(actingUserId);

    const today = todayKey();
    const orderDate = toDateKey(payload.OrderDate || today, 'Order date');

    if (orderDate > today) throw fail(400, 'Order date cannot be in the future.');
    if (orderDate < addDays(today, -MAX_BACKDATE_DAYS)) {
        throw fail(400, `Orders older than ${MAX_BACKDATE_DAYS} days cannot be booked.`);
    }

    const customerType = String(payload.CustomerType || '').toUpperCase();
    if (!CUSTOMER_TYPES.includes(customerType)) throw fail(400, 'Choose whether the order is from a doctor or a chemist.');

    const customerId = customerType === 'DOCTOR' ? payload.DoctorId : payload.PharmacyId;
    if (!isGuid(customerId)) throw fail(400, customerType === 'DOCTOR' ? 'Doctor is required.' : 'Chemist is required.');
    if (!isGuid(payload.StockistId)) throw fail(400, 'Choose the stockist who will supply this order.');

    const options = await exports.getOptions(actingUserId);
    const has = (list, field, id) => list.some((item) => sameId(item[field], id));

    if (customerType === 'DOCTOR' && !has(options.doctors, 'DoctorId', customerId)) {
        throw fail(400, 'This doctor is not assigned to you.');
    }
    if (customerType === 'CHEMIST' && !has(options.pharmacies, 'PharmacyId', customerId)) {
        throw fail(400, 'This chemist is not assigned to you.');
    }
    if (!has(options.stockists, 'StockistId', payload.StockistId)) {
        throw fail(400, 'This stockist is not assigned to you.');
    }

    // Chemist POB: in-app photo of the stamped slip, booked at the chemist (GPS, date, time, MR saved automatically).
    let slip = { SlipStorageKey: null, SlipContentType: null, SlipSha256: null, SlipDHash: null };
    let booked = { BookedLatitude: null, BookedLongitude: null, BookedAccuracy: null, DistanceFromChemistM: null };
    const extra = [];
    let pharmacy = null;

    if (customerType === 'CHEMIST') {
        pharmacy = options.pharmacies.find((item) => sameId(item.PharmacyId, customerId));
        if (orderDate !== today) throw fail(400, 'Chemist orders are booked on the day, at the chemist.');

        if (!SLIP_ID.test(String(payload.SlipPhotoId || ''))) throw fail(400, "Take a photo of the chemist's stamped order slip.");
        const key = slipKey(actingUserId, payload.SlipPhotoId);
        const buffer = await fileStore.get(key).catch(() => null);
        if (!buffer) throw fail(400, 'The slip photo was not found. Take it again.');
        const type = fileStore.sniffImage(buffer);
        slip = {
            SlipStorageKey: key,
            SlipContentType: type?.contentType || 'image/jpeg',
            SlipSha256: sha256(buffer),
            SlipDHash: DHASH.test(String(payload.SlipDHash || '')) ? String(payload.SlipDHash).toLowerCase() : null,
        };

        const location = payload.Location || {};
        if (String(location.status || '').toUpperCase() !== 'CAPTURED') throw fail(400, 'Turn on location: the order must be booked at the chemist.');
        const lat = Number(location.latitude);
        const lng = Number(location.longitude);
        const accuracy = location.accuracy == null ? null : Math.round(Number(location.accuracy));
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw fail(400, 'Location is invalid.');
        if (location.isMock === true) throw fail(400, 'Fake (mock) GPS is not allowed for booking orders.');

        const settings = await loadSettings();
        const radius = settings.CHEMIST_RADIUS_METERS;

        if (pharmacy?.Latitude != null) {
            const distance = Math.round(distanceMeters(lat, lng, Number(pharmacy.Latitude), Number(pharmacy.Longitude)));
            if (distance - Math.min(accuracy || 0, 100) > radius) {
                throw fail(400, `You are about ${distance} m from ${pharmacy.PharmacyName}. Book the order at the chemist (within ${radius} m).`);
            }
            booked.DistanceFromChemistM = distance;
        } else {
            // First POB at this chemist: its location is saved from this booking (and logged).
            if (accuracy == null || accuracy > 100) throw fail(400, 'GPS is too weak to save the chemist location. Wait for a better fix (under 100 m) and try again.');
            extra.push(OrdersDA.pinPharmacyQuery({ PharmacyId: customerId, Latitude: Number(lat.toFixed(6)), Longitude: Number(lng.toFixed(6)), Accuracy: accuracy, Now: new Date(), UserId: actingUserId }));
            extra.push(auditQuery({ entityType: 'PHARMACY', entityId: customerId, action: 'PIN_LOCATION', actorId: actingUserId, after: { lat, lng, accuracy, source: 'first POB' } }));
            booked.DistanceFromChemistM = 0;
        }
        booked = { ...booked, BookedLatitude: Number(lat.toFixed(6)), BookedLongitude: Number(lng.toFixed(6)), BookedAccuracy: accuracy };
    }

    const rawLines = Array.isArray(payload.Lines) ? payload.Lines : [];
    if (rawLines.length === 0) throw fail(400, 'Add at least one product.');
    if (rawLines.length > MAX_LINES) throw fail(400, `At most ${MAX_LINES} products per order.`);

    const priceById = new Map(options.products.map((product) => [lower(product.ProductId), product]));
    const orderId = generateUUID();
    const seen = new Set();
    const totals = { quantity: 0, free: 0, gross: 0, discount: 0, net: 0 };

    const lines = rawLines.map((line, index) => {
        const label = `Line ${index + 1}`;
        const product = isGuid(line?.ProductId) ? priceById.get(lower(line.ProductId)) : null;

        if (!product) throw fail(400, `${label}: choose an active product with a price.`);
        if (seen.has(lower(product.ProductId))) throw fail(400, `${label}: ${product.ProductName} is already in this order.`);
        seen.add(lower(product.ProductId));

        const quantity = toCount(line.Quantity, `${label} quantity`, { min: 1 });
        const freeQuantity = toCount(line.FreeQuantity, `${label} free quantity`);
        const discountPercent = toPercent(line.DiscountPercent, `${label} discount`);

        if (freeQuantity > quantity) throw fail(400, `${label}: free quantity cannot be more than the ordered quantity.`);

        // Price always comes from the catalogue, never from the browser.
        const amounts = priceLine(product.UnitPrice, quantity, discountPercent);

        totals.quantity += quantity;
        totals.free += freeQuantity;
        totals.gross += amounts.gross;
        totals.discount += amounts.discount;
        totals.net += amounts.net;

        return {
            LineId: generateUUID(),
            OrderId: orderId,
            ProductId: product.ProductId,
            Quantity: quantity,
            FreeQuantity: freeQuantity,
            UnitPrice: product.UnitPrice,
            DiscountPercent: discountPercent,
            GrossAmount: toRupees(amounts.gross),
            DiscountAmount: toRupees(amounts.discount),
            NetAmount: toRupees(amounts.net),
        };
    });

    await OrdersDA.createOrder(
        {
            OrderId: orderId,
            UserId: actingUserId,
            OrderDate: orderDate,
            CustomerType: customerType,
            DoctorId: customerType === 'DOCTOR' ? customerId : null,
            PharmacyId: customerType === 'CHEMIST' ? customerId : null,
            StockistId: payload.StockistId,
            TotalQuantity: totals.quantity,
            TotalFreeQuantity: totals.free,
            GrossAmount: toRupees(totals.gross),
            DiscountAmount: toRupees(totals.discount),
            NetAmount: toRupees(totals.net),
            Remarks: optionalText(payload.Remarks, 500, 'Remarks'),
            Now: new Date(),
            ...slip,
            ...booked,
        },
        lines,
        extra
    );

    const saved = await OrdersDA.getOrder(orderId);

    // Background checks (inflated quantity, large first order, same slip photo): flags only.
    const productName = new Map(options.products.map((product) => [lower(product.ProductId), product.ProductName]));
    OrderChecks.checkNewOrder(
        {
            OrderId: orderId,
            OrderNumber: saved.OrderNumber,
            UserId: actingUserId,
            PharmacyId: customerType === 'CHEMIST' ? customerId : null,
            PharmacyName: pharmacy?.PharmacyName || saved.CustomerName,
            NetAmount: toRupees(totals.net),
            CreatedOn: saved.CreatedOn,
            SlipSha256: slip.SlipSha256,
            SlipDHash: slip.SlipDHash,
        },
        lines.map((line) => ({ ProductId: line.ProductId, ProductName: productName.get(lower(line.ProductId)) || 'product', Quantity: line.Quantity }))
    ).catch((error) => console.error('Order checks failed for', saved.OrderNumber, error.message));

    return { message: `Order ${saved.OrderNumber} booked.`, OrderId: orderId, OrderNumber: saved.OrderNumber };
};

// =========================================================
// STATUS
// =========================================================

// The MR who booked the order, or their reporting manager, moves it along.
exports.updateStatus = async (actingUserId, orderId, payload) => {
    requireActingUser(actingUserId);

    if (!isGuid(orderId)) throw fail(400, 'Order is invalid.');

    const order = await OrdersDA.getOrder(orderId);
    if (!order) throw fail(404, 'Order not found.');

    const isOwner = sameId(order.UserId, actingUserId);
    const isManager = sameId(order.ManagerId, actingUserId) && !isOwner;
    if (!isOwner && !isManager) throw fail(403, 'Only the MR who booked this order or their manager can update it.');

    const toStatus = String(payload.Status || '').toUpperCase();
    const mover = MOVED_BY[toStatus];
    if (mover === 'OWNER' && !isOwner) throw fail(403, `Only the MR who booked the order can mark it ${toStatus === 'SUPPLIED' ? 'supplied' : 'cancelled'}.`);
    if (mover === 'MANAGER' && !isManager) throw fail(403, 'Only the reporting manager can do this.');

    if (toStatus === 'VERIFIED') {
        if (order.Status !== 'SUPPLIED') throw fail(409, 'Only a supplied order can be verified.');
        if (order.VerifiedOn) throw fail(409, 'This order is already verified.');
        const done = await OrdersDA.verifyOrder({ OrderId: order.OrderId, UserId: actingUserId, Now: new Date() });
        if (!done) throw fail(409, 'This order was updated by someone else. Refresh and try again.');
        await writeAudit({ entityType: 'ORDER', entityId: order.OrderId, action: 'VERIFIED', actorId: actingUserId });
        return { message: `Order ${order.OrderNumber} verified.` };
    }

    if (!(TRANSITIONS[order.Status] || []).includes(toStatus)) {
        throw fail(409, `A ${order.Status.toLowerCase()} order cannot be ${STATUS_MESSAGES[toStatus] || 'changed to that status'}.`);
    }

    const remarks = optionalText(payload.Remarks, 500, 'Remarks');
    if (toStatus === 'CANCELLED' && !remarks) throw fail(400, 'Give a reason for cancelling.');

    const changed = await OrdersDA.updateStatus({
        OrderId: order.OrderId,
        FromStatus: order.Status,
        ToStatus: toStatus,
        StatusRemarks: remarks,
        ModifiedBy: actingUserId,
        Now: new Date(),
    });

    if (!changed) throw fail(409, 'This order was updated by someone else. Refresh and try again.');
    await writeAudit({ entityType: 'ORDER', entityId: order.OrderId, action: toStatus, actorId: actingUserId, reason: remarks, before: { status: order.Status }, after: { status: toStatus } });

    return { message: `Order ${order.OrderNumber} ${STATUS_MESSAGES[toStatus]}.` };
};

// =========================================================
// SLIP PHOTO (in-app camera only; uploaded first, attached when the order is booked)
// =========================================================

exports.uploadSlip = async (actingUserId, buffer) => {
    requireActingUser(actingUserId);
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw fail(400, 'No photo received.');
    if (buffer.length > MAX_SLIP_BYTES) throw fail(413, 'Photo is larger than 5 MB.');
    const type = fileStore.sniffImage(buffer);
    if (!type) throw fail(400, 'Only JPEG, PNG or WebP photos are accepted.');
    const photoId = `${generateUUID()}.${type.ext}`;
    await fileStore.put(slipKey(actingUserId, photoId), buffer);
    return { photoId };
};

// The MR, their manager, or head office (business.approve) can see the slip.
exports.getSlip = async (actingUserId, orderId) => {
    requireActingUser(actingUserId);
    if (!isGuid(orderId)) throw fail(400, 'Order is invalid.');
    const order = await OrdersDA.getOrder(orderId);
    if (!order || !order.SlipStorageKey) throw fail(404, 'No slip photo for this order.');
    const allowed = sameId(order.UserId, actingUserId) || sameId(order.ManagerId, actingUserId) || (await getPermissions(actingUserId)).has('business.approve');
    if (!allowed) throw fail(403, 'You cannot see this slip.');
    return { buffer: await fileStore.get(order.SlipStorageKey), contentType: order.SlipContentType || 'image/jpeg' };
};
