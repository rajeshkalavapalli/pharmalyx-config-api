const PreCallDA = require('./PreCallDA');

const { generateUUID } = require('../../utils/commonUtils');
const { fail, isGuid, optionalText, requireActingUser, resolveViewUser, sameId, todayKey, toDateKey } = require('../../utils/access');

const RCPA_LOOKBACK_DAYS = 90;
const NOT_SEEN_DAYS = 30;
const OCCASION_DAYS = 7;

// Priority points. Higher = meet first. Follow-ups outrank everything.
const POINTS = {
    followUpOverdue: 50,
    followUpDue: 40,
    category: { A: 30, B: 20, C: 10 },
    targetRemaining: 15,
    notSeen: 10,
    neverVisited: 12,
    occasion: 8,
};

const MUST_MEET_SCORE = 40;

const addDays = (key, days) => {
    const date = new Date(`${key}T00:00:00`);
    date.setDate(date.getDate() + days);
    return todayKey(date);
};

const daysBetween = (from, to) =>
    Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000);

const monthEnd = (monthStart) => {
    const date = new Date(`${monthStart}T00:00:00`);
    return todayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
};

// Days from the plan date to the next yearly occurrence of a birthday/anniversary.
const daysToOccasion = (dateKey, planDate) => {
    if (!dateKey) return null;

    const plan = new Date(`${planDate}T00:00:00`);
    const [, month, day] = dateKey.split('-').map(Number);
    let next = new Date(plan.getFullYear(), month - 1, day);

    if (next < plan) next = new Date(plan.getFullYear() + 1, month - 1, day);

    return Math.round((next - plan) / 86400000);
};

const number = (value) => (value == null ? null : Number(value));

const brief = (row, plan, planDate) => {
    const reasons = [];
    const talkingPoints = [];
    let score = 0;

    // Follow-ups
    if (row.FollowUpDate && row.FollowUpDate <= planDate) {
        const overdue = daysBetween(row.FollowUpDate, planDate);

        if (overdue > 0) {
            score += POINTS.followUpOverdue;
            reasons.push({ code: 'FOLLOW_UP', label: `Follow-up overdue ${overdue} day${overdue === 1 ? '' : 's'}`, tone: 'error' });
        } else {
            score += POINTS.followUpDue;
            reasons.push({ code: 'FOLLOW_UP', label: 'Follow-up due today', tone: 'warning' });
        }
    }

    // Category
    if (POINTS.category[row.Category]) {
        score += POINTS.category[row.Category];
        reasons.push({ code: 'CATEGORY', label: `Class ${row.Category}`, tone: row.Category === 'A' ? 'primary' : 'info' });
    }

    // Monthly visit target
    const target = number(row.VisitsPerMonth);
    const done = number(row.VisitsThisMonth) || 0;

    if (target && done < target) {
        score += POINTS.targetRemaining;
        reasons.push({ code: 'TARGET', label: `${target - done} of ${target} visits left this month`, tone: 'info' });
    }

    // Recency
    if (!row.LastVisitDate) {
        score += POINTS.neverVisited;
        reasons.push({ code: 'NEW', label: 'Not visited yet', tone: 'secondary' });
    } else {
        const since = daysBetween(row.LastVisitDate, planDate);

        if (since >= NOT_SEEN_DAYS) {
            score += POINTS.notSeen;
            reasons.push({ code: 'NOT_SEEN', label: `Not seen for ${since} days`, tone: 'warning' });
        }
    }

    // Occasions
    const birthday = daysToOccasion(row.DateOfBirth, planDate);
    const anniversary = daysToOccasion(row.AnniversaryDate, planDate);
    const occasion = [
        birthday != null && birthday <= OCCASION_DAYS && { label: birthday === 0 ? 'Birthday today' : `Birthday in ${birthday} days`, days: birthday },
        anniversary != null && anniversary <= OCCASION_DAYS && { label: anniversary === 0 ? 'Anniversary today' : `Anniversary in ${anniversary} days`, days: anniversary },
    ].filter(Boolean).sort((a, b) => a.days - b.days)[0];

    if (occasion) {
        score += POINTS.occasion;
        reasons.push({ code: 'OCCASION', label: occasion.label, tone: 'success' });
        talkingPoints.push(`${occasion.label}: a good moment for a personal greeting.`);
    }

    // Talking points from history
    if (row.LastFeedback === 'NEGATIVE') {
        talkingPoints.push('Last call was negative. Start by addressing the concerns noted last time.');
    } else if (row.LastFeedback === 'NEUTRAL') {
        talkingPoints.push('Last call was neutral. Bring clinical evidence or a patient case to move them forward.');
    }

    if (row.FollowUpDate && row.FollowUpDate <= planDate) {
        talkingPoints.push(`Close the follow-up set on ${row.LastVisitDate}.`);
    }

    const ours = number(row.RcpaOurs) || 0;
    const theirs = number(row.RcpaTheirs) || 0;
    const share = ours + theirs ? Math.round((ours / (ours + theirs)) * 100) : null;

    if (share != null && share < 50) {
        talkingPoints.push(
            `Our prescription share is ${share}%${row.RcpaTopCompetitor ? `; ${row.RcpaTopCompetitor} is leading` : ''}. Reinforce our differentiators.`
        );
    }

    const expected = number(row.BusinessExpected);
    const actual = number(row.BusinessActual);

    if (expected && (actual ?? 0) < expected) {
        talkingPoints.push(`Business is at ${Math.round(((actual ?? 0) / expected) * 100)}% of this month's expectation.`);
    }

    const inPlanArea = Boolean(
        plan &&
            plan.DayType === 'working' &&
            (plan.AreaId ? sameId(plan.AreaId, row.AreaId) : sameId(plan.TerritoryId, row.TerritoryId))
    );

    return {
        DoctorId: row.DoctorId,
        DoctorName: row.DoctorName,
        Qualification: row.Qualification,
        Speciality: row.Speciality,
        HospitalName: row.HospitalName,
        MobileNumber: row.MobileNumber,
        Category: row.Category,
        TerritoryName: row.TerritoryName,
        AreaName: row.AreaName,
        inPlanArea,
        visitedOnDay: (number(row.VisitsOnDay) || 0) > 0,
        score,
        mustMeet: score >= MUST_MEET_SCORE,
        reasons,
        talkingPoints,
        lastVisit: row.LastVisitDate
            ? {
                  date: row.LastVisitDate,
                  feedback: row.LastFeedback,
                  notes: row.LastNotes,
                  itemsGiven: row.LastItemsGiven,
              }
            : null,
        followUpDate: row.FollowUpDate,
        visits: { done, target },
        rcpa: share == null ? null : { share, ours, theirs, topCompetitor: row.RcpaTopCompetitor },
        business: expected == null ? null : { expected, actual },
    };
};

