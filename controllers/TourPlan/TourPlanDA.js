
const sql = require('./sql');
const deviationSql = require('../DeviationTourPlan/sql');
const { runInTransaction, customQuery } = require('../../utils/dbFunctions');

// The app says "non-working"; the database (CK_TourPlanDetails_DayType) stores "non_working".
// Reads turn it back with REPLACE(DayType, '_', '-').
const toDbDayType = (dayType) => (dayType === 'non-working' ? 'non_working' : dayType);

// Whether TourPlanDetails has the JointWithUserId column (joint work in the tour plan).
// Until the column is added, plans save and read exactly as before; "not yet" is checked again
// every few minutes, so the feature switches on without a restart once the column exists.
const RECHECK_MS = 5 * 60 * 1000;
let jointColumn = null; // { at, value: Promise<boolean> }
const hasJointColumn = () => {
    if (!jointColumn || (jointColumn.known === false && Date.now() - jointColumn.at > RECHECK_MS)) {
        const entry = { at: Date.now(), known: null };
        entry.value = customQuery(sql.HAS_JOINT_COLUMN())
            .then((rows) => {
                entry.known = rows[0]?.Size != null;
                return entry.known;
            })
            .catch(() => {
                entry.known = false;
                return false;
            });
        jointColumn = entry;
    }
    return jointColumn.value;
};
exports.hasJointColumn = hasJointColumn;

const detailQueries = (tourPlanId, details, now, withJoint) =>
    details.map((detail) => ({
        sqlQuery: sql.CREATE_TOUR_PLAN_DETAILS(withJoint),
        inputs: {
            ...detail,
            ...(withJoint ? { JointWithUserId: detail.JointWithUserId || null } : {}),
            DayType: toDbDayType(detail.DayType),
            TourPlanId: tourPlanId,
            CreatedOn: now,
            ModifiedOn: null,
        },
    }));

exports.getStatusLovs = () => customQuery(sql.GET_STATUS_LOVS());

exports.getUser = async (UserId) =>
    (await customQuery(sql.GET_USER(), { UserId }))[0] || null;

exports.getTourPlanByUserMonth = async (UserId, PlanMonth) =>
    (await customQuery(sql.GET_TOUR_PLAN_BY_USER_MONTH(), { UserId, PlanMonth }))[0] || null;

exports.getTourPlanById = async (TourPlanId) =>
    (await customQuery(sql.GET_TOUR_PLAN_BY_ID(), { TourPlanId }))[0] || null;

exports.getTourPlanDetails = async (TourPlanId) =>
    customQuery(sql.GET_TOUR_PLAN_DETAILS(await hasJointColumn()), { TourPlanId });

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
        ...detailQueries(header.TourPlanId, details, header.CreatedOn, await hasJointColumn()),
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
        ...detailQueries(TourPlanId, details, ModifiedOn, await hasJointColumn()),
    ]);
};

// Replaces the plan's days and marks it approved (inside the territory: no manager approval needed).
exports.replaceOwnPlan = async ({ TourPlanId, StatusId, Now, Remarks, details }) => {
    const withJoint = await hasJointColumn();
    return runInTransaction([
        { sqlQuery: sql.APPROVE_OWN_PLAN(), inputs: { TourPlanId, StatusId, Now, Remarks } },
        { sqlQuery: sql.DELETE_TOUR_PLAN_DETAILS(), inputs: { TourPlanId } },
        ...detailQueries(TourPlanId, details, Now, withJoint),
    ]);
};

exports.resubmitOwnPlan = async ({ TourPlanId, StatusId, Now, details }) => {
    const withJoint = await hasJointColumn();
    return runInTransaction([
        { sqlQuery: sql.RESUBMIT_OWN_PLAN(), inputs: { TourPlanId, StatusId, Now } },
        { sqlQuery: sql.DELETE_TOUR_PLAN_DETAILS(), inputs: { TourPlanId } },
        ...detailQueries(TourPlanId, details, Now, withJoint),
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

// ---------------------------------------------------------
// Joint work in the tour plan
// ---------------------------------------------------------

exports.isInTeam = async (UserId, ManagerId) => Boolean((await customQuery(sql.IS_IN_TEAM(), { UserId, ManagerId }))[0]?.InTeam);
exports.memberDays = (UserId, PlanMonth) => customQuery(sql.MEMBER_DAYS(), { UserId, PlanMonth });
exports.memberLeave = (UserId, From, To) => customQuery(sql.MEMBER_LEAVE(), { UserId, From, To });
exports.locks = (UserId, From, To) => customQuery(sql.LOCKS(), { UserId, From, To });

// The senior's plan joint days for a month: keep / add the planned ones, drop the rest.
exports.syncPlanJointDays = ({ ColleagueUserId, From, To, days, Now, newId }) =>
    runInTransaction([
        {
            sqlQuery: sql.REMOVE_PLAN_JOINT_DAYS(),
            inputs: { ColleagueUserId, From, To, Keep: JSON.stringify(days.map((day) => ({ u: day.UserId, d: day.WorkDate }))) },
        },
        ...days.map((day) => ({ sqlQuery: sql.PLAN_JOINT_DAY(), inputs: { JointWorkId: newId(), UserId: day.UserId, ColleagueUserId, WorkDate: day.WorkDate, Now } })),
    ]);

exports.changeMemberDay = ({ change, deviation, approval }) =>
    runInTransaction([
        { sqlQuery: sql.CHANGE_MEMBER_DAY(), inputs: change },
        { sqlQuery: deviationSql.CREATE_DEVIATION(), inputs: deviation },
        { sqlQuery: sql.APPROVE_DEVIATION(), inputs: approval },
    ]);
