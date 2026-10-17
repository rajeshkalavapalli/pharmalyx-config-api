const sql = require('./sql');
const { customQuery, runInTransaction } = require('../../utils/dbFunctions');

exports.getOrders = (inputs) => customQuery(sql.GET_ORDERS(), inputs);

exports.getLines = (inputs) => customQuery(sql.GET_LINES(), inputs);

exports.getOrder = async (OrderId) => (await customQuery(sql.GET_ORDER(), { OrderId }))[0] || null;

exports.hasTeam = async (UserId) => (await customQuery(sql.HAS_TEAM(), { UserId })).length > 0;

exports.getMyDoctors = (UserId) => customQuery(sql.GET_MY_DOCTORS(), { UserId });

exports.getMyPharmacies = (UserId) => customQuery(sql.GET_MY_PHARMACIES(), { UserId });

exports.getMyStockists = (UserId) => customQuery(sql.GET_MY_STOCKISTS(), { UserId });

exports.getOrderableProducts = () => customQuery(sql.GET_ORDERABLE_PRODUCTS());

// Header and lines are saved together or not at all.
exports.createOrder = (order, lines) =>
    runInTransaction([
        { sqlQuery: sql.CREATE_ORDER(), inputs: order },
        ...lines.map((line) => ({ sqlQuery: sql.CREATE_LINE(), inputs: line })),
    ]);

// Returns the number of rows changed (0 when the status moved on meanwhile).
exports.updateStatus = async (inputs) => {
    const result = await customQuery(sql.UPDATE_STATUS(), inputs);
    return Array.isArray(result) ? result[0] || 0 : 0;
};
