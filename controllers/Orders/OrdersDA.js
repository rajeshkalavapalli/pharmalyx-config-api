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

// Header and lines (and any extra steps, e.g. pinning the chemist, the audit row) are saved together or not at all.
exports.createOrder = (order, lines, extra = []) =>
    runInTransaction([
        { sqlQuery: sql.CREATE_ORDER(), inputs: order },
        ...lines.map((line) => ({ sqlQuery: sql.CREATE_LINE(), inputs: line })),
        ...extra,
    ]);

exports.pinPharmacyQuery = (inputs) => ({ sqlQuery: sql.PIN_PHARMACY(), inputs });

exports.verifyOrder = async (inputs) => {
    const result = await customQuery(sql.VERIFY_ORDER(), inputs);
    return Array.isArray(result) ? result[0] || 0 : 0;
};

exports.followUpDue = (UserId, Days) => customQuery(sql.FOLLOW_UP_DUE(), { UserId, Days });

// Returns the number of rows changed (0 when the status moved on meanwhile).
exports.updateStatus = async (inputs) => {
    const result = await customQuery(sql.UPDATE_STATUS(), inputs);
    return Array.isArray(result) ? result[0] || 0 : 0;
};
