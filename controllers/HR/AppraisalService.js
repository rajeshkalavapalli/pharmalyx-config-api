const HRDA = require('./HRDA');
const ReportsService = require('../Reports/ReportsService');

const { generateUUID } = require('../../utils/commonUtils');
const { resolveScope } = require('../../utils/reportScope');
const { fail, isGuid, optionalText, requireActingUser, sameId, toDateKey, todayKey } = require('../../utils/access');

const MAX_PERIOD_DAYS = 366;

// Final score = KPI weight % × KPI score + the rest × manager rating (1–5 scaled to 100).
const finalScore = (kpiWeight, kpiScore, managerRating) => {
    const ratingScore = (managerRating / 5) * 100;
    if (kpiScore == null) return Math.round(ratingScore);
    return Math.round((kpiWeight / 100) * kpiScore + ((100 - kpiWeight) / 100) * ratingScore);
};

const parseRating = (value) => {
    const rating = Number(value);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5 || Math.round(rating * 2) !== rating * 2) throw fail(400, 'Rating must be from 1 to 5, in half steps.');
    return rating;
};

const loadCycle = async (cycleId) => {
    if (!isGuid(cycleId)) throw fail(400, 'Cycle is invalid.');
    const cycle = await HRDA.getCycle({ CycleId: cycleId });
    if (!cycle) throw fail(404, 'Appraisal cycle not found.');
    return cycle;
};

// Starts the appraisal row the first time anyone opens it in an open cycle.
const ensureAppraisal = async (cycle, userId) => {
    let appraisal = await HRDA.getAppraisal({ CycleId: cycle.CycleId, UserId: userId });

    if (!appraisal && cycle.Status === 'OPEN') {
        const user = await HRDA.getUser({ UserId: userId });
        await HRDA.createAppraisal({ AppraisalId: generateUUID(), CycleId: cycle.CycleId, UserId: userId, ManagerId: user?.ManagerId || null, Now: new Date() });
        appraisal = await HRDA.getAppraisal({ CycleId: cycle.CycleId, UserId: userId });
    }

    return appraisal;
};

// =========================================================
// READS
// =========================================================

exports.getCycles = async () => ({ cycles: await HRDA.getCycles() });

// The cycle overview: everyone in scope with their status, plus the acting user's own appraisal.
exports.getCycle = async (actingUserId, cycleId) => {
    requireActingUser(actingUserId);
    const cycle = await loadCycle(cycleId);
    const scope = await resolveScope(actingUserId, null);

    const team = await HRDA.getTeamAppraisals({ ...scope, CycleId: cycle.CycleId });

    return {
        cycle,
        people: team.map((row) => ({
            ...row,
            Status: row.Status || 'NOT_STARTED',
            isSelf: sameId(row.UserId, actingUserId),
            isDirectReport: sameId(row.ManagerId, actingUserId),
        })),
    };
};

// One appraisal: self section, manager section and the live KPI scorecard for the period.
exports.getAppraisal = async (actingUserId, cycleId, userId) => {
    requireActingUser(actingUserId);
    const cycle = await loadCycle(cycleId);
    const target = userId || actingUserId;
    await resolveScope(actingUserId, sameId(target, actingUserId) ? null : target);

    const [appraisal, kpi] = await Promise.all([ensureAppraisal(cycle, target), ReportsService.kpiScoreFor(target, cycle.PeriodFrom, cycle.PeriodTo > todayKey() ? todayKey() : cycle.PeriodTo).catch(() => null)]);

    const isSelf = sameId(target, actingUserId);
    const isManager = Boolean(appraisal) && sameId(appraisal.CurrentManagerId, actingUserId) && !isSelf;
    const open = cycle.Status === 'OPEN';
    const periodOver = cycle.PeriodTo < todayKey();

    return {
        cycle,
        appraisal: appraisal && {
            UserId: appraisal.UserId,
            UserName: appraisal.UserName,
            ManagerName: appraisal.ManagerName,
            Status: appraisal.Status,
            SelfRating: appraisal.SelfRating == null ? null : Number(appraisal.SelfRating),
            SelfComments: appraisal.SelfComments,
            SelfSubmittedOn: appraisal.SelfSubmittedOn,
            ManagerRating: appraisal.ManagerRating == null ? null : Number(appraisal.ManagerRating),
            ManagerComments: appraisal.ManagerComments,
            ManagerSubmittedOn: appraisal.ManagerSubmittedOn,
            KpiScore: appraisal.KpiScore,
            FinalScore: appraisal.FinalScore,
        },
        kpi,
        canSelfReview: open && isSelf && appraisal && appraisal.Status !== 'COMPLETED',
        // The manager rates once the self-review is in, or after the period ends if it never came.
        canManagerReview: open && isManager && (appraisal.Status === 'PENDING_MANAGER' || (appraisal.Status === 'PENDING_SELF' && periodOver)),
        isManager,
    };
};

