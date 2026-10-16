const sql = require('./sql');
const { runInTransaction, customQuery } = require('../../utils/dbFunctions');

exports.getDeviations = (filters) => customQuery(sql.GET_DEVIATIONS(), filters);

exports.getDeviationById = async (DeviationId) =>
    (await customQuery(sql.GET_DEVIATION_BY_ID(), { DeviationId }))[0] || null;

exports.getUser = async (UserId) =>
    (await customQuery(sql.GET_USER(), { UserId }))[0] || null;

exports.getPlannedForDate = async (UserId, PlanMonth, PlanDate) =>
    (await customQuery(sql.GET_PLANNED_FOR_DATE(), { UserId, PlanMonth, PlanDate }))[0] || null;

exports.getTerritoryIds = () => customQuery(sql.GET_TERRITORY_IDS());

exports.getAreaTerritories = () => customQuery(sql.GET_AREA_TERRITORIES());

exports.createDeviation = (inputs) =>
    runInTransaction([{ sqlQuery: sql.CREATE_DEVIATION(), inputs }]);

exports.reviewDeviation = (inputs) =>
    runInTransaction([{ sqlQuery: sql.REVIEW_DEVIATION(), inputs }]);
