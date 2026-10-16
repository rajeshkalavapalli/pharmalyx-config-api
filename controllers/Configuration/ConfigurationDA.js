const sql = require('./sql');
const { customQuery } = require('../../utils/dbFunctions');

exports.getSummary = async () => (await customQuery(sql.GET_SUMMARY()))[0] || {};
