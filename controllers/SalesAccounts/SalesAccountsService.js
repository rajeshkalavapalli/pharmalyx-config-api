const SalesAccountsDA = require('./SalesAccountsDA');

const { fail, isGuid, requireActingUser, todayKey, toMonthStart } = require('../../utils/access');

const LABEL = { retailer: 'chemist', stockist: 'stockist' };

const monthEnd = (monthStart) => {
    const date = new Date(`${monthStart}T00:00:00`);
    return todayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
};

const monthRange = (month) => {
    const fromDate = toMonthStart(month || todayKey().slice(0, 7));
    return [fromDate, monthEnd(fromDate)];
};

const money = (value) => Number(value || 0);
const sumMoney = (rows, field) => rows.reduce((total, row) => total + Math.round(money(row[field]) * 100), 0) / 100;

const normalize = (row) => ({
    ...row,
    MonthValue: money(row.MonthValue),
    TotalValue: money(row.TotalValue),
    ...(row.PendingValue !== undefined ? { PendingValue: money(row.PendingValue) } : {}),
});

const summarize = (kind, accounts) => ({
    total: accounts.length,
    ordering: accounts.filter((account) => account.MonthOrders > 0).length,
    monthValue: sumMoney(accounts, 'MonthValue'),
    monthOrders: accounts.reduce((total, account) => total + account.MonthOrders, 0),
    ...(kind === 'stockist'
        ? {
              pendingOrders: accounts.reduce((total, account) => total + account.PendingOrders, 0),
              pendingValue: sumMoney(accounts, 'PendingValue'),
          }
        : {
              neverOrdered: accounts.filter((account) => !account.TotalOrders).length,
          }),
});

// Assigned chemists or stockists with this month's and lifetime business.
exports.getAccounts = async (kind, actingUserId, query) => {
    requireActingUser(actingUserId);

    const [fromDate, toDate] = monthRange(query.month);
    const accounts = (await SalesAccountsDA.getAccounts(kind, actingUserId, fromDate, toDate)).map(normalize);

    return { month: fromDate, summary: summarize(kind, accounts), accounts };
};

// One assigned account with its recent orders. Unassigned accounts are not visible.
exports.getAccount = async (kind, actingUserId, accountId, query) => {
    requireActingUser(actingUserId);

    if (!isGuid(accountId)) throw fail(400, `The ${LABEL[kind]} is invalid.`);

    const [fromDate, toDate] = monthRange(query.month);
    const [row] = await SalesAccountsDA.getAccounts(kind, actingUserId, fromDate, toDate, accountId);

    if (!row) throw fail(404, `This ${LABEL[kind]} is not assigned to you.`);

    const orders = await SalesAccountsDA.getRecentOrders(kind, actingUserId, accountId);

    return {
        account: normalize(row),
        orders: orders.map((order) => ({ ...order, NetAmount: money(order.NetAmount) })),
    };
};
