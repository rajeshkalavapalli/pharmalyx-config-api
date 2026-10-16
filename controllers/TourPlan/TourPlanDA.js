
const sql = require('./sql');
const { runInTransaction, customQuery } = require('../../utils/dbFunctions');

const detailQueries = (tourPlanId, details, now) =>
    details.map((detail) => ({
        sqlQuery: sql.CREATE_TOUR_PLAN_DETAILS(),
        inputs: { ...detail, TourPlanId: tourPlanId, CreatedOn: now, ModifiedOn: null },
    }));

exports.getStatusLovs = () => customQuery(sql.GET_STATUS_LOVS());

exports.getUser = async (UserId) =>
    (await customQuery(sql.GET_USER(), { UserId }))[0] || null;

exports.getTourPlanByUserMonth = async (UserId, PlanMonth) =>
    (await customQuery(sql.GET_TOUR_PLAN_BY_USER_MONTH(), { UserId, PlanMonth }))[0] || null;

exports.getTourPlanById = async (TourPlanId) =>
    (await customQuery(sql.GET_TOUR_PLAN_BY_ID(), { TourPlanId }))[0] || null;

exports.getTourPlanDetails = (TourPlanId) =>
    customQuery(sql.GET_TOUR_PLAN_DETAILS(), { TourPlanId });

exports.getTerritoryIds = () => customQuery(sql.GET_TERRITORY_IDS());

exports.getAreaTerritories = () => customQuery(sql.GET_AREA_TERRITORIES());

exports.createTourPlan = async (tourPlanData) => {
    const { details, ...header } = tourPlanData;

    return await runInTransaction([
        {
            sqlQuery: sql.ASSERT_NO_PLAN_FOR_MONTH(),
            inputs: { UserId: header.UserId, PlanMonth: header.PlanMonth },
        },
        { sqlQuery: sql.CREATE_TOUR_PLAN(), inputs: header },
        ...detailQueries(header.TourPlanId, details, header.CreatedOn),
    ]);
};

exports.updateTourPlan = async ({
    TourPlanId,
    StatusId,
    DraftStatusId,
    RejectedStatusId,
    SubmittedOn,
    ModifiedOn,
    details,
}) => {
    return await runInTransaction([
        {
            sqlQuery: sql.UPDATE_EDITABLE_TOUR_PLAN(),
            inputs: { TourPlanId, StatusId, DraftStatusId, RejectedStatusId, SubmittedOn, ModifiedOn },
        },
        {
            sqlQuery: sql.DELETE_TOUR_PLAN_DETAILS(),
            inputs: { TourPlanId },
        },
        ...detailQueries(TourPlanId, details, ModifiedOn),
    ]);
};

exports.transitionStatus = async (inputs) =>
    await runInTransaction([
        { sqlQuery: sql.TRANSITION_TOUR_PLAN_STATUS(), inputs },
    ]);

exports.getOwner = async (UserId) =>
    (await customQuery(sql.GET_OWNER(), { UserId }))[0] || null;

exports.getTeamPlans = (ManagerId, PlanMonth) =>
    customQuery(sql.GET_TEAM_PLANS(), { ManagerId, PlanMonth });

exports.getPlanHistory = (UserId) => customQuery(sql.GET_PLAN_HISTORY(), { UserId });
