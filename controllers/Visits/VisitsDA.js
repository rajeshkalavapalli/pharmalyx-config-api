const sql = require('./sql');
const deviationSql = require('../DeviationTourPlan/sql');
const { customQuery, runInTransaction } = require('../../utils/dbFunctions');

const first = async (promise) => (await promise)[0] || null;

exports.getUser = (UserId) => first(customQuery(sql.GET_USER(), { UserId }));

exports.getVisits = (filters) => customQuery(sql.GET_VISITS(), filters);

exports.getVisitById = (VisitId) => first(customQuery(sql.GET_VISIT_BY_ID(), { VisitId }));

exports.getVisitOwner = (VisitId) => first(customQuery(sql.GET_VISIT_OWNER(), { VisitId }));

exports.getOpenFollowUps = (UserId) => customQuery(sql.GET_OPEN_FOLLOW_UPS(), { UserId });

exports.getMappedDoctor = (UserId, DoctorId) =>
    first(customQuery(sql.GET_MAPPED_DOCTOR(), { UserId, DoctorId }));

exports.getPlannedForDate = (UserId, PlanMonth, PlanDate) =>
    first(customQuery(sql.GET_PLANNED_FOR_DATE(), { UserId, PlanMonth, PlanDate }));

exports.getDcrStatus = async (UserId, ReportDate) =>
    (await first(customQuery(sql.GET_DCR_STATUS(), { UserId, ReportDate })))?.Status || null;

exports.findDeviation = (inputs) => first(customQuery(sql.FIND_DEVIATION(), inputs));

// Creates the system-detected deviation (when given), the visit, and any
// stock given during it, all in one transaction.
exports.createVisit = (visit, deviation, extraQueries = []) =>
    runInTransaction([
        ...(deviation ? [{ sqlQuery: deviationSql.CREATE_DEVIATION(), inputs: deviation }] : []),
        { sqlQuery: sql.CREATE_VISIT(), inputs: visit },
        ...extraQueries,
    ]);
