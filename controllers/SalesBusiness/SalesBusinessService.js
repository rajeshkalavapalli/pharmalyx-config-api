const SalesBusinessDA = require('./SalesBusinessDA');

const { requireActingUser, todayKey, toMonthStart } = require('../../utils/access');

const TREND_MONTHS = 6;
const TOP = 8;

const money = (value) => Number(value || 0);
const lower = (value) => String(value).toLowerCase();

const shiftMonth = (monthStart, delta) => {
    const date = new Date(`${monthStart}T00:00:00`);
    return todayKey(new Date(date.getFullYear(), date.getMonth() + delta, 1));
};

const monthEnd = (monthStart) => {
    const date = new Date(`${monthStart}T00:00:00`);
    return todayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
};

const daysInMonth = (monthStart) => Number(monthEnd(monthStart).slice(8, 10));

// Percent change; null when there's nothing to compare with.
const change = (current, previous) => (previous > 0 ? Math.round(((current - previous) / previous) * 100) : null);

// Joins two per-key lists (POB and secondary) into one row per key.
const merge = (pobRows, secondaryRows, idField, nameField) => {
    const rows = new Map();
    const row = (item) => {
        const key = lower(item[idField]);
        if (!rows.has(key)) rows.set(key, { id: item[idField], name: item[nameField] || '—', pobValue: 0, pobQty: 0, orders: 0, secondaryValue: 0, secondaryQty: 0, closingValue: 0 });
        return rows.get(key);
    };

    pobRows.forEach((item) => {
        const target = row(item);
        target.pobValue = money(item.Value);
        target.pobQty = item.Qty ?? 0;
        target.orders = item.Orders ?? 0;
    });

    secondaryRows.forEach((item) => {
        const target = row(item);
        target.secondaryValue = money(item.Value);
        target.secondaryQty = item.Qty ?? item.SalesQty ?? 0;
        target.closingValue = money(item.ClosingValue);
    });

    return [...rows.values()]
        .sort((a, b) => b.secondaryValue + b.pobValue - (a.secondaryValue + a.pobValue))
        .slice(0, TOP);
};

// POB, secondary sales and stock for one month, with a six-month trend.
exports.getBusiness = async (actingUserId, query) => {
    requireActingUser(actingUserId);

    const scope = query.scope === 'team' ? 'team' : 'self';
    const monthStart = toMonthStart(query.month || todayKey().slice(0, 7));
    const fromDate = shiftMonth(monthStart, -(TREND_MONTHS - 1));
    const inputs = { UserId: actingUserId, Scope: scope, FromDate: fromDate, MonthStart: monthStart, ToDate: monthEnd(monthStart) };

    const [pobTrend, secondaryTrend, pobProducts, secondaryProducts, pobStockists, secondaryStockists, customers, hasTeam] = await Promise.all([
        SalesBusinessDA.getPobTrend(inputs),
        SalesBusinessDA.getSecondaryTrend(inputs),
        SalesBusinessDA.getPobProducts(inputs),
        SalesBusinessDA.getSecondaryProducts(inputs),
        SalesBusinessDA.getPobStockists(inputs),
        SalesBusinessDA.getSecondaryStockists(inputs),
        SalesBusinessDA.getTopCustomers(inputs),
        SalesBusinessDA.hasTeam(actingUserId),
    ]);

    const pobByMonth = new Map(pobTrend.map((row) => [row.Month, row]));
    const secondaryByMonth = new Map(secondaryTrend.map((row) => [row.Month, row]));

    const trend = Array.from({ length: TREND_MONTHS }, (_, index) => {
        const month = shiftMonth(fromDate, index);
        const pob = pobByMonth.get(month);
        const secondary = secondaryByMonth.get(month);

        return {
            month,
            pob: money(pob?.Value),
            orders: pob?.Orders || 0,
            supplied: money(pob?.SuppliedValue),
            secondary: money(secondary?.Value),
            secondaryQty: secondary?.SalesQty || 0,
            closing: money(secondary?.ClosingValue),
            statements: secondary?.Statements || 0,
        };
    });

    const current = trend[trend.length - 1];
    const previous = trend[trend.length - 2];

    // Days of secondary sales the closing stock covers.
    const coverDays = current.secondary > 0 ? Math.round((current.closing / current.secondary) * daysInMonth(monthStart)) : null;

    return {
        month: monthStart,
        scope,
        hasTeam,
        kpis: {
            pob: { value: current.pob, orders: current.orders, change: change(current.pob, previous.pob) },
            supplied: { value: current.supplied, rate: current.pob > 0 ? Math.round((current.supplied / current.pob) * 100) : null },
            secondary: { value: current.secondary, units: current.secondaryQty, statements: current.statements, change: change(current.secondary, previous.secondary) },
            stock: { value: current.closing, coverDays },
        },
        trend,
        products: merge(pobProducts, secondaryProducts, 'ProductId', 'ProductName'),
        stockists: merge(pobStockists, secondaryStockists, 'StockistId', 'StockistName'),
        customers: customers.map((row) => ({ ...row, Value: money(row.Value) })),
    };
};
