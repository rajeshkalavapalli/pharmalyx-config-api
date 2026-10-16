const sql = require('./sql');
const { customQuery } = require('../../utils/dbFunctions');

exports.getCounts = (inputs) => customQuery(sql.GET_COUNTS(), inputs);

exports.getByDoctor = (inputs) => customQuery(sql.GET_BY_DOCTOR(), inputs);

exports.getAttention = (inputs) => customQuery(sql.GET_ATTENTION(), inputs);
