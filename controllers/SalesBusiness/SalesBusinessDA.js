const sql = require('./sql');
const { customQuery } = require('../../utils/dbFunctions');

exports.getPobTrend = (inputs) => customQuery(sql.POB_TREND(), inputs);

exports.getSecondaryTrend = (inputs) => customQuery(sql.SECONDARY_TREND(), inputs);

exports.getPobProducts = (inputs) => customQuery(sql.POB_PRODUCTS(), inputs);

exports.getSecondaryProducts = (inputs) => customQuery(sql.SECONDARY_PRODUCTS(), inputs);

exports.getPobStockists = (inputs) => customQuery(sql.POB_STOCKISTS(), inputs);

exports.getSecondaryStockists = (inputs) => customQuery(sql.SECONDARY_STOCKISTS(), inputs);

exports.getTopCustomers = (inputs) => customQuery(sql.TOP_CUSTOMERS(), inputs);

exports.hasTeam = async (UserId) => (await customQuery(sql.HAS_TEAM(), { UserId })).length > 0;
