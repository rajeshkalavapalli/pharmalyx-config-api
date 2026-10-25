const sql = require('./sql');
const { customQuery, runInTransaction } = require('../../utils/dbFunctions');

const first = async (promise) => (await promise)[0] || null;

exports.getUser = (UserId) => first(customQuery(sql.GET_USER(), { UserId }));

exports.getRate = (DesignationId) => (DesignationId ? first(customQuery(sql.GET_RATE(), { DesignationId })) : Promise.resolve(null));

exports.getRates = () => customQuery(sql.GET_RATES());

exports.isDesignation = async (DesignationId) => (await customQuery(sql.IS_DESIGNATION(), { DesignationId })).length > 0;

exports.saveRate = (inputs) => customQuery(sql.UPSERT_RATE(), inputs);

exports.getClaim = (UserId, Month) => first(customQuery(sql.GET_CLAIM(), { UserId, Month }));

exports.getClaimById = (ClaimId) => first(customQuery(sql.GET_CLAIM_BY_ID(), { ClaimId }));

exports.getApprovedDcrs = (UserId, Month, MonthEnd) => customQuery(sql.GET_APPROVED_DCRS(), { UserId, Month, MonthEnd });

exports.getDays = (ClaimId) => customQuery(sql.GET_DAYS(), { ClaimId });

exports.getItems = (ClaimId) => customQuery(sql.GET_ITEMS(), { ClaimId });

exports.createClaim = (inputs) => customQuery(sql.CREATE_CLAIM(), inputs);

const lock = (ClaimId, UserId) => ({ sqlQuery: sql.LOCK_EDITABLE(), inputs: { ClaimId, UserId } });
const recalc = (ClaimId, Now) => ({ sqlQuery: sql.RECALC(), inputs: { ClaimId, Now } });

// Replaces the day rows (DA / TA) and recomputes totals, while the claim is editable.
exports.replaceDays = (ClaimId, UserId, days, Now) =>
    runInTransaction([
        lock(ClaimId, UserId),
        { sqlQuery: sql.DELETE_DAYS(), inputs: { ClaimId } },
        ...days.map((day) => ({ sqlQuery: sql.INSERT_DAY(), inputs: day })),
        recalc(ClaimId, Now),
    ]);

exports.addItem = (ClaimId, UserId, item, Now) =>
    runInTransaction([lock(ClaimId, UserId), { sqlQuery: sql.INSERT_ITEM(), inputs: item }, recalc(ClaimId, Now)]);

exports.deleteItem = (ClaimId, UserId, ItemId, Now) =>
    runInTransaction([lock(ClaimId, UserId), { sqlQuery: sql.DELETE_ITEM(), inputs: { ItemId, ClaimId } }, recalc(ClaimId, Now)]);

exports.insertItemQuery = (item) => ({ sqlQuery: sql.INSERT_ITEM(), inputs: item });

// Final day sync + status change in one go. `extra`: more steps (released lines) in the same transaction.
exports.submit = (ClaimId, UserId, days, ToStatus, Now, extra = []) =>
    runInTransaction([
        lock(ClaimId, UserId),
        { sqlQuery: sql.DELETE_DAYS(), inputs: { ClaimId } },
        ...days.map((day) => ({ sqlQuery: sql.INSERT_DAY(), inputs: day })),
        ...extra,
        recalc(ClaimId, Now),
        { sqlQuery: sql.SUBMIT(), inputs: { ClaimId, ToStatus, Now } },
    ]);

const guard = (ClaimId, FromStatus) => ({ sqlQuery: sql.GUARD_STATUS(), inputs: { ClaimId, FromStatus } });

exports.managerDecision = (ClaimId, FromStatus, decision, days = [], items = []) =>
    runInTransaction([
        guard(ClaimId, FromStatus),
        ...days.map((day) => ({ sqlQuery: sql.APPROVE_DAY(), inputs: { ...day, ClaimId } })),
        ...items.map((item) => ({ sqlQuery: sql.APPROVE_ITEM(), inputs: { ...item, ClaimId } })),
        { sqlQuery: sql.MANAGER_DECISION(), inputs: { ...decision, ClaimId } },
    ]);

exports.financeDecision = (ClaimId, FromStatus, decision) =>
    runInTransaction([guard(ClaimId, FromStatus), { sqlQuery: sql.FINANCE_DECISION(), inputs: { ...decision, ClaimId } }]);

exports.markPaid = (ClaimId, inputs) =>
    runInTransaction([guard(ClaimId, 'APPROVED'), { sqlQuery: sql.MARK_PAID(), inputs: { ...inputs, ClaimId } }]);

exports.getReviews = (UserId) => customQuery(sql.GET_REVIEWS(), { UserId });

exports.getFinance = (Status) => customQuery(sql.GET_FINANCE(), { Status });

exports.hasTeam = async (UserId) => (await customQuery(sql.HAS_TEAM(), { UserId })).length > 0;
