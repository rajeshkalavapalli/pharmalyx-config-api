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
