const OrdersDA = require('./OrdersDA');

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

// Allowed moves. SUPPLIED and CANCELLED are final.
const TRANSITIONS = {
    BOOKED: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['SUPPLIED', 'CANCELLED'],
    SUPPLIED: [],
    CANCELLED: [],
};

const STATUS_MESSAGES = {
    CONFIRMED: 'confirmed by the stockist',
    SUPPLIED: 'marked as supplied',
    CANCELLED: 'cancelled',
};

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

    return { month: fromDate, scope, hasTeam, summary: summarize(orders), orders };
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
        },
        lines
    );

    const saved = await OrdersDA.getOrder(orderId);

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

    if (!sameId(order.UserId, actingUserId) && !sameId(order.ManagerId, actingUserId)) {
        throw fail(403, 'Only the MR who booked this order or their manager can update it.');
    }

    const toStatus = String(payload.Status || '').toUpperCase();
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

    return { message: `Order ${order.OrderNumber} ${STATUS_MESSAGES[toStatus]}.` };
};
