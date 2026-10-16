const sql = require('./sql');
const VisitsDA = require('../Visits/VisitsDA');
const { customQuery } = require('../../utils/dbFunctions');

const first = async (promise) => (await promise)[0] || null;

exports.getUser = (UserId) => first(customQuery(sql.GET_USER(), { UserId }));

exports.getKpis = (inputs) => first(customQuery(sql.GET_KPIS(), inputs));

exports.getVisitDays = (UserId, FromDate, ToDate) =>
    customQuery(sql.GET_VISIT_DAYS(), { UserId, FromDate, ToDate });

exports.getDcrDates = (UserId, FromDate, ToDate) =>
    customQuery(sql.GET_DCR_DATES(), { UserId, FromDate, ToDate });

exports.getTodayPlan = (UserId, MonthStart, Today) =>
    first(customQuery(sql.GET_TODAY_PLAN(), { UserId, MonthStart, Today }));

exports.getMonthPlanStatus = async (UserId, MonthStart) =>
    (await first(customQuery(sql.GET_MONTH_PLAN_STATUS(), { UserId, MonthStart })))?.Status || null;

exports.getTodayDcr = async (UserId, Today) =>
    (await first(customQuery(sql.GET_TODAY_DCR(), { UserId, Today })))?.Status || null;

exports.getApprovals = (UserId) => first(customQuery(sql.GET_APPROVALS(), { UserId }));

exports.getTeam = (UserId, MonthStart, MonthEnd) =>
    customQuery(sql.GET_TEAM(), { UserId, MonthStart, MonthEnd });

// Reused from Visits so the dashboard matches the Visits page exactly.
exports.getRecentVisits = (UserId, FromDate, ToDate) =>
    VisitsDA.getVisits({ UserId, FromDate, ToDate, DoctorId: null });

exports.getOpenFollowUps = (UserId) => VisitsDA.getOpenFollowUps(UserId);

// Optional sections: a missing table (schema not run yet) yields null, not an error.
const optional = async (promise) => {
    try {
        return await promise;
    } catch {
        return null;
    }
};

const optionalFirst = async (promise) => {
    const rows = await optional(promise);
    return rows ? rows[0] || {} : null;
};

exports.getStockSummary = (UserId, MonthStart, MonthEnd, LowStock) =>
    optionalFirst(customQuery(sql.GET_STOCK_SUMMARY(), { UserId, MonthStart, MonthEnd, LowStock }));

exports.getBusinessSummary = (UserId, MonthStart) =>
    optionalFirst(customQuery(sql.GET_BUSINESS_SUMMARY(), { UserId, MonthStart }));

exports.getRcpaSummary = (UserId, MonthStart, MonthEnd) =>
    optionalFirst(customQuery(sql.GET_RCPA_SUMMARY(), { UserId, MonthStart, MonthEnd }));

exports.getFeedbackSummary = (UserId, MonthStart, MonthEnd) =>
    customQuery(sql.GET_FEEDBACK_SUMMARY(), { UserId, MonthStart, MonthEnd });

exports.getCoverageByCategory = (UserId, MonthStart, MonthEnd) =>
    customQuery(sql.GET_COVERAGE_BY_CATEGORY(), { UserId, MonthStart, MonthEnd });

exports.getMonthlyVisits = (UserId, FromDate, ToDate) =>
    customQuery(sql.GET_MONTHLY_VISITS(), { UserId, FromDate, ToDate });

exports.getTeamVisitDays = (UserId, FromDate, ToDate) =>
    customQuery(sql.GET_TEAM_VISIT_DAYS(), { UserId, FromDate, ToDate });

exports.getTeamToday = (UserId, Today, MonthStart, MonthEnd) =>
    first(customQuery(sql.GET_TEAM_TODAY(), { UserId, Today, MonthStart, MonthEnd }));

exports.getTeamBusiness = (UserId, MonthStart) =>
    optionalFirst(customQuery(sql.GET_TEAM_BUSINESS(), { UserId, MonthStart }));

exports.getTeamSamples = (UserId, MonthStart, MonthEnd) =>
    optionalFirst(customQuery(sql.GET_TEAM_SAMPLES(), { UserId, MonthStart, MonthEnd }));
