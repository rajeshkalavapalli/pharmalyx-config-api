const sql = require('./sql');
const { customQuery } = require('../../utils/dbFunctions');

exports.getUser = async (UserId) =>
    (await customQuery(sql.GET_USER(), { UserId }))[0] || null;

exports.getTeam = (ActingUserId) => customQuery(sql.GET_TEAM(), { ActingUserId });

exports.getMyDoctors = (UserId) => customQuery(sql.GET_MY_DOCTORS(), { UserId });