// =========================================================
// WRITES
// =========================================================

exports.saveSelf = async (actingUserId, cycleId, payload) => {
    requireActingUser(actingUserId);
    const cycle = await loadCycle(cycleId);
    if (cycle.Status !== 'OPEN') throw fail(409, 'This appraisal cycle is closed.');

    const appraisal = await ensureAppraisal(cycle, actingUserId);
    if (appraisal.Status === 'COMPLETED') throw fail(409, 'Your manager has already completed this appraisal.');

    const comments = optionalText(payload.Comments, 2000, 'Comments');
    if (!comments) throw fail(400, 'Write a few lines about your achievements and goals.');

    const changed = await HRDA.saveSelf({ CycleId: cycle.CycleId, UserId: actingUserId, Rating: parseRating(payload.Rating), Comments: comments, Now: new Date() });
    if (!changed) throw fail(409, 'This appraisal was updated meanwhile. Refresh and try again.');

    return { message: 'Self-review submitted to your manager.' };
};

exports.saveManager = async (actingUserId, cycleId, userId, payload) => {
    requireActingUser(actingUserId);
    const cycle = await loadCycle(cycleId);
    if (cycle.Status !== 'OPEN') throw fail(409, 'This appraisal cycle is closed.');
    if (!isGuid(userId)) throw fail(400, 'Employee is invalid.');

    const appraisal = await ensureAppraisal(cycle, userId);
    if (!appraisal) throw fail(404, 'Appraisal not found.');
    if (sameId(userId, actingUserId) || !sameId(appraisal.CurrentManagerId, actingUserId)) throw fail(403, 'Only the reporting manager can rate this appraisal.');
    if (appraisal.Status === 'COMPLETED') throw fail(409, 'This appraisal is already completed.');
    if (appraisal.Status === 'PENDING_SELF' && cycle.PeriodTo >= todayKey()) throw fail(409, 'Wait for the self-review, or until the appraisal period ends.');

    const comments = optionalText(payload.Comments, 2000, 'Feedback');
    if (!comments) throw fail(400, 'Write feedback for the employee.');

    const rating = parseRating(payload.Rating);
    const kpi = await ReportsService.kpiScoreFor(userId, cycle.PeriodFrom, cycle.PeriodTo > todayKey() ? todayKey() : cycle.PeriodTo).catch(() => null);
    const kpiScore = kpi?.score ?? null;

    const changed = await HRDA.saveManager({
        CycleId: cycle.CycleId,
        UserId: userId,
        FromStatus: appraisal.Status,
        ManagerId: actingUserId,
        Rating: rating,
        Comments: comments,
        KpiScore: kpiScore,
        FinalScore: finalScore(cycle.KpiWeight, kpiScore, rating),
        Now: new Date(),
    });
    if (!changed) throw fail(409, 'This appraisal was updated meanwhile. Refresh and try again.');

    return { message: `${appraisal.UserName}'s appraisal completed.` };
};

// =========================================================
// ADMIN: cycles
// =========================================================

exports.createCycle = async (actingUserId, payload) => {
    requireActingUser(actingUserId);

    const name = optionalText(payload.Name, 80, 'Name');
    if (!name) throw fail(400, 'Name the cycle, e.g. "Apr–Sep 2026".');

    const from = toDateKey(payload.PeriodFrom, 'Period start');
    const to = toDateKey(payload.PeriodTo, 'Period end');
    if (to < from) throw fail(400, 'Period end must be after the start.');
    if (Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000) >= MAX_PERIOD_DAYS) throw fail(400, 'A cycle can cover at most one year.');

    const weight = Number(payload.KpiWeight ?? 50);
    if (!Number.isInteger(weight) || weight < 0 || weight > 100) throw fail(400, 'KPI weight must be a whole number from 0 to 100.');

    await HRDA.createCycle({ CycleId: generateUUID(), Name: name, PeriodFrom: from, PeriodTo: to, KpiWeight: weight, CreatedBy: actingUserId, Now: new Date() });

    return { message: `${name} opened.` };
};

exports.closeCycle = async (actingUserId, cycleId) => {
    requireActingUser(actingUserId);
    const cycle = await loadCycle(cycleId);
    const changed = await HRDA.closeCycle({ CycleId: cycle.CycleId, Now: new Date() });
    if (!changed) throw fail(409, 'This cycle is already closed.');
    return { message: `${cycle.Name} closed.` };
};