const byPriority = (a, b) =>
    Number(a.visitedOnDay) - Number(b.visitedOnDay) || b.score - a.score || a.DoctorName.localeCompare(b.DoctorName);

exports.getDay = async (actingUserId, query) => {
    const userId = await resolveViewUser(actingUserId, query.userId, 'pre-call plans');
    const planDate = query.date ? toDateKey(query.date, 'Date') : todayKey();
    const monthStart = `${planDate.slice(0, 8)}01`;

    const [plan, rows, callPlans] = await Promise.all([
        PreCallDA.getDayPlan(userId, monthStart, planDate),
        PreCallDA.getDoctorBriefs({
            UserId: userId,
            PlanDate: planDate,
            MonthStart: monthStart,
            MonthEnd: monthEnd(monthStart),
            RcpaFrom: addDays(planDate, -RCPA_LOOKBACK_DAYS),
        }),
        PreCallDA.getPlans(userId, planDate),
    ]);

    const plansByDoctor = new Map((callPlans || []).map((p) => [String(p.DoctorId).toLowerCase(), p]));

    const briefs = rows.map((row) => {
        const callPlan = plansByDoctor.get(String(row.DoctorId).toLowerCase());

        return {
            ...brief(row, plan, planDate),
            callPlan: callPlan
                ? {
                      PreCallId: callPlan.PreCallId,
                      order: callPlan.CallOrder,
                      objective: callPlan.Objective,
                      keyMessages: callPlan.KeyMessages,
                      status: callPlan.Status,
                      productIds: callPlan.ProductIds ? callPlan.ProductIds.split(',') : [],
                      productNames: callPlan.ProductNames || '',
                  }
                : null,
        };
    });

    // The rep's own call plan, in their chosen order.
    const myPlan = briefs.filter((doctor) => doctor.callPlan).sort((a, b) => a.callPlan.order - b.callPlan.order);
    const planned = briefs.filter((doctor) => doctor.inPlanArea).sort(byPriority);
    // Follow-ups due outside the planned area are still worth knowing about.
    const followUpsElsewhere = briefs
        .filter((doctor) => !doctor.inPlanArea && doctor.followUpDate && doctor.followUpDate <= planDate)
        .sort(byPriority);
    // Everyone else, ranked the same way (the whole list when there's no plan for the day).
    const others = briefs
        .filter((doctor) => !doctor.inPlanArea && !followUpsElsewhere.includes(doctor))
        .sort(byPriority);

    return {
        date: planDate,
        plan: plan
            ? {
                  dayType: plan.DayType,
                  territoryName: plan.TerritoryName,
                  areaName: plan.AreaName,
                  remarks: plan.Remarks,
                  status: plan.PlanStatus,
              }
            : null,
        plansEnabled: callPlans !== null,
        canPlan: sameId(userId, actingUserId) && planDate >= todayKey(),
        myPlan,
        summary: {
            plannedCalls: myPlan.length,
            plannedVisited: myPlan.filter((doctor) => doctor.callPlan.status === 'VISITED').length,
            toMeet: planned.length,
            mustMeet: planned.filter((doctor) => doctor.mustMeet && !doctor.visitedOnDay).length,
            visited: planned.filter((doctor) => doctor.visitedOnDay).length,
            followUpsDue: briefs.filter((doctor) => doctor.followUpDate && doctor.followUpDate <= planDate && !doctor.visitedOnDay).length,
            assignedDoctors: briefs.length,
        },
        planned,
        followUpsElsewhere,
        others,
    };
};

