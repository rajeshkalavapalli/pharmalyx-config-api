const VisitsDA = require('./VisitsDA');
const StockService = require('../Stock/StockService');

const { generateUUID } = require('../../utils/commonUtils');

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const FEEDBACK = ['POSITIVE', 'NEUTRAL', 'NEGATIVE'];
const LOCATION_STATUSES = ['CAPTURED', 'DENIED', 'UNAVAILABLE', 'NOT_CAPTURED'];
const MAX_BACKDATE_DAYS = 31;
const MAX_RANGE_DAYS = 366;
const SYSTEM_SOURCE = 'System Detected';

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

const optionalGuid = (value, label) => {
    if (blank(value)) return null;

    if (!GUID.test(String(value))) {
        throw fail(400, `${label} is invalid.`);
    }

    return String(value);
};

// Server-local calendar date as YYYY-MM-DD.
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

const optionalTime = (value, label) => {
    if (blank(value)) return null;

    if (!TIME.test(String(value))) {
        throw fail(400, `${label} must be in HH:mm format.`);
    }

    return String(value);
};

const optionalTimestamp = (value) => {
    if (blank(value)) return null;

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
};

const daysBetween = (fromKey, toKey) =>
    Math.round((new Date(`${toKey}T00:00:00`) - new Date(`${fromKey}T00:00:00`)) / 86400000);

// A user sees their own visits; a manager also sees direct reports'.
const assertCanView = async (actingUserId, targetUserId) => {
    if (sameId(targetUserId, actingUserId)) return;

    const target = await VisitsDA.getUser(targetUserId);

    if (!target || !sameId(target.ManagerId, actingUserId)) {
        throw fail(403, "You can only view your own or your team's visits.");
    }
};

const normalizeLocation = (location) => {
    const status = String(location?.status || 'NOT_CAPTURED').toUpperCase();

    if (!LOCATION_STATUSES.includes(status)) {
        throw fail(400, 'Location status is invalid.');
    }

    if (status !== 'CAPTURED') {
        return {
            LocationStatus: status,
            Latitude: null,
            Longitude: null,
            LocationAccuracy: null,
            LocationCapturedAt: null,
        };
    }

    const latitude = Number(location.latitude);
    const longitude = Number(location.longitude);
    const accuracy = blank(location.accuracy) ? null : Math.round(Number(location.accuracy));

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
        throw fail(400, 'Latitude is invalid.');
    }

    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        throw fail(400, 'Longitude is invalid.');
    }

    if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0)) {
        throw fail(400, 'Location accuracy is invalid.');
    }

    return {
        LocationStatus: status,
        Latitude: Number(latitude.toFixed(6)),
        Longitude: Number(longitude.toFixed(6)),
        LocationAccuracy: accuracy,
        LocationCapturedAt: optionalTimestamp(location.capturedAt),
    };
};

// Compares the doctor's location with that day's tour plan entry.
const planStatusFor = (plan, doctor) => {
    if (!plan) return 'NO_PLAN';
    if (plan.DayType === 'non-working') return 'OFF_DAY';

    const territoryMatches = sameId(plan.TerritoryId, doctor.TerritoryId);
    const areaMatches = !plan.AreaId || !doctor.AreaId || sameId(plan.AreaId, doctor.AreaId);

    return territoryMatches && areaMatches ? 'IN_PLAN' : 'OUT_OF_PLAN';
};

// =========================================================
// QUERIES
// =========================================================

exports.getVisits = async (actingUserId, query) => {
    requireActingUser(actingUserId);

    const targetUserId = optionalGuid(query.userId, 'User') || actingUserId;
    await assertCanView(actingUserId, targetUserId);

    const today = localDateKey();
    const fromDate = blank(query.from) ? `${today.slice(0, 8)}01` : toIsoDate(query.from, 'From date');
    const toDate = blank(query.to) ? today : toIsoDate(query.to, 'To date');

    if (toDate < fromDate) {
        throw fail(400, 'The end date must be after the start date.');
    }

    if (daysBetween(fromDate, toDate) > MAX_RANGE_DAYS) {
        throw fail(400, `The date range cannot exceed ${MAX_RANGE_DAYS} days.`);
    }

    return VisitsDA.getVisits({
        UserId: targetUserId,
        FromDate: fromDate,
        ToDate: toDate,
        DoctorId: optionalGuid(query.doctorId, 'Doctor'),
    });
};

exports.getVisitById = async (actingUserId, visitId) => {
    requireActingUser(actingUserId);

    if (!GUID.test(String(visitId))) {
        throw fail(400, 'Visit id is invalid.');
    }

    const visit = await VisitsDA.getVisitById(visitId);

    if (!visit) {
        throw fail(404, 'Visit not found.');
    }

    await assertCanView(actingUserId, visit.UserId);

    // Stock tables may not exist yet on older databases.
    const items = await StockService.getVisitItems(visit.VisitId).catch(() => []);

    return { ...visit, Items: items };
};

exports.getFollowUps = async (actingUserId, userId) => {
    requireActingUser(actingUserId);

    const targetUserId = optionalGuid(userId, 'User') || actingUserId;
    await assertCanView(actingUserId, targetUserId);

    return VisitsDA.getOpenFollowUps(targetUserId);
};

// =========================================================
// CREATE (idempotent on VisitId so offline syncs can retry)
// =========================================================

