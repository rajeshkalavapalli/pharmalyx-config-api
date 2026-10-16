const sql = require('./sql');
const { customQuery, runInTransaction } = require('../../utils/dbFunctions');

exports.getMonth = (UserId, BusinessMonth, PreviousMonth) =>
    customQuery(sql.GET_MONTH(), { UserId, BusinessMonth, PreviousMonth });

exports.getHistory = (UserId, FromMonth, ToMonth) => customQuery(sql.GET_HISTORY(), { UserId, FromMonth, ToMonth });

exports.isDoctorMapped = async (UserId, DoctorId) =>
    (await customQuery(sql.IS_DOCTOR_MAPPED(), { UserId, DoctorId })).length > 0;

exports.upsert = (inputs) => runInTransaction([{ sqlQuery: sql.UPSERT(), inputs }]);
