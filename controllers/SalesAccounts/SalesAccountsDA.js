const sql = require('./sql');
const { customQuery } = require('../../utils/dbFunctions');

const LIST_SQL = { retailer: sql.GET_RETAILERS, stockist: sql.GET_STOCKISTS };

exports.getAccounts = (kind, UserId, FromDate, ToDate, Id = null) =>
    customQuery(LIST_SQL[kind](), { UserId, FromDate, ToDate, Id });

exports.getRecentOrders = (kind, UserId, Id) => customQuery(sql.GET_RECENT_ORDERS(), { Kind: kind, UserId, Id });
