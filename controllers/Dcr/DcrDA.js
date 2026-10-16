const sql = require('./sql');
const visitSql = require('../Visits/sql');
const { customQuery, runInTransaction } = require('../../utils/dbFunctions');

const first = async (promise) => (await promise)[0] || null;

exports.getUser = (UserId) => first(customQuery(sql.GET_USER(), { UserId }));

exports.getDcrsInRange = (UserId, FromDate, ToDate) =>
    customQuery(sql.GET_DCRS_IN_RANGE(), { UserId, FromDate, ToDate });

exports.getDcrForDate = (UserId, ReportDate) =>
    first(customQuery(sql.GET_DCR_FOR_DATE(), { UserId, ReportDate }));

exports.getDcrById = (DcrId) => first(customQuery(sql.GET_DCR_BY_ID(), { DcrId }));

exports.getPendingReviews = (ManagerId) => customQuery(sql.GET_PENDING_REVIEWS(), { ManagerId });

exports.getVisitDays = (UserId, FromDate, ToDate) =>
    customQuery(sql.GET_VISIT_DAYS(), { UserId, FromDate, ToDate });

exports.getPlanDays = (UserId, FromDate, ToDate) =>
    customQuery(sql.GET_PLAN_DAYS(), { UserId, FromDate, ToDate });

// Reuses the Visits module's query so the DCR shows exactly what Visits shows.
exports.getVisitsForDate = (UserId, VisitDate) =>
    customQuery(visitSql.GET_VISITS(), {
        UserId,
        FromDate: VisitDate,
        ToDate: VisitDate,
        DoctorId: null,
    });

exports.createDcr = (inputs) => runInTransaction([{ sqlQuery: sql.CREATE_DCR(), inputs }]);

exports.resubmitDcr = (inputs) => runInTransaction([{ sqlQuery: sql.RESUBMIT_DCR(), inputs }]);

exports.reviewDcr = (inputs) => runInTransaction([{ sqlQuery: sql.REVIEW_DCR(), inputs }]);
