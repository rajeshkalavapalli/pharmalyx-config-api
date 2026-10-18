
const TourPlanDA = require('./TourPlanDA');

const { generateUUID } = require('../../utils/commonUtils');
const VerifiedWorkDA = require('../VerifiedWork/VerifiedWorkDA');

const AUTO_APPROVED = 'Inside the territory: saved without manager approval.';

const DAY_TYPES = ['working', 'non-working'];

const fail = (status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

const sameId = (a, b) =>
    a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase();

const toMonthStart = (value) => {
    const match = /^(\d{4})-(\d{2})(?:-01)?$/.exec(String(value ?? ''));
    const month = match ? Number(match[2]) : 0;

    if (!match || month < 1 || month > 12) {
        throw fail(400, 'PlanMonth must be in YYYY-MM format.');
    }

    return `${match[1]}-${match[2]}-01`;
};

const daysInMonth = (monthStart) => {
    const year = Number(monthStart.slice(0, 4));
    const month = Number(monthStart.slice(5, 7));
    const count = new Date(Date.UTC(year, month, 0)).getUTCDate();

    return Array.from({ length: count }, (_, i) =>
        `${monthStart.slice(0, 8)}${String(i + 1).padStart(2, '0')}`
    );
};

const getStatuses = async () => {
    const rows = await TourPlanDA.getStatusLovs();
    const statuses = {};

    for (const row of rows) {
        const key = [row.SystemLovDetailCode, row.SystemLovDetailName]
            .map((v) => String(v ?? '').toUpperCase())
            .map((v) => (v === 'SUBMITTED FOR APPROVAL' ? 'SUBMITTED' : v))
            .find((v) => ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'].includes(v));

        if (key && !statuses[key]) {
            statuses[key] = row.SystemLovDetailId;
        }
    }

    for (const key of ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']) {
        if (!statuses[key]) {
            throw fail(500, `Tour plan status "${key}" is missing in SystemLovDetails.`);
        }
    }

    return statuses;
};

exports.getStatuses = getStatuses;

// Every planned field day must be in the MR's own territory. Work elsewhere needs head office:
// special duty (any area that day) or leave cover (the covered colleague's areas).
const assertInsideTerritory = async (userId, details) => {
    const own = await VerifiedWorkDA.myAreas(userId);
    if (!own.length) return; // territory not set up yet: nothing to check against

    const ownIds = new Set(own.map((area) => String(area.AreaId).toLowerCase()));
    const outside = details.filter((detail) => detail.DayType === 'working' && detail.AreaId && !ownIds.has(String(detail.AreaId).toLowerCase()));

    for (const detail of outside) {
        const exceptions = await VerifiedWorkDA.activeExceptions(userId, detail.PlanDate);
        if (exceptions.some((e) => e.ExceptionType === 'SPECIAL_DUTY')) continue;

        const covers = exceptions.filter((e) => e.ExceptionType === 'COVER' && e.CoverUserId);
        let covered = false;
        for (const cover of covers) {
            const areas = await VerifiedWorkDA.myAreas(cover.CoverUserId);
            if (areas.some((area) => String(area.AreaId).toLowerCase() === String(detail.AreaId).toLowerCase())) covered = true;
        }
        if (!covered) {
            throw fail(400, `${detail.PlanDate} is outside your territory. Work outside the territory needs special duty or leave cover from head office.`);
        }
    }
};

const statusKey = (statuses, statusId) =>
    Object.keys(statuses).find((key) => sameId(statuses[key], statusId)) || null;

const requireActingUser = (actingUserId) => {
    if (!actingUserId) {
        throw fail(401, 'Acting user is required.');
    }
};

const normalizeDetails = async (monthStart, rawDetails, submit) => {
    if (!Array.isArray(rawDetails)) {
        throw fail(400, 'Tour plan date details are required.');
    }

    const validDates = new Set(daysInMonth(monthStart));
    const seen = new Set();

    const [territories, areas] = await Promise.all([
        TourPlanDA.getTerritoryIds(),
        TourPlanDA.getAreaTerritories(),
    ]);

    const territoryIds = new Set(territories.map((t) => String(t.TerritoryId).toLowerCase()));
    const areaTerritory = new Map(
        areas.map((a) => [String(a.AreaId).toLowerCase(), String(a.TerritoryId).toLowerCase()])
    );

    const details = rawDetails.map((detail) => {
        const planDate = String(detail?.PlanDate ?? '').slice(0, 10);

        if (!validDates.has(planDate)) {
            throw fail(400, `Date ${planDate || '(empty)'} is not in the plan month.`);
        }

        if (seen.has(planDate)) {
            throw fail(400, `Duplicate entry for ${planDate}.`);
        }

        seen.add(planDate);

        if (!DAY_TYPES.includes(detail.DayType)) {
            throw fail(400, `Invalid day type for ${planDate}.`);
        }

        const remarks = String(detail.Remarks ?? '').trim();

        if (remarks.length > 200) {
            throw fail(400, `Remarks for ${planDate} cannot exceed 200 characters.`);
        }

        if (detail.DayType === 'non-working') {
            return {
                PlanDate: planDate,
                DayType: detail.DayType,
                TerritoryId: null,
                AreaId: null,
                Remarks: remarks || null,
            };
        }

        const territoryId = detail.TerritoryId || null;
        const areaId = detail.AreaId || null;

        if (areaId && !territoryId) {
            throw fail(400, `Select a territory before an area for ${planDate}.`);
        }

        if (territoryId && !territoryIds.has(String(territoryId).toLowerCase())) {
            throw fail(400, `Unknown territory for ${planDate}.`);
        }

        if (areaId) {
            const owner = areaTerritory.get(String(areaId).toLowerCase());

            if (!owner || owner !== String(territoryId).toLowerCase()) {
                throw fail(400, `Area does not belong to the selected territory for ${planDate}.`);
            }
        }

        if (submit && (!territoryId || !areaId)) {
            throw fail(400, `Territory and area are required for ${planDate}.`);
        }

        return {
            PlanDate: planDate,
            DayType: detail.DayType,
            TerritoryId: territoryId,
            AreaId: areaId,
            Remarks: remarks || null,
        };
    });

    if (submit) {
        const missing = [...validDates].filter((date) => !seen.has(date));

        if (missing.length > 0) {
            throw fail(400, `Every date must be planned before submitting. Missing: ${missing.length} date(s).`);
        }
    }

    return details;
};

const mapDbError = (err) => {
    const status = { 50001: 409, 50002: 409, 50003: 409 }[err.number];
    return status ? fail(status, err.message) : err;
};

exports.getTourPlan = async (actingUserId, userId, planMonth) => {
    requireActingUser(actingUserId);

    const targetUserId = userId || actingUserId;
    const monthStart = toMonthStart(planMonth);
    const [plan, statuses, ownerRow] = await Promise.all([
        TourPlanDA.getTourPlanByUserMonth(targetUserId, monthStart),
        getStatuses(),
        TourPlanDA.getOwner(targetUserId),
    ]);

    if (!ownerRow) {
        throw fail(404, 'User not found.');
    }

    // Only the owner or their reporting manager may see a plan.
    if (!sameId(targetUserId, actingUserId) && !sameId(ownerRow.ManagerId, actingUserId)) {
        throw fail(403, 'You are not allowed to view this tour plan.');
    }

    const owner = {
        UserId: ownerRow.UserId,
        Name: ownerRow.Name,
        DesignationName: ownerRow.DesignationName,
        ManagerId: ownerRow.ManagerId,
        ManagerName: ownerRow.ManagerId ? ownerRow.ManagerName : null,
        isSelf: sameId(ownerRow.UserId, actingUserId),
    };

    if (!plan) {
        return { plan: null, owner };
    }

    const isOwner = sameId(plan.UserId, actingUserId);
    const isManager = sameId(plan.ManagerId, actingUserId);

    if (!isOwner && !isManager) {
        throw fail(403, 'You are not allowed to view this tour plan.');
    }

    const details = await TourPlanDA.getTourPlanDetails(plan.TourPlanId);
    const status = statusKey(statuses, plan.StatusId);

    return {
        plan: {
            TourPlanId: plan.TourPlanId,
            UserId: plan.UserId,
            PlanMonth: monthStart,
            StatusId: plan.StatusId,
            Status: status,
            CreatedOn: plan.CreatedOn,
            ModifiedOn: plan.ModifiedOn,
            SubmittedOn: plan.SubmittedOn,
            ReviewedOn: plan.ReviewedOn,
            ReviewedByName: plan.ReviewedByName || null,
            ReviewRemarks: plan.ReviewRemarks,
            details,
            canEdit: isOwner,
            canApprove: isManager && !isOwner && status === 'SUBMITTED',
        },
        owner,
    };
};

// =========================================================
// MANAGER: direct reports' plans for a month
// =========================================================

const REVIEW_ORDER = { SUBMITTED: 0, REJECTED: 1, DRAFT: 2, NEW: 3, APPROVED: 4 };

exports.getTeamPlans = async (actingUserId, planMonth) => {
    requireActingUser(actingUserId);

    const monthStart = toMonthStart(planMonth);
    const totalDays = daysInMonth(monthStart).length;
    const [rows, statuses] = await Promise.all([
        TourPlanDA.getTeamPlans(actingUserId, monthStart),
        getStatuses(),
    ]);

    const plans = rows
        .map((row) => {
            const status = row.TourPlanId ? statusKey(statuses, row.StatusId) || 'DRAFT' : 'NEW';

            return {
                UserId: row.UserId,
                Name: row.Name,
                DesignationName: row.DesignationName,
                TourPlanId: row.TourPlanId || null,
                Status: status,
                DaysPlanned: Number(row.DaysPlanned) || 0,
                WorkingDays: Number(row.WorkingDays) || 0,
                TotalDays: totalDays,
                SubmittedOn: row.SubmittedOn,
                ReviewedOn: row.ReviewedOn,
                canApprove: status === 'SUBMITTED',
            };
        })
        .sort((a, b) => REVIEW_ORDER[a.Status] - REVIEW_ORDER[b.Status] || a.Name.localeCompare(b.Name));

    const count = (status) => plans.filter((plan) => plan.Status === status).length;

    return {
        month: monthStart,
        summary: {
            reports: plans.length,
            awaitingReview: count('SUBMITTED'),
            approved: count('APPROVED'),
            returned: count('REJECTED'),
            inProgress: count('DRAFT') + count('NEW'),
        },
        plans,
    };
};

// =========================================================
// HISTORY: a user's recent months (self, or a direct report)
// =========================================================

exports.getPlanHistory = async (actingUserId, userId) => {
    requireActingUser(actingUserId);

    const targetUserId = userId || actingUserId;

    if (!sameId(targetUserId, actingUserId)) {
        const target = await TourPlanDA.getUser(targetUserId);

        if (!target || !sameId(target.ManagerId, actingUserId)) {
            throw fail(403, 'You are not allowed to view these tour plans.');
        }
    }

    const [rows, statuses] = await Promise.all([TourPlanDA.getPlanHistory(targetUserId), getStatuses()]);

    return {
        history: rows.map((row) => ({
            TourPlanId: row.TourPlanId,
            PlanMonth: row.PlanMonth,
            Status: statusKey(statuses, row.StatusId) || 'DRAFT',
            DaysPlanned: Number(row.DaysPlanned) || 0,
            TotalDays: daysInMonth(row.PlanMonth).length,
            SubmittedOn: row.SubmittedOn,
            ReviewedOn: row.ReviewedOn,
            ReviewedByName: row.ReviewedByName,
            ReviewRemarks: row.ReviewRemarks,
        })),
    };
};

// Saving inside the territory approves the plan straight away: the MR may plan, swap days and
// visit any doctor of their territory without manager approval. Drafts can still be kept.
exports.saveTourPlan = async (actingUserId, tourPlanPayload) => {
    requireActingUser(actingUserId);

    if (tourPlanPayload.UserId && !sameId(tourPlanPayload.UserId, actingUserId)) {
        throw fail(403, 'You can only save your own tour plan.');
    }

    const submit = tourPlanPayload.Submit === true;
    const monthStart = toMonthStart(tourPlanPayload.PlanMonth);
    const details = await normalizeDetails(monthStart, tourPlanPayload.details, submit);
    await assertInsideTerritory(actingUserId, details);

    const statuses = await getStatuses();
    const existing = await TourPlanDA.getTourPlanByUserMonth(actingUserId, monthStart);
    const now = new Date();

    try {
        if (!existing) {
            const TourPlanId = generateUUID();

            await TourPlanDA.createTourPlan({
                TourPlanId,
                UserId: actingUserId,
                PlanMonth: monthStart,
                StatusId: submit ? statuses.APPROVED : statuses.DRAFT,
                SubmittedOn: submit ? now : null,
                CreatedOn: now,
                ModifiedOn: null,
                details,
            });

            return { TourPlanId, Status: submit ? 'APPROVED' : 'DRAFT', message: submit ? AUTO_APPROVED : 'Draft saved.' };
        }

        const current = statusKey(statuses, existing.StatusId);

        // A plan already in use (approved, or waiting under the old approval flow) stays approved when changed.
        if (submit || (current !== 'DRAFT' && current !== 'REJECTED')) {
            await TourPlanDA.replaceOwnPlan({ TourPlanId: existing.TourPlanId, StatusId: statuses.APPROVED, Now: now, Remarks: AUTO_APPROVED, details });
            return { TourPlanId: existing.TourPlanId, Status: 'APPROVED', message: AUTO_APPROVED };
        }

        await TourPlanDA.updateTourPlan({
            TourPlanId: existing.TourPlanId,
            StatusId: statuses.DRAFT,
            DraftStatusId: statuses.DRAFT,
            RejectedStatusId: statuses.REJECTED,
            SubmittedOn: null,
            ModifiedOn: now,
            details,
        });

        return { TourPlanId: existing.TourPlanId, Status: 'DRAFT', message: 'Draft saved.' };
    } catch (err) {
        throw mapDbError(err);
    }
};

const decide = async (actingUserId, tourPlanId, outcome, remarks) => {
    requireActingUser(actingUserId);

    const reviewRemarks = String(remarks ?? '').trim();

    if (reviewRemarks.length > 1000) {
        throw fail(400, 'Remarks cannot exceed 1000 characters.');
    }

    if (outcome === 'REJECTED' && !reviewRemarks) {
        throw fail(400, 'Remarks are required when rejecting a tour plan.');
    }

    const plan = await TourPlanDA.getTourPlanById(tourPlanId);

    if (!plan) {
        throw fail(404, 'Tour plan not found.');
    }

    if (sameId(plan.UserId, actingUserId) || !sameId(plan.ManagerId, actingUserId)) {
        throw fail(403, 'Only the reporting manager can approve or reject this plan.');
    }

    const statuses = await getStatuses();

    if (statusKey(statuses, plan.StatusId) !== 'SUBMITTED') {
        throw fail(409, 'Only submitted plans can be approved or rejected.');
    }

    try {
        await TourPlanDA.transitionStatus({
            TourPlanId: plan.TourPlanId,
            FromStatusId: statuses.SUBMITTED,
            StatusId: statuses[outcome],
            ModifiedOn: new Date(),
            ReviewedBy: actingUserId,
            ReviewRemarks: reviewRemarks || null,
        });
    } catch (err) {
        throw mapDbError(err);
    }

    return { TourPlanId: plan.TourPlanId, Status: outcome };
};

exports.approveTourPlan = (actingUserId, tourPlanId, remarks) =>
    decide(actingUserId, tourPlanId, 'APPROVED', remarks);

exports.rejectTourPlan = (actingUserId, tourPlanId, remarks) =>
    decide(actingUserId, tourPlanId, 'REJECTED', remarks);