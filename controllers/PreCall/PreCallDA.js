const sql = require('./sql');
const { customQuery, runInTransaction } = require('../../utils/dbFunctions');

exports.getDayPlan = async (UserId, MonthStart, PlanDate) =>
    (await customQuery(sql.GET_DAY_PLAN(), { UserId, MonthStart, PlanDate }))[0] || null;

exports.getDoctorBriefs = (inputs) => customQuery(sql.GET_DOCTOR_BRIEFS(), inputs);

// Plans are optional until PreCall/schema.sql has been run: a missing table yields null.
exports.getPlans = async (UserId, PlanDate) => {
    try {
        return await customQuery(sql.GET_PLANS(), { UserId, PlanDate });
    } catch (error) {
        if (/Invalid object name/i.test(error.message)) return null;
        throw error;
    }
};

const first = async (promise) => (await promise)[0] || null;

exports.getPlanById = (PreCallId) => first(customQuery(sql.GET_PLAN_BY_ID(), { PreCallId }));

exports.findPlan = (UserId, PlanDate, DoctorId) => first(customQuery(sql.FIND_PLAN(), { UserId, PlanDate, DoctorId }));

exports.nextOrder = async (UserId, PlanDate) =>
    Number((await first(customQuery(sql.NEXT_ORDER(), { UserId, PlanDate })))?.NextOrder) || 1;

exports.isDoctorMapped = async (UserId, DoctorId) =>
    (await customQuery(sql.IS_DOCTOR_MAPPED(), { UserId, DoctorId })).length > 0;

exports.getActiveProductIds = async () =>
    new Set((await customQuery(sql.GET_ACTIVE_PRODUCT_IDS())).map((row) => String(row.ProductId).toLowerCase()));

// Plan row and its products are written together.
exports.savePlan = ({ isNew, plan, productIds }) =>
    runInTransaction([
        { sqlQuery: isNew ? sql.INSERT_PLAN() : sql.UPDATE_PLAN(), inputs: plan },
        { sqlQuery: sql.CLEAR_PRODUCTS(), inputs: { PreCallId: plan.PreCallId } },
        ...productIds.map((ProductId) => ({ sqlQuery: sql.ADD_PRODUCT(), inputs: { PreCallId: plan.PreCallId, ProductId } })),
    ]);

exports.deletePlan = (PreCallId) => runInTransaction([{ sqlQuery: sql.DELETE_PLAN(), inputs: { PreCallId } }]);

exports.setOrder = (UserId, PlanDate, orderedIds) => {
    const Now = new Date();

    return runInTransaction(
        orderedIds.map((PreCallId, index) => ({
            sqlQuery: sql.SET_ORDER(),
            inputs: { PreCallId, CallOrder: index + 1, UserId, PlanDate, Now },
        }))
    );
};
