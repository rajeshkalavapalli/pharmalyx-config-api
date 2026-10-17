const sql = require('./sql');
const { customQuery, runInTransaction } = require('../../utils/dbFunctions');

const first = async (promise) => (await promise)[0] || null;
const rowsAffected = (result) => (Array.isArray(result) ? result[0] || 0 : 0);

exports.getPlan = (UserId, Month) => first(customQuery(sql.GET_PLAN(), { UserId, Month }));

exports.getPlanById = (PlanId) => first(customQuery(sql.GET_PLAN_BY_ID(), { PlanId }));

exports.getPlanDoctors = (PlanId) => customQuery(sql.GET_PLAN_DOCTORS(), { PlanId });

exports.getPlanProducts = (PlanId) => customQuery(sql.GET_PLAN_PRODUCTS(), { PlanId });

exports.getMyDoctors = (UserId) => customQuery(sql.GET_MY_DOCTORS(), { UserId });

exports.isDoctorMapped = async (UserId, DoctorId) => (await customQuery(sql.IS_DOCTOR_MAPPED(), { UserId, DoctorId })).length > 0;

exports.getProducts = () => customQuery(sql.GET_ORDERABLE_PRODUCTS());

exports.getActualVisits = (UserId, Month, MonthEnd) => customQuery(sql.GET_ACTUAL_VISITS(), { UserId, Month, MonthEnd });

exports.getRxUnits = (UserId, Month, MonthEnd) => customQuery(sql.GET_RX_UNITS(), { UserId, Month, MonthEnd });

exports.getPobUnits = (UserId, Month, MonthEnd) => customQuery(sql.GET_POB_UNITS(), { UserId, Month, MonthEnd });

exports.createPlan = (inputs) => customQuery(sql.CREATE_PLAN(), inputs);

// Replaces one doctor's plan (or removes it when `doctor` is null), only while the plan is editable.
exports.saveDoctor = (lock, doctorKey, doctor, products) =>
    runInTransaction([
        { sqlQuery: sql.LOCK_CHECK(), inputs: lock },
        { sqlQuery: sql.DELETE_DOCTOR(), inputs: doctorKey },
        ...(doctor
            ? [
                  { sqlQuery: sql.INSERT_DOCTOR(), inputs: doctor },
                  ...products.map((product) => ({ sqlQuery: sql.INSERT_PRODUCT(), inputs: product })),
              ]
            : []),
    ]);

exports.submitPlan = async (inputs) => rowsAffected(await customQuery(sql.SUBMIT_PLAN(), inputs));

exports.reviewPlan = async (inputs) => rowsAffected(await customQuery(sql.REVIEW_PLAN(), inputs));

exports.getReviews = (UserId) => customQuery(sql.GET_REVIEWS(), { UserId });

exports.hasTeam = async (UserId) => (await customQuery(sql.HAS_TEAM(), { UserId })).length > 0;
