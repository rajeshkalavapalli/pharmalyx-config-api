const sql = require('./sql');
const { customQuery, runInTransaction } = require('../../utils/dbFunctions');

exports.getTargets = (UserId, Month) => customQuery(sql.GET_TARGETS(), { UserId, Month });

exports.getSecondary = (UserId, Month) => customQuery(sql.GET_SECONDARY(), { UserId, Month });

exports.getPobSupplied = (UserId, Month, MonthEnd) => customQuery(sql.GET_POB_SUPPLIED(), { UserId, Month, MonthEnd });

exports.getPricedProducts = () => customQuery(sql.GET_PRICED_PRODUCTS());

exports.getTeam = (UserId, Month, MonthEnd) => customQuery(sql.GET_TEAM(), { UserId, Month, MonthEnd });

exports.getUser = async (UserId) => (await customQuery(sql.GET_USER(), { UserId }))[0] || null;

// The month's targets are replaced together or not at all.
exports.replaceTargets = (UserId, Month, targets) =>
    runInTransaction([
        { sqlQuery: sql.DELETE_TARGETS(), inputs: { UserId, Month } },
        ...targets.map((target) => ({ sqlQuery: sql.INSERT_TARGET(), inputs: target })),
    ]);
