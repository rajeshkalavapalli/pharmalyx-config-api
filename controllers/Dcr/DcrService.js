const DcrDA = require('./DcrDA');

const { generateUUID } = require('../../utils/commonUtils');

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TRAVEL_MODES = ['BIKE', 'CAR', 'BUS', 'TRAIN', 'AUTO', 'OTHER'];
const MAX_DISTANCE_KM = 2000;

// A day's DCR can be sent on that day or the next one.
const DEADLINE_DAYS = 1;

const fail = (status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

const sameId = (a, b) =>
    a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase();

const blank = (value) => value == null || value === '';

const requireActingUser = (actingUserId) => {
    if (!actingUserId || !GUID.test(actingUserId)) {
        throw fail(401, 'Acting user is required.');
    }
};

const localDateKey = (date = new Date()) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const addDays = (key, days) => {
    const date = new Date(`${key}T00:00:00`);
    date.setDate(date.getDate() + days);
    return localDateKey(date);
};

const toIsoDate = (value, label) => {
    const text = String(value ?? '').slice(0, 10);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    const date = match ? new Date(Date.UTC(+match[1], +match[2] - 1, +match[3])) : null;

    if (!date || date.toISOString().slice(0, 10) !== text) {
        throw fail(400, `${label} must be in YYYY-MM-DD format.`);
    }

    return text;
};

const toMonthStart = (value) => {
    const match = /^(\d{4})-(0[1-9]|1[0-2])(?:-01)?$/.exec(String(value ?? ''));

    if (!match) {
        throw fail(400, 'Month must be in YYYY-MM format.');
    }

    return `${match[1]}-${match[2]}-01`;
};

const monthDays = (monthStart) => {
    const [year, month] = monthStart.split('-').map(Number);
    const count = new Date(year, month, 0).getDate();

    return Array.from({ length: count }, (_, i) => `${monthStart.slice(0, 8)}${String(i + 1).padStart(2, '0')}`);
};

const lastDayToSubmit = (reportDate) => addDays(reportDate, DEADLINE_DAYS);

const mapDbError = (err) => {
    if (err.number === 2627 || err.number === 2601) {
        return fail(409, 'A DCR has already been submitted for this date.');
    }

    if (err.number === 50021 || err.number === 50022) {
        return fail(409, err.message);
    }

    return err;
};

// A user sees their own DCRs; a manager also sees direct reports'.
const resolveTarget = async (actingUserId, userId) => {
    if (!blank(userId) && !GUID.test(String(userId))) {
        throw fail(400, 'User is invalid.');
    }

    const targetUserId = blank(userId) ? actingUserId : String(userId);

    if (!sameId(targetUserId, actingUserId)) {
        const target = await DcrDA.getUser(targetUserId);

        if (!target || !sameId(target.ManagerId, actingUserId)) {
            throw fail(403, "You can only view your own or your team's DCRs.");
        }
    }

    return targetUserId;
};

// SUBMITTED / APPROVED / RETURNED come from the DCR itself; the rest are derived.
const dayStatus = ({ date, today, plan, visitCount, dcr }) => {
    if (dcr) return dcr.Status;
    if (date > today) return 'UPCOMING';
    if (plan?.DayType === 'non-working' && !visitCount) return 'OFF';

    const worked = visitCount > 0 || plan?.DayType === 'working';

    if (!worked) return 'NO_ACTIVITY';

    return today <= lastDayToSubmit(date) ? 'DUE' : 'MISSED';
};

const toPlan = (row) =>
    row
        ? { DayType: row.DayType, TerritoryName: row.TerritoryName, AreaName: row.AreaName }
        : null;

// =========================================================
// QUERIES
// =========================================================

exports.getMonth = async (actingUserId, query) => {
    requireActingUser(actingUserId);

    const userId = await resolveTarget(actingUserId, query.userId);
    const monthStart = toMonthStart(query.month || localDateKey().slice(0, 7));
    const dates = monthDays(monthStart);
    const from = dates[0];
    const to = dates[dates.length - 1];
    const today = localDateKey();

    const [dcrs, visitDays, planDays] = await Promise.all([
        DcrDA.getDcrsInRange(userId, from, to),
        DcrDA.getVisitDays(userId, from, to),
        DcrDA.getPlanDays(userId, from, to),
    ]);

    const dcrByDate = new Map(dcrs.map((row) => [row.ReportDate, row]));
    const visitsByDate = new Map(visitDays.map((row) => [row.VisitDate, row.VisitCount]));
    const planByDate = new Map(planDays.map((row) => [row.PlanDate, row]));

    const days = dates.map((date) => {
        const dcr = dcrByDate.get(date) || null;
        const visitCount = visitsByDate.get(date) || 0;
        const plan = toPlan(planByDate.get(date));

        return {
            date,
            status: dayStatus({ date, today, plan, visitCount, dcr }),
            visitCount,
            plan,
            dcrId: dcr?.DcrId || null,
            distanceKm: dcr ? Number(dcr.DistanceKm) : null,
        };
    });

    const count = (status) => days.filter((day) => day.status === status).length;

    return {
        month: monthStart,
        deadlineDays: DEADLINE_DAYS,
        days,
        summary: {
            submitted: count('SUBMITTED'),
            approved: count('APPROVED'),
            returned: count('RETURNED'),
            due: count('DUE'),
            missed: count('MISSED'),
            distanceKm: days.reduce((sum, day) => sum + (day.distanceKm || 0), 0),
        },
    };
};

exports.getDay = async (actingUserId, query) => {
    requireActingUser(actingUserId);

    const userId = await resolveTarget(actingUserId, query.userId);
    const date = toIsoDate(query.date, 'Date');
    const today = localDateKey();

    const [dcr, visits, planDays] = await Promise.all([
        DcrDA.getDcrForDate(userId, date),
        DcrDA.getVisitsForDate(userId, date),
        DcrDA.getPlanDays(userId, date, date),
    ]);

    const plan = toPlan(planDays[0]);
    const status = dayStatus({ date, today, plan, visitCount: visits.length, dcr });
    const isOwner = sameId(userId, actingUserId);

    let blockedReason = null;

    if (!isOwner) blockedReason = 'Only the representative can submit their DCR.';
    else if (status === 'SUBMITTED' || status === 'APPROVED') blockedReason = 'This DCR has already been submitted.';
    else if (date > today) blockedReason = 'You can only submit a DCR on or after the day.';
    else if (status !== 'RETURNED' && today > lastDayToSubmit(date)) blockedReason = 'The deadline to submit this DCR has passed.';
    else if (visits.length === 0) blockedReason = 'Log at least one visit before submitting the DCR.';

    return {
        date,
        status,
        deadline: lastDayToSubmit(date),
        plan,
        visits,
        dcr: dcr
            ? {
                  ...dcr,
                  DistanceKm: Number(dcr.DistanceKm),
                  canReview: sameId(dcr.ManagerId, actingUserId) && !isOwner && dcr.Status === 'SUBMITTED',
              }
            : null,
        canSubmit: !blockedReason,
        blockedReason,
    };
};

exports.getPendingReviews = async (actingUserId) => {
    requireActingUser(actingUserId);

    const rows = await DcrDA.getPendingReviews(actingUserId);

    return rows.map((row) => ({ ...row, DistanceKm: Number(row.DistanceKm) }));
};

// =========================================================
// SUBMIT / RESUBMIT
// =========================================================

exports.submitDcr = async (actingUserId, payload) => {
    requireActingUser(actingUserId);

    const reportDate = toIsoDate(payload.ReportDate, 'Report date');
    const today = localDateKey();

    if (reportDate > today) {
        throw fail(400, 'You can only submit a DCR on or after the day.');
    }

    const workStart = String(payload.WorkStartTime ?? '');
    const workEnd = String(payload.WorkEndTime ?? '');

    if (!TIME.test(workStart) || !TIME.test(workEnd)) {
        throw fail(400, 'Work start and end times are required (HH:mm).');
    }

    if (workEnd <= workStart) {
        throw fail(400, 'Work end time must be after the start time.');
    }

    const travelMode = String(payload.TravelMode ?? '').toUpperCase();

    if (!TRAVEL_MODES.includes(travelMode)) {
        throw fail(400, 'Choose a travel mode.');
    }

    const distance = Number(payload.DistanceKm);

    if (blank(payload.DistanceKm) || !Number.isFinite(distance) || distance < 0 || distance > MAX_DISTANCE_KM) {
        throw fail(400, `Distance must be between 0 and ${MAX_DISTANCE_KM} km.`);
    }

    const remarks = String(payload.Remarks ?? '').trim();

    if (remarks.length > 1000) {
        throw fail(400, 'Remarks cannot exceed 1000 characters.');
    }

    const [user, existing, visits] = await Promise.all([
        DcrDA.getUser(actingUserId),
        DcrDA.getDcrForDate(actingUserId, reportDate),
        DcrDA.getVisitsForDate(actingUserId, reportDate),
    ]);

    if (!user) {
        throw fail(404, 'User not found.');
    }

    if (!user.ManagerId) {
        throw fail(400, 'No reporting manager is assigned, so the DCR cannot be submitted.');
    }

    if (existing && existing.Status !== 'RETURNED') {
        throw fail(409, 'A DCR has already been submitted for this date.');
    }

    if (!existing && today > lastDayToSubmit(reportDate)) {
        throw fail(400, 'The deadline to submit this DCR has passed.');
    }

    if (visits.length === 0) {
        throw fail(400, 'Log at least one visit before submitting the DCR.');
    }

    const inputs = {
        WorkStartTime: workStart,
        WorkEndTime: workEnd,
        TravelMode: travelMode,
        DistanceKm: Math.round(distance * 10) / 10,
        Remarks: remarks || null,
        VisitCount: visits.length,
        SubmittedOn: new Date(),
    };

    try {
        if (existing) {
            await DcrDA.resubmitDcr({ ...inputs, DcrId: existing.DcrId });
            return { DcrId: existing.DcrId, Status: 'SUBMITTED', resubmitted: true };
        }

        const DcrId = generateUUID();

        await DcrDA.createDcr({ ...inputs, DcrId, UserId: actingUserId, ReportDate: reportDate });

        return { DcrId, Status: 'SUBMITTED', resubmitted: false };
    } catch (err) {
        throw mapDbError(err);
    }
};

// =========================================================
// REVIEW
// =========================================================

exports.reviewDcr = async (actingUserId, dcrId, outcome, remarks) => {
    requireActingUser(actingUserId);

    if (!GUID.test(String(dcrId))) {
        throw fail(400, 'DCR id is invalid.');
    }

    const dcr = await DcrDA.getDcrById(dcrId);

    if (!dcr) {
        throw fail(404, 'DCR not found.');
    }

    if (sameId(dcr.UserId, actingUserId) || !sameId(dcr.ManagerId, actingUserId)) {
        throw fail(403, 'Only the reporting manager can review this DCR.');
    }

    if (dcr.Status !== 'SUBMITTED') {
        throw fail(409, 'This DCR has already been reviewed.');
    }

    const reviewRemarks = String(remarks ?? '').trim();

    if (reviewRemarks.length > 1000) {
        throw fail(400, 'Remarks cannot exceed 1000 characters.');
    }

    if (outcome === 'RETURNED' && !reviewRemarks) {
        throw fail(400, 'Tell the representative why the DCR is being returned.');
    }

    try {
        await DcrDA.reviewDcr({
            DcrId: dcr.DcrId,
            Status: outcome,
            ReviewedBy: actingUserId,
            ReviewedOn: new Date(),
            ReviewRemarks: reviewRemarks || null,
        });
    } catch (err) {
        throw mapDbError(err);
    }

    return { DcrId: dcr.DcrId, Status: outcome };
};

exports.DEADLINE_DAYS = DEADLINE_DAYS;
