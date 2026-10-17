const DoctorPlanDA = require('./DoctorPlanDA');

const { generateUUID } = require('../../utils/commonUtils');
const { getPermissions } = require('../../utils/permissions');
const { fail, isGuid, optionalText, requireActingUser, resolveViewUser, sameId, todayKey, toMonthStart } = require('../../utils/access');

// Plans can be prepared for the current month and the next one.
const MONTHS_AHEAD = 1;
const MAX_VISITS = 31;
const MAX_UNITS = 100000;
const MAX_PRODUCTS = 15;
const EDITABLE = ['DRAFT', 'RETURNED'];

const lower = (value) => String(value).toLowerCase();
const percent = (actual, planned) => (planned > 0 ? Math.round((actual / planned) * 100) : null);

const currentMonth = () => `${todayKey().slice(0, 7)}-01`;

const shiftMonth = (monthStart, delta) => {
    const date = new Date(`${monthStart}T00:00:00`);
    return todayKey(new Date(date.getFullYear(), date.getMonth() + delta, 1));
};

const monthEnd = (monthStart) => {
    const date = new Date(`${monthStart}T00:00:00`);
    return todayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
};

const monthLabel = (monthStart) => new Date(`${monthStart}T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

const windowReason = (month) => {
    if (month < currentMonth()) return 'Plans for past months can no longer be changed.';
    if (month > shiftMonth(currentMonth(), MONTHS_AHEAD)) return 'Plans can be prepared for this month and next month only.';
    return null;
};

const toCount = (value, label, max) => {
    const count = value === '' || value == null ? 0 : Number(value);

    if (!Number.isInteger(count) || count < 0 || count > max) throw fail(400, `${label} must be a whole number between 0 and ${max}.`);

    return count;
};

const groupBy = (rows, field) => {
    const map = new Map();
    rows.forEach((row) => {
        const key = lower(row[field]);
        map.set(key, [...(map.get(key) || []), row]);
    });
    return map;
};

const normalizePlan = (plan) =>
    plan && {
        PlanId: plan.PlanId,
        UserId: plan.UserId,
        UserName: plan.UserName,
        PlanMonth: plan.PlanMonth,
        Status: plan.Status,
        ReviewRemarks: plan.ReviewRemarks,
        SubmittedOn: plan.SubmittedOn,
        ReviewedOn: plan.ReviewedOn,
    };

// Plan vs actual for every doctor mapped to the MR in the month.
const buildPlan = async (userId, month) => {
    const end = monthEnd(month);
    const plan = await DoctorPlanDA.getPlan(userId, month);

    const [doctors, planDoctors, planProducts, visits, rx, pob] = await Promise.all([
        DoctorPlanDA.getMyDoctors(userId),
        plan ? DoctorPlanDA.getPlanDoctors(plan.PlanId) : [],
        plan ? DoctorPlanDA.getPlanProducts(plan.PlanId) : [],
        DoctorPlanDA.getActualVisits(userId, month, end),
        DoctorPlanDA.getRxUnits(userId, month, end),
        DoctorPlanDA.getPobUnits(userId, month, end),
    ]);

    const planByDoctor = new Map(planDoctors.map((row) => [lower(row.DoctorId), row]));
    const productsByDoctor = groupBy(planProducts, 'DoctorId');
    const visitsByDoctor = new Map(visits.map((row) => [lower(row.DoctorId), row.Visits]));
    const rxByDoctor = groupBy(rx, 'DoctorId');
    const pobByDoctor = groupBy(pob, 'DoctorId');

    const rows = doctors.map((doctor) => {
        const key = lower(doctor.DoctorId);
        const planned = planByDoctor.get(key);

        // One line per product that is planned or has actuals.
        const lines = new Map();
        const line = (item) => {
            const productKey = lower(item.ProductId);
            if (!lines.has(productKey)) lines.set(productKey, { ProductId: item.ProductId, ProductName: item.ProductName, plannedUnits: 0, rxUnits: 0, pobUnits: 0 });
            return lines.get(productKey);
        };

        (productsByDoctor.get(key) || []).forEach((item) => (line(item).plannedUnits = item.PlannedUnits));
        (rxByDoctor.get(key) || []).forEach((item) => (line(item).rxUnits = item.Units));
        (pobByDoctor.get(key) || []).forEach((item) => (line(item).pobUnits = item.Units));

        const products = [...lines.values()].sort((a, b) => b.plannedUnits - a.plannedUnits || a.ProductName.localeCompare(b.ProductName));
        const plannedUnits = products.reduce((sum, item) => sum + item.plannedUnits, 0);
        const rxUnits = products.reduce((sum, item) => sum + item.rxUnits, 0);

        return {
            ...doctor,
            planned: Boolean(planned),
            plannedVisits: planned?.PlannedVisits ?? 0,
            support: planned?.Support || null,
            actualVisits: visitsByDoctor.get(key) || 0,
            plannedUnits,
            rxUnits,
            pobUnits: products.reduce((sum, item) => sum + item.pobUnits, 0),
            achievement: percent(rxUnits, plannedUnits),
            products,
        };
    });

    const inPlan = rows.filter((row) => row.planned);
    const sum = (list, field) => list.reduce((total, row) => total + row[field], 0);

    return {
        plan: normalizePlan(plan),
        doctors: rows,
        summary: {
            doctors: rows.length,
            planned: inPlan.length,
            plannedVisits: sum(inPlan, 'plannedVisits'),
            actualVisits: sum(inPlan, 'actualVisits'),
            plannedUnits: sum(inPlan, 'plannedUnits'),
            rxUnits: sum(inPlan, 'rxUnits'),
            pobUnits: sum(inPlan, 'pobUnits'),
            visitPercent: percent(sum(inPlan, 'actualVisits'), sum(inPlan, 'plannedVisits')),
            rxPercent: percent(sum(inPlan, 'rxUnits'), sum(inPlan, 'plannedUnits')),
        },
    };
};

// =========================================================
// READ
// =========================================================

exports.getPlan = async (actingUserId, query) => {
    const userId = await resolveViewUser(actingUserId, query.userId, 'doctor plan');
    const month = toMonthStart(query.month || currentMonth().slice(0, 7));

    const [built, hasTeam, permissions, products] = await Promise.all([
        buildPlan(userId, month),
        DoctorPlanDA.hasTeam(actingUserId),
        getPermissions(actingUserId),
        DoctorPlanDA.getProducts(),
    ]);

    const isSelf = sameId(userId, actingUserId);
    const status = built.plan?.Status || 'NOT_STARTED';
    let blockedReason = isSelf ? windowReason(month) : 'You are viewing a team member\'s plan.';

    if (!blockedReason && status === 'SUBMITTED') blockedReason = 'This plan is waiting for your manager\'s review.';
    if (!blockedReason && status === 'APPROVED') blockedReason = 'This plan is approved.';
    if (!blockedReason && !permissions.has('doctorplan.create')) blockedReason = 'You don\'t have permission to prepare plans.';

    return {
        month,
        isSelf,
        hasTeam,
        status,
        ...built,
        products,
        limits: { maxVisits: MAX_VISITS, maxUnits: MAX_UNITS, maxProducts: MAX_PRODUCTS },
        canEdit: !blockedReason,
        canSubmit: !blockedReason && built.summary.planned > 0,
        blockedReason,
    };
};

exports.getReviews = async (actingUserId) => {
    requireActingUser(actingUserId);

    const rows = await DoctorPlanDA.getReviews(actingUserId);

    return {
        reviews: rows.map((row) => ({ ...normalizePlan(row), Doctors: row.Doctors, PlannedVisits: row.PlannedVisits, PlannedUnits: row.PlannedUnits })),
    };
};

// Full plan for review (manager) or by id.
exports.getPlanById = async (actingUserId, planId) => {
    requireActingUser(actingUserId);

    if (!isGuid(planId)) throw fail(400, 'Plan is invalid.');

    const plan = await DoctorPlanDA.getPlanById(planId);
    if (!plan) throw fail(404, 'Plan not found.');

    if (!sameId(plan.UserId, actingUserId) && !sameId(plan.ManagerId, actingUserId)) {
        throw fail(403, 'Only the MR or their manager can open this plan.');
    }

    const built = await buildPlan(plan.UserId, plan.PlanMonth);

    return {
        ...built,
        doctors: built.doctors.filter((doctor) => doctor.planned),
        canReview: sameId(plan.ManagerId, actingUserId) && plan.Status === 'SUBMITTED',
    };
};

// =========================================================
// WRITE (MR)
// =========================================================

// Save one doctor's plan line. All zeros / empty removes the doctor from the plan.
exports.saveDoctor = async (actingUserId, payload) => {
    requireActingUser(actingUserId);

    const month = toMonthStart(payload.Month);
    const reason = windowReason(month);
    if (reason) throw fail(400, reason);

    if (!isGuid(payload.DoctorId)) throw fail(400, 'Doctor is invalid.');
    if (!(await DoctorPlanDA.isDoctorMapped(actingUserId, payload.DoctorId))) throw fail(403, 'This doctor is not assigned to you.');

    const plannedVisits = toCount(payload.PlannedVisits, 'Planned visits', MAX_VISITS);
    const support = optionalText(payload.Support, 300, 'Support');

    const productIds = new Map((await DoctorPlanDA.getProducts()).map((product) => [lower(product.ProductId), product]));
    const rawProducts = Array.isArray(payload.Products) ? payload.Products : [];
    const seen = new Set();

    const products = rawProducts
        .map((item, index) => {
            const product = isGuid(item?.ProductId) ? productIds.get(lower(item.ProductId)) : null;
            if (!product) throw fail(400, `Product ${index + 1}: choose an active product.`);
            if (seen.has(lower(product.ProductId))) throw fail(400, `${product.ProductName} is listed twice.`);
            seen.add(lower(product.ProductId));

            return { product, units: toCount(item.PlannedUnits, `${product.ProductName} units`, MAX_UNITS) };
        })
        .filter((item) => item.units > 0);

    if (products.length > MAX_PRODUCTS) throw fail(400, `Plan at most ${MAX_PRODUCTS} products per doctor.`);

    const remove = plannedVisits === 0 && products.length === 0 && !support;

    let plan = await DoctorPlanDA.getPlan(actingUserId, month);

    if (plan && !EDITABLE.includes(plan.Status)) throw fail(409, 'This plan has been submitted and can\'t be changed.');
    if (!plan && remove) return { message: 'Nothing to save.' };

    const now = new Date();

    if (!plan) {
        try {
            await DoctorPlanDA.createPlan({ PlanId: generateUUID(), UserId: actingUserId, Month: month, Now: now });
        } catch (error) {
            if (error.number !== 2627 && error.number !== 2601) throw error;
        }
        plan = await DoctorPlanDA.getPlan(actingUserId, month);
    }

    const planDoctorId = generateUUID();

    try {
        await DoctorPlanDA.saveDoctor(
            { PlanId: plan.PlanId, UserId: actingUserId, Now: now },
            { PlanId: plan.PlanId, DoctorId: payload.DoctorId },
            remove ? null : { PlanDoctorId: planDoctorId, PlanId: plan.PlanId, DoctorId: payload.DoctorId, PlannedVisits: plannedVisits, Support: support, Now: now },
            products.map((item) => ({ PlanDoctorId: planDoctorId, ProductId: item.product.ProductId, PlannedUnits: item.units }))
        );
    } catch (error) {
        if (String(error.message).includes('PLAN_LOCKED')) throw fail(409, 'This plan was submitted meanwhile. Refresh to see it.');
        throw error;
    }

    return { message: remove ? 'Doctor removed from the plan.' : 'Doctor plan saved.' };
};

exports.submitPlan = async (actingUserId, payload) => {
    requireActingUser(actingUserId);

    const month = toMonthStart(payload.Month);
    const reason = windowReason(month);
    if (reason) throw fail(400, reason);

    const plan = await DoctorPlanDA.getPlan(actingUserId, month);
    if (!plan) throw fail(400, 'Plan at least one doctor before submitting.');
    if (!EDITABLE.includes(plan.Status)) throw fail(409, 'This plan has already been submitted.');

    const changed = await DoctorPlanDA.submitPlan({ PlanId: plan.PlanId, UserId: actingUserId, Now: new Date() });
    if (!changed) throw fail(400, 'Plan at least one doctor before submitting.');

    return { message: `${monthLabel(month)} doctor plan sent to your manager.` };
};

// =========================================================
// REVIEW (manager)
// =========================================================

exports.reviewPlan = async (actingUserId, planId, outcome, remarks) => {
    requireActingUser(actingUserId);

    if (!isGuid(planId)) throw fail(400, 'Plan is invalid.');

    const plan = await DoctorPlanDA.getPlanById(planId);
    if (!plan) throw fail(404, 'Plan not found.');

    if (!sameId(plan.ManagerId, actingUserId)) throw fail(403, 'Only the reporting manager can review this plan.');
    if (plan.Status !== 'SUBMITTED') throw fail(409, 'Only a submitted plan can be reviewed.');

    const reviewRemarks = optionalText(remarks, 500, 'Remarks');
    if (outcome === 'RETURNED' && !reviewRemarks) throw fail(400, 'Say what needs to change.');

    const changed = await DoctorPlanDA.reviewPlan({ PlanId: plan.PlanId, Status: outcome, ReviewRemarks: reviewRemarks, ReviewedBy: actingUserId, Now: new Date() });
    if (!changed) throw fail(409, 'This plan was updated meanwhile. Refresh and try again.');

    const label = `${plan.UserName}'s ${monthLabel(plan.PlanMonth)} plan`;
    return { message: outcome === 'APPROVED' ? `${label} approved.` : `${label} returned.` };
};