exports.createVisit = async (actingUserId, payload) => {
    requireActingUser(actingUserId);

    const visitId = optionalGuid(payload.VisitId, 'Visit id') || generateUUID();
    const existing = await VisitsDA.getVisitOwner(visitId);

    if (existing) {
        if (!sameId(existing.UserId, actingUserId)) {
            throw fail(409, 'This visit id is already in use.');
        }

        return { VisitId: existing.VisitId, duplicate: true };
    }

    // Doctor
    const doctorId = optionalGuid(payload.DoctorId, 'Doctor');

    if (!doctorId) {
        throw fail(400, 'Doctor is required.');
    }

    const doctor = await VisitsDA.getMappedDoctor(actingUserId, doctorId);

    if (!doctor) {
        throw fail(400, 'This doctor is not assigned to you.');
    }

    // Date and time
    const visitDate = toIsoDate(payload.VisitDate, 'Visit date');
    const today = localDateKey();

    if (visitDate > today) {
        throw fail(400, 'Visit date cannot be in the future.');
    }

    if (visitDate < addDays(today, -MAX_BACKDATE_DAYS)) {
        throw fail(400, `Visits older than ${MAX_BACKDATE_DAYS} days cannot be logged.`);
    }

    // A sent DCR locks the day, unless the manager returned it.
    const dcrStatus = await VisitsDA.getDcrStatus(actingUserId, visitDate);

    if (dcrStatus === 'SUBMITTED' || dcrStatus === 'APPROVED') {
        throw fail(409, 'The DCR for this date has already been submitted, so no more visits can be added.');
    }

    const startTime = optionalTime(payload.StartTime, 'Start time');
    const endTime = optionalTime(payload.EndTime, 'End time');

    if (startTime && endTime && endTime <= startTime) {
        throw fail(400, 'End time must be after the start time.');
    }

    // Joint work
    const jointWorkUserId = optionalGuid(payload.JointWorkUserId, 'Joint work colleague');

    if (jointWorkUserId) {
        if (sameId(jointWorkUserId, actingUserId)) {
            throw fail(400, 'Choose a colleague other than yourself for joint work.');
        }

        if (!(await VisitsDA.getUser(jointWorkUserId))) {
            throw fail(400, 'Joint work colleague not found.');
        }
    }

    // Outcome
    const feedback = blank(payload.Feedback) ? null : String(payload.Feedback).toUpperCase();

    if (feedback && !FEEDBACK.includes(feedback)) {
        throw fail(400, 'Feedback is invalid.');
    }

    const notes = String(payload.Notes ?? '').trim();

    if (notes.length > 1000) {
        throw fail(400, 'Notes cannot exceed 1000 characters.');
    }

    const followUpDate = blank(payload.FollowUpDate)
        ? null
        : toIsoDate(payload.FollowUpDate, 'Follow-up date');

    if (followUpDate && followUpDate < visitDate) {
        throw fail(400, 'Follow-up date cannot be before the visit date.');
    }

    const location = normalizeLocation(payload.Location);

    // Tour plan check and system-detected deviation
    const plan = await VisitsDA.getPlannedForDate(
        actingUserId,
        `${visitDate.slice(0, 8)}01`,
        visitDate
    );
    const planStatus = planStatusFor(plan, doctor);

    let deviationId = null;
    let deviation = null;

    if ((planStatus === 'OUT_OF_PLAN' || planStatus === 'OFF_DAY') && doctor.TerritoryId) {
        const match = await VisitsDA.findDeviation({
            UserId: actingUserId,
            DeviationDate: visitDate,
            ActualTerritoryId: doctor.TerritoryId,
            ActualAreaId: doctor.AreaId || null,
        });

        if (match) {
            deviationId = match.DeviationId;
        } else {
            const territoryChanged = !sameId(plan?.TerritoryId, doctor.TerritoryId);
            const deviationType = territoryChanged ? 'Territory Change' : 'Area Change';

            deviationId = generateUUID();
            deviation = {
                DeviationId: deviationId,
                UserId: actingUserId,
                DeviationDate: visitDate,
                PlannedTerritoryId: plan?.TerritoryId || null,
                PlannedAreaId: plan?.AreaId || null,
                ActualTerritoryId: doctor.TerritoryId,
                ActualAreaId: doctor.AreaId || null,
                DeviationType: deviationType,
                Source: SYSTEM_SOURCE,
                Reason: `Visited ${doctor.DoctorName} outside the planned ${territoryChanged ? 'territory' : 'area'}`.slice(0, 200),
                Remarks: planStatus === 'OFF_DAY' ? 'Visit logged on a day planned as off.' : null,
                SubmittedOn: new Date(),
            };
        }
    }

    // Samples & gifts given: validated here, balance-checked inside the transaction.
    const items = Array.isArray(payload.Items) && payload.Items.length > 0 ? payload.Items : null;
    const distribution = await StockService.buildVisitDistribution({
        userId: actingUserId,
        doctorId,
        visitId,
        visitDate,
        items,
    });

    const now = new Date();

    try {
        await VisitsDA.createVisit(
            {
                VisitId: visitId,
                UserId: actingUserId,
                DoctorId: doctorId,
                VisitDate: visitDate,
                StartTime: startTime,
                EndTime: endTime,
                JointWorkUserId: jointWorkUserId,
                Feedback: feedback,
                Notes: notes || null,
                FollowUpDate: followUpDate,
                ...location,
                PlannedTerritoryId: plan?.TerritoryId || null,
                PlannedAreaId: plan?.AreaId || null,
                PlanStatus: planStatus,
                DeviationId: deviationId,
                RecordedOffline: payload.RecordedOffline === true,
                RecordedAt: optionalTimestamp(payload.RecordedAt) || now,
                CreatedOn: now,
            },
            deviation,
            distribution
        );
    } catch (error) {
        throw StockService.mapDbError(error);
    }

    return {
        VisitId: visitId,
        PlanStatus: planStatus,
        DeviationId: deviationId,
        deviationCreated: Boolean(deviation),
    };
};
