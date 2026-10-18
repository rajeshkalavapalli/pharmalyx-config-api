const sql = require('./sql');
const { customQuery, runInTransaction } = require('../../utils/dbFunctions');

exports.getBalances = (UserId, ItemType, MonthStart) =>
    customQuery(sql.GET_BALANCES(), { UserId, ItemType, MonthStart });

exports.getLedger = (inputs) => customQuery(sql.GET_LEDGER(), inputs);

exports.getVisitItems = (VisitId) => customQuery(sql.GET_VISIT_ITEMS(), { VisitId });

exports.itemExists = async (ItemType, ItemId) =>
    (await customQuery(sql.ITEM_EXISTS(), { ItemType, ItemId })).length > 0;

exports.addEntry = (inputs) => runInTransaction([{ sqlQuery: sql.ADD_ENTRY(), inputs }]);

exports.removeEntry = (inputs) => runInTransaction([{ sqlQuery: sql.REMOVE_ENTRY(), inputs }]);

// Query objects for callers that write stock inside their own transaction (Visits).
exports.removeEntryQuery = (inputs) => ({ sqlQuery: sql.REMOVE_ENTRY(), inputs });
exports.giveEntryQuery = (inputs) => ({ sqlQuery: sql.GIVE_ENTRY(), inputs });
exports.getReconciliation = (UserId) => customQuery(sql.RECONCILIATION(), { UserId });
exports.getItemBalance = async (inputs) => Number((await customQuery(sql.ITEM_BALANCE(), inputs))[0]?.Balance || 0);
exports.insertCounts = (rows, audit) => runInTransaction([...rows.map((inputs) => ({ sqlQuery: sql.INSERT_COUNT(), inputs })), audit]);
exports.getCountHistory = (UserId) => customQuery(sql.COUNT_HISTORY(), { UserId });