// =========================================================
// CALL PLANS (own plans, today or later)
// =========================================================

const MAX_PLAN_AHEAD_DAYS = 31;
const MAX_PRODUCTS = 10;

const mapDbError = (error) => (error.number === 50041 ? fail(409, error.message) : error);

const requirePlanDate = (value) => {
    const planDate = toDateKey(value, 'Plan date');
    const today = todayKey();

    if (planDate < today) throw fail(400, 'Calls can only be planned for today or later.');
    if (planDate > addDays(today, MAX_PLAN_AHEAD_DAYS)) {
        throw fail(400, `Calls can be planned at most ${MAX_PLAN_AHEAD_DAYS} days ahead.`);
    }

    return planDate;
};

exports.savePlan = async (actingUserId, payload) => {
    requireActingUser(actingUserId);

    const planDate = requirePlanDate(payload.PlanDate);

    if (!isGuid(payload.DoctorId)) throw fail(400, 'Doctor is required.');

    const objective = String(payload.Objective ?? '').trim();

    if (!objective) throw fail(400, 'Write the objective for this call.');
    if (objective.length > 500) throw fail(400, 'Objective cannot exceed 500 characters.');

    const keyMessages = optionalText(payload.KeyMessages, 1000, 'Key messages');

    const rawProducts = Array.isArray(payload.ProductIds) ? payload.ProductIds : [];
    const productIds = [...new Set(rawProducts.map((id) => String(id).toLowerCase()))];

    if (productIds.length > MAX_PRODUCTS) throw fail(400, `Choose at most ${MAX_PRODUCTS} products.`);

    const [mapped, activeProducts, existing] = await Promise.all([
        PreCallDA.isDoctorMapped(actingUserId, payload.DoctorId),
        PreCallDA.getActiveProductIds(),
        PreCallDA.findPlan(actingUserId, planDate, payload.DoctorId),
    ]);

    if (!mapped) throw fail(400, 'This doctor is not assigned to you.');
    if (productIds.some((id) => !isGuid(id) || !activeProducts.has(id))) {
        throw fail(400, 'Choose products from the active catalogue.');
    }
    if (existing?.Status === 'VISITED') {
        throw fail(409, 'This call has already been visited, so its plan can no longer change.');
    }

    const plan = {
        PreCallId: existing?.PreCallId || generateUUID(),
        UserId: actingUserId,
        PlanDate: planDate,
        DoctorId: payload.DoctorId,
        CallOrder: existing ? undefined : await PreCallDA.nextOrder(actingUserId, planDate),
        Objective: objective,
        KeyMessages: keyMessages,
        Now: new Date(),
    };

    if (existing) delete plan.CallOrder;

    try {
        await PreCallDA.savePlan({ isNew: !existing, plan, productIds });
    } catch (error) {
        throw mapDbError(error);
    }

    return { message: existing ? 'Call plan updated.' : 'Added to your call plan.', PreCallId: plan.PreCallId };
};

exports.deletePlan = async (actingUserId, preCallId) => {
    requireActingUser(actingUserId);

    if (!isGuid(preCallId)) throw fail(400, 'Plan is invalid.');

    const plan = await PreCallDA.getPlanById(preCallId);

    if (!plan || !sameId(plan.UserId, actingUserId)) throw fail(404, 'Planned call not found.');

    try {
        await PreCallDA.deletePlan(preCallId);
    } catch (error) {
        throw mapDbError(error);
    }

    return { message: 'Removed from your call plan.' };
};

exports.reorder = async (actingUserId, payload) => {
    requireActingUser(actingUserId);

    const planDate = requirePlanDate(payload.PlanDate);
    const order = Array.isArray(payload.Order) ? payload.Order : [];
    const current = (await PreCallDA.getPlans(actingUserId, planDate)) || [];
    const currentIds = new Set(current.map((p) => String(p.PreCallId).toLowerCase()));

    if (order.length !== current.length || order.some((id) => !currentIds.has(String(id).toLowerCase()))) {
        throw fail(400, 'The new order must list every planned call for the day exactly once.');
    }

    await PreCallDA.setOrder(actingUserId, planDate, order);

    return { message: 'Call order saved.' };
};
