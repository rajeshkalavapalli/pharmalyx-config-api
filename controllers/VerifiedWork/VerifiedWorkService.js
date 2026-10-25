const DA = require('./VerifiedWorkDA');
const HRDA = require('../HR/HRDA');
const rules = require('./rules');
const { distanceMeters } = require('../../utils/doctorMatching');
const { loadSettings, allowedTerritory, exceptionFor } = require('./territory');

const { generateUUID } = require('../../utils/commonUtils');
const { getPermissions } = require('../../utils/permissions');
const { fail, isGuid, requireActingUser, sameId, toMonthStart } = require('../../utils/access');

const CONSENT_VERSION = '2026-10';
const ACTIVITIES = ['STILL', 'WALKING', 'ON_FOOT', 'RUNNING', 'ON_BICYCLE', 'IN_VEHICLE', 'TILTING', 'UNKNOWN'];
const MAX_POINTS_PER_CALL = 100;
const CHECKIN_MAX_HOURS = 12;
const TIMING_HISTORY_DAYS = 180;

// =========================================================
// Input
// =========================================================

const activityOf = (value) => {
    const activity = String(value || '').toUpperCase();
    if (!activity) return null;
    if (activity === 'ON_FOOT' || activity === 'RUNNING') return 'WALKING';
    if (activity === 'ON_BICYCLE') return 'IN_VEHICLE';
    return ACTIVITIES.includes(activity) ? activity : 'UNKNOWN';
};

// { status, latitude, longitude, accuracy, isMock, activity, capturedAt } -> fix or null (no GPS).
const parseFix = (location) => {
    if (!location || String(location.status || 'CAPTURED').toUpperCase() !== 'CAPTURED') return null;

    const lat = Number(location.latitude ?? location.Latitude);
    const lng = Number(location.longitude ?? location.Longitude);
    const accuracy = location.accuracy ?? location.Accuracy;

    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) throw fail(400, 'Location is invalid.');

    return {
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        accuracy: accuracy == null || accuracy === '' ? null : Math.max(0, Math.round(Number(accuracy)) || 0),
        isMock: location.isMock === true || location.IsMock === true,
        activity: activityOf(location.activity ?? location.Activity),
    };
};

const monthEndOf = (monthStart) => {
    const date = new Date(`${monthStart}T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + 1, 0);
    return date.toISOString().slice(0, 10);
};

const addDaysKey = (key, days) => {
    const date = new Date(`${key}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
};

// Who the acting user may see: self + team; head office (reports.viewall / verifiedwork.approve) sees everyone.
const viewAll = async (actingUserId) => {
    const permissions = await getPermissions(actingUserId);
    return permissions.has('reports.viewall') || permissions.has('verifiedwork.approve') ? 1 : 0;
};

const resolveTarget = async (actingUserId, userId) => {
    requireActingUser(actingUserId);
    if (!userId || sameId(userId, actingUserId)) return actingUserId;
    if (!isGuid(userId)) throw fail(400, 'User is invalid.');

    const users = await DA.scopeUsers({ ActingUserId: actingUserId, ViewAll: await viewAll(actingUserId) });
    if (!users.some((user) => sameId(user.UserId, userId))) throw fail(403, "You can only see your own or your team's work.");
    return userId;
};

exports.viewAll = viewAll;
exports.resolveTarget = resolveTarget;
exports.parseFix = parseFix;
exports.CONSENT_VERSION = CONSENT_VERSION;

// =========================================================
// Consent (DPDP Act): accepted once before location is recorded
// =========================================================

exports.getConsent = async (actingUserId) => {
    requireActingUser(actingUserId);
    const [consent, settings] = await Promise.all([DA.getConsent(actingUserId, CONSENT_VERSION), loadSettings()]);
    return {
        version: CONSENT_VERSION,
        accepted: Boolean(consent),
        acceptedAt: consent?.AcceptedAt || null,
        pingIntervalMinutes: settings.PING_INTERVAL_MINUTES,
        workStartHour: settings.WORK_START_HOUR,
        workEndHour: settings.WORK_END_HOUR,
    };
};

exports.acceptConsent = async (actingUserId, payload, userAgent) => {
    requireActingUser(actingUserId);
    if (payload.Accept !== true) throw fail(400, 'Tick the box to accept.');
    await DA.insertConsent({ UserId: actingUserId, ConsentVersion: CONSENT_VERSION, Now: new Date(), UserAgent: String(userAgent || '').slice(0, 300) || null });
    return { message: 'Thank you. Location is recorded only during work hours.' };
};

// =========================================================
// Automatic day start (first check-in or opening the day's plan)
// =========================================================

const startDay = async (userId, fix, source, now = new Date()) => {
    const workDate = rules.istDateKey(now);
    const existing = await DA.getWorkDay(userId, workDate);
    if (existing) return { started: false, workDay: existing };

    const [planned, territory] = await Promise.all([DA.plannedDay(userId, workDate), allowedTerritory(userId, workDate)]);
    const inside = fix && !fix.isMock ? rules.insideAny(fix.lat, fix.lng, territory.polygons) : null;
    const outside = inside === false && !territory.specialDuty;

    const flag = outside
        ? {
              FlagId: generateUUID(),
              FlagType: 'DAY_START_OUTSIDE',
              Severity: 'HIGH',
              UserId: userId,
              DoctorId: null,
              VisitId: null,
              Details: `The work day started outside the territory${planned?.AreaName ? ` (planned patch: ${planned.AreaName})` : ''}.`,
              Data: JSON.stringify({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, source }),
              Now: now,
          }
        : null;

    const inserted = await DA.startWorkDay(
        {
            UserId: userId,
            WorkDate: workDate,
            Now: now,
            StartSource: source,
            Latitude: fix?.lat ?? null,
            Longitude: fix?.lng ?? null,
            Accuracy: fix?.accuracy ?? null,
            StartInside: inside == null ? null : inside ? 1 : 0,
            PlannedAreaId: planned?.AreaId || null,
        },
        flag
    );

    // One check-in: starting the day (My Day, first visit) also records attendance, so nobody checks in twice.
    if (inserted && source !== 'ATTENDANCE') await recordAttendance(userId, workDate, fix, source, now);

    return { started: inserted, workDay: await DA.getWorkDay(userId, workDate), flagged: inserted && outside };
};

const ATTENDANCE_NOTE = { PLAN_OPEN: 'Checked in when the day was started in My Day.', CHECK_IN: 'Checked in at the first visit.' };

// Attendance check-in for the day, unless one exists. Never fails the day start.
const recordAttendance = async (userId, workDate, fix, source, now) => {
    try {
        if (await HRDA.getDayLog({ UserId: userId, Day: workDate })) return;
        await HRDA.checkIn({
            AttendanceId: generateUUID(),
            UserId: userId,
            Day: workDate,
            Now: now,
            Remarks: ATTENDANCE_NOTE[source] || 'Checked in when the work day started.',
            LocationStatus: fix ? 'CAPTURED' : 'UNAVAILABLE',
            Latitude: fix?.lat ?? null,
            Longitude: fix?.lng ?? null,
            Accuracy: fix?.accuracy ?? null,
        });
    } catch (error) {
        if (!/UQ_AttendanceLogs_Day|duplicate key/i.test(error.message)) console.error('Attendance not recorded:', error.message);
    }
};

exports.startDay = startDay;

exports.startDayFromPlan = async (actingUserId, payload) => {
    requireActingUser(actingUserId);
    const fix = parseFix(payload.Location);
    const result = await startDay(actingUserId, fix, 'PLAN_OPEN');
    return { started: result.started, workDay: result.workDay };
};

// =========================================================
// Location pings during work hours (TA from distance travelled)
// =========================================================

exports.recordPings = async (actingUserId, payload, source = 'WEB') => {
    requireActingUser(actingUserId);

    const [consent, settings] = await Promise.all([DA.getConsent(actingUserId, CONSENT_VERSION), loadSettings()]);
    if (!consent) throw fail(409, 'Accept the location consent first.');

    const now = new Date();
    if (!rules.inWorkHours(now, settings)) return { saved: 0, reason: 'Outside work hours: nothing recorded.' };

    const workDate = rules.istDateKey(now);
    if (!(await DA.getWorkDay(actingUserId, workDate))) return { saved: 0, reason: 'The work day has not started yet.' };

    const points = (Array.isArray(payload.Points) ? payload.Points : []).slice(0, MAX_POINTS_PER_CALL);
    const last = await DA.lastPing(actingUserId);
    const minGapMs = Math.max(1, settings.PING_INTERVAL_MINUTES / 2) * 60000;
    let previous = last ? new Date(last.ServerAt).getTime() : 0;

    const rows = [];
    for (const point of points) {
        const fix = parseFix({ ...point, status: 'CAPTURED' });
        // Device time is used only if it is recent (offline queue); never in the future.
        const deviceAt = point.capturedAt ? new Date(point.capturedAt) : null;
        const at = deviceAt && !Number.isNaN(deviceAt.getTime()) && deviceAt <= now && now - deviceAt < 6 * 3600000 ? deviceAt : now;
        if (at.getTime() - previous < minGapMs || rules.istDateKey(at) !== workDate || !rules.inWorkHours(at, settings)) continue;

        previous = at.getTime();
        rows.push({
            UserId: actingUserId,
            PingDate: workDate,
            Now: now,
            DeviceAt: at,
            Latitude: fix.lat,
            Longitude: fix.lng,
            Accuracy: fix.accuracy,
            Activity: fix.activity,
            IsMock: fix.isMock ? 1 : 0,
            Source: ['WEB', 'ANDROID', 'IOS'].includes(source) ? source : 'WEB',
        });
    }

    if (rows.length) await DA.insertPings(rows);
    return { saved: rows.length };
};

// Km travelled per day (from pings, day start, check-ins and check-outs).
exports.kmByDay = async (userId, from, to) => {
    const points = await DA.dayPoints(userId, from, to);
    const byDay = new Map();
    points.forEach((row) => {
        const day = new Date(row.D).toISOString().slice(0, 10);
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push({ at: row.At, lat: row.Lat, lng: row.Lng, accuracy: row.Accuracy, isMock: Boolean(row.IsMock) });
    });
    return new Map([...byDay].map(([day, list]) => [day, rules.travelledKm(list)]));
};

// =========================================================
// Live check-in at the clinic
// =========================================================

exports.checkIn = async (actingUserId, payload, VisitsDA) => {
    requireActingUser(actingUserId);
    if (!isGuid(payload.DoctorId)) throw fail(400, 'Doctor is required.');

    const doctor = await VisitsDA.getMappedDoctor(actingUserId, payload.DoctorId);
    if (!doctor) throw fail(400, 'This doctor is not assigned to you.');

    const fix = parseFix(payload.Location);
    const now = new Date();
    const checkInId = generateUUID();

    await startDay(actingUserId, fix, 'CHECK_IN', now);
    await DA.insertCheckIn({
        CheckInId: checkInId,
        UserId: actingUserId,
        DoctorId: payload.DoctorId,
        Now: now,
        Latitude: fix?.lat ?? null,
        Longitude: fix?.lng ?? null,
        Accuracy: fix?.accuracy ?? null,
        IsMock: fix?.isMock ? 1 : 0,
        Activity: fix?.activity ?? null,
    });

    const [settings, hospital] = await Promise.all([loadSettings(), DA.doctorHospital(payload.DoctorId).catch(() => null)]);
    return {
        CheckInId: checkInId,
        CheckInAt: now,
        minDwellMinutes: settings.MIN_DWELL_MINUTES,
        hasGps: Boolean(fix),
        // Live guidance: how far the phone is from the clinic, judged like the visit itself.
        clinic: clinicGuide(fix, hospital ? { lat: hospital.Latitude, lng: hospital.Longitude, radius: hospital.RadiusM } : { lat: doctor.ClinicLatitude, lng: doctor.ClinicLongitude }, settings),
    };
};

// { pinned, distanceM, radiusM, inside, accuracyM } for the check-in screen (GPS accuracy up to 100 m is allowed for).
const clinicGuide = (fix, clinic, settings) => {
    const pinned = clinic && clinic.lat != null && clinic.lng != null;
    const radiusM = Number(clinic?.radius) || settings.GEOFENCE_METERS;
    if (!pinned || !fix) return { pinned: Boolean(pinned), distanceM: null, radiusM, inside: null, accuracyM: fix?.accuracy ?? null };
    const distanceM = Math.round(distanceMeters(fix.lat, fix.lng, Number(clinic.lat), Number(clinic.lng)) || 0);
    const allowance = Math.min(Number(fix.accuracy) || 0, 100);
    return { pinned: true, distanceM, radiusM, inside: distanceM - allowance <= radiusM, accuracyM: fix.accuracy ?? null };
};

// Worst movement seen: vehicle > walking > still > unknown.
const worstActivity = (activities) => ['IN_VEHICLE', 'WALKING', 'STILL', 'UNKNOWN'].find((activity) => activities.includes(activity)) || null;

/**
 * Decides a visit being saved (called by the Visits service). Check-out = now, at the save-time GPS.
 * Returns columns for dbo.Visits, extra transaction steps, the check-in fix and the decision.
 */
exports.judgeNewVisit = async ({ userId, doctor, visitDate, checkInId, location, motion }) => {
    const settings = await loadSettings();
    const now = new Date();
    let checkIn = null;

    if (checkInId) {
        if (!isGuid(checkInId)) throw fail(400, 'Check-in is invalid.');
        const row = await DA.getCheckIn(checkInId);
        if (!row || !sameId(row.UserId, userId)) throw fail(404, 'Check-in not found.');
        if (!sameId(row.DoctorId, doctor.DoctorId)) throw fail(400, 'This check-in was for a different doctor.');
        if (row.Status !== 'OPEN') throw fail(409, 'This check-in was already used or replaced by a newer one. Check in again.');
        if (rules.istDateKey(row.CheckInAt) !== visitDate) throw fail(400, 'A checked-in visit must be saved for the same day.');
        if (now - new Date(row.CheckInAt) > CHECKIN_MAX_HOURS * 3600000) throw fail(409, 'This check-in is too old. Check in again.');

        checkIn = {
            id: row.CheckInId,
            at: row.CheckInAt,
            lat: row.Latitude == null ? null : Number(row.Latitude),
            lng: row.Longitude == null ? null : Number(row.Longitude),
            accuracy: row.Accuracy,
            isMock: Boolean(row.IsMock),
            activity: row.Activity,
        };
    }

    const checkOut = checkIn ? { at: now, ...(parseFix(location) || { lat: null, lng: null, accuracy: null, isMock: false, activity: null }) } : null;
    const motionList = (Array.isArray(motion) ? motion : []).map(activityOf).filter(Boolean);

    const [hospital, territory, onLeave, others] = await Promise.all([
        DA.doctorHospital(doctor.DoctorId),
        allowedTerritory(userId, visitDate),
        DA.onLeave(userId, visitDate),
        checkIn ? DA.dayVisitTimes(userId, visitDate) : [],
    ]);

    const clinic = hospital
        ? { lat: Number(hospital.Latitude), lng: Number(hospital.Longitude), radius: hospital.RadiusM }
        : doctor.ClinicLatitude != null
          ? { lat: Number(doctor.ClinicLatitude), lng: Number(doctor.ClinicLongitude), radius: settings.GEOFENCE_METERS }
          : null;

    const decision = rules.judgeVisit({
        checkIn,
        checkOut,
        clinic,
        territory: { polygons: territory.polygons, exception: exceptionFor(territory, doctor.DoctorId) },
        motion: motionList,
        overlaps: checkIn ? rules.overlapsAny(checkIn.at, now, others.map((o) => ({ start: o.CheckInAt, end: o.CheckOutAt }))) : false,
        onLeave,
        settings,
    });

    const flags = [];
    const flag = (FlagType, Severity, Details, data = {}) =>
        flags.push({ FlagId: generateUUID(), FlagType, Severity, UserId: userId, DoctorId: doctor.DoctorId, Details: Details.slice(0, 500), Data: JSON.stringify(data), Now: now });

    if (decision.reasons.includes('OUTSIDE_TERRITORY')) {
        flag('VISIT_OUTSIDE_TERRITORY', 'HIGH', `Visit to Dr. ${doctor.DoctorName} was checked in outside the territory boundary; it does not count.`, { lat: checkIn.lat, lng: checkIn.lng });
    }
    if (decision.reasons.includes('IN_VEHICLE')) {
        flag('DRIVE_BY', 'MEDIUM', `Visit to Dr. ${doctor.DoctorName} was logged while moving in a vehicle; it needs a look.`, { motion: motionList });
    }

    return {
        decision,
        checkIn,
        flags,
        columns: {
            CheckInId: checkIn?.id || null,
            CheckInAt: checkIn?.at || null,
            CheckOutAt: checkOut?.at || null,
            CheckOutLatitude: checkOut?.lat ?? null,
            CheckOutLongitude: checkOut?.lng ?? null,
            CheckOutAccuracy: checkOut?.accuracy ?? null,
            DwellSeconds: decision.dwellSeconds,
            MotionActivity: worstActivity([checkIn?.activity, checkOut?.activity, ...motionList].filter(Boolean)),
            InsideBoundary: decision.insideBoundary == null ? null : decision.insideBoundary ? 1 : 0,
            HospitalId: hospital?.HospitalId || null,
            Validity: decision.validity,
            InvalidReasons: decision.reasons.length || decision.notes.length ? JSON.stringify({ reasons: decision.reasons, notes: decision.notes }) : null,
        },
    };
};

exports.useCheckInQuery = (checkInId, visitId) => DA.useCheckInQuery({ CheckInId: checkInId, VisitId: visitId });
exports.flagQueries = (flags, visitId) => flags.map((inputs) => DA.flagQuery({ ...inputs, VisitId: visitId }));

// Reason codes -> readable text (for API responses).
exports.describeReasons = (value) => {
    let parsed = null;
    try {
        parsed = value ? JSON.parse(value) : null;
    } catch {
        parsed = null;
    }
    const reasons = parsed?.reasons || [];
    const notes = parsed?.notes || [];
    return {
        reasons: reasons.map((code) => ({ code, text: rules.REASONS[code] || code, hard: rules.HARD_REASONS.has(code) })),
        notes: notes.map((code) => ({ code, text: rules.REASONS[code] || code })),
    };
};

// =========================================================
// Plans: today, and the month (doctors due per day)
// =========================================================

// Doctors with required / valid counts and timing.
const doctorStatus = async (userId, monthStart, settings) => {
    const today = rules.istDateKey();
    const [doctors, counts, times] = await Promise.all([
        DA.myDoctors(userId),
        DA.visitCounts(userId, monthStart, monthEndOf(monthStart)),
        DA.validTimes(userId, addDaysKey(today, -TIMING_HISTORY_DAYS)),
    ]);

    const countBy = new Map(counts.map((row) => [String(row.DoctorId).toLowerCase(), row]));
    const timesBy = new Map();
    times.forEach((row) => {
        const key = String(row.DoctorId).toLowerCase();
        if (!timesBy.has(key)) timesBy.set(key, []);
        timesBy.get(key).push(row.CheckInAt);
    });

    return doctors.map((doctor) => {
        const key = String(doctor.DoctorId).toLowerCase();
        const count = countBy.get(key);
        const required = rules.requiredVisits(doctor, settings);
        const valid = Number(count?.ValidVisits || 0);
        return {
            DoctorId: doctor.DoctorId,
            DoctorName: doctor.DoctorName,
            Speciality: doctor.Speciality,
            Category: doctor.Category,
            AreaId: doctor.AreaId,
            AreaName: doctor.AreaName,
            HospitalName: doctor.HospitalGroup || doctor.HospitalName,
            VerificationStatus: doctor.VerificationStatus,
            clinicPinned: doctor.ClinicLatitude != null || Boolean(doctor.HospitalId),
            required,
            valid,
            notCounted: Number(count?.NotCounted || 0),
            remaining: Math.max(0, required - valid),
            lastValid: count?.LastValid || null,
            timing: rules.timingSuggestion(timesBy.get(key) || [], settings),
        };
    });
};

exports.getToday = async (actingUserId) => {
    requireActingUser(actingUserId);

    const settings = await loadSettings();
    const today = rules.istDateKey();
    const month = `${today.slice(0, 8)}01`;

    const [planned, workDay, consent, doctors, visits, areas, territory] = await Promise.all([
        DA.plannedDay(actingUserId, today),
        DA.getWorkDay(actingUserId, today),
        DA.getConsent(actingUserId, CONSENT_VERSION),
        doctorStatus(actingUserId, month, settings),
        DA.dayVisits(actingUserId, today),
        DA.myAreas(actingUserId),
        allowedTerritory(actingUserId, today),
    ]);

    const patch = planned?.AreaId ? areas.find((area) => sameId(area.AreaId, planned.AreaId)) : null;
    const visitedToday = new Set(visits.map((visit) => String(visit.DoctorId).toLowerCase()));
    const due = doctors.filter((doctor) => doctor.remaining > 0 && !visitedToday.has(String(doctor.DoctorId).toLowerCase()));
    const inPatch = planned?.AreaId ? due.filter((doctor) => sameId(doctor.AreaId, planned.AreaId)) : [];

    return {
        date: today,
        planned: planned
            ? { dayType: planned.DayType, areaId: planned.AreaId, areaName: planned.AreaName, patchType: patch?.PatchType || null, remarks: planned.Remarks }
            : null,
        workDay,
        consent: { version: CONSENT_VERSION, accepted: Boolean(consent) },
        rules: {
            minDwellMinutes: settings.MIN_DWELL_MINUTES,
            clinicRadius: settings.GEOFENCE_METERS,
            daMinValidVisits: settings.DA_MIN_VALID_VISITS,
            pingIntervalMinutes: settings.PING_INTERVAL_MINUTES,
            workStartHour: settings.WORK_START_HOUR,
            workEndHour: settings.WORK_END_HOUR,
        },
        territory: { hasBoundary: territory.hasOwnBoundary, specialDuty: territory.specialDuty },
        // Today's patch, ordered by usual timing (suggestion only).
        plan: rules.orderByTiming(inPatch),
        // Anyone else due inside the territory: no approval needed to visit them.
        otherDue: rules.orderByTiming(due.filter((doctor) => !inPatch.includes(doctor))),
        visits: visits.map((visit) => ({ ...visit, ...exports.describeReasons(visit.InvalidReasons), InvalidReasons: undefined })),
        // Counted today (valid + needs a look), and how each result splits.
        validToday: visits.filter((visit) => rules.COUNTED.includes(visit.FinalValidity)).length,
        today: {
            counted: visits.filter((visit) => visit.FinalValidity === 'VALID').length,
            review: visits.filter((visit) => visit.FinalValidity === 'REVIEW').length,
            notCounted: visits.filter((visit) => visit.FinalValidity === 'INVALID').length,
            daNeeds: settings.DA_MIN_VALID_VISITS,
        },
    };
};

// Month: each planned day with the doctors due that day (remaining visits spread over the patch's days).
exports.getMonthPlan = async (actingUserId, query) => {
    const userId = await resolveTarget(actingUserId, query.userId);
    const month = toMonthStart(query.month || rules.istDateKey().slice(0, 7));
    const settings = await loadSettings();
    const today = rules.istDateKey();

    const [days, doctors, areas] = await Promise.all([DA.monthPlan(userId, month), doctorStatus(userId, month, settings), DA.myAreas(userId)]);
    const patchType = new Map(areas.map((area) => [String(area.AreaId).toLowerCase(), area.PatchType]));

    // Upcoming working days per patch.
    const datesByArea = new Map();
    days.filter((day) => day.DayType === 'working' && day.AreaId && day.PlanDate >= today).forEach((day) => {
        const key = String(day.AreaId).toLowerCase();
        if (!datesByArea.has(key)) datesByArea.set(key, []);
        datesByArea.get(key).push(day.PlanDate);
    });

    const dueByDate = new Map();
    doctors.forEach((doctor) => {
        const dates = rules.spreadDates(datesByArea.get(String(doctor.AreaId || '').toLowerCase()) || [], doctor.remaining);
        dates.forEach((date) => {
            if (!dueByDate.has(date)) dueByDate.set(date, []);
            dueByDate.get(date).push(doctor);
        });
    });

    const unplanned = doctors.filter((doctor) => doctor.remaining > 0 && !(datesByArea.get(String(doctor.AreaId || '').toLowerCase()) || []).length);

    return {
        month,
        userId,
        days: days.map((day) => ({
            ...day,
            patchType: day.AreaId ? patchType.get(String(day.AreaId).toLowerCase()) || null : null,
            doctors: rules.orderByTiming(dueByDate.get(day.PlanDate) || []).map((doctor) => ({
                DoctorId: doctor.DoctorId,
                DoctorName: doctor.DoctorName,
                Category: doctor.Category,
                timing: doctor.timing.label,
            })),
        })),
        unplanned: unplanned.map((doctor) => ({ DoctorId: doctor.DoctorId, DoctorName: doctor.DoctorName, AreaName: doctor.AreaName, remaining: doctor.remaining })),
    };
};

// Coverage: required vs actual valid visits per doctor in a month.
exports.getCoverage = async (actingUserId, query) => {
    const userId = await resolveTarget(actingUserId, query.userId);
    const month = toMonthStart(query.month || rules.istDateKey().slice(0, 7));
    const settings = await loadSettings();
    const doctors = await doctorStatus(userId, month, settings);

    const rows = doctors
        .map((doctor) => ({
            ...doctor,
            status: doctor.valid >= doctor.required ? 'MET' : doctor.valid > 0 ? 'PARTIAL' : 'MISSED',
        }))
        .sort((a, b) => b.remaining - a.remaining || String(a.DoctorName).localeCompare(String(b.DoctorName)));

    const required = rows.reduce((sum, row) => sum + row.required, 0);
    const valid = rows.reduce((sum, row) => sum + Math.min(row.valid, row.required), 0);

    return {
        month,
        userId,
        summary: {
            doctors: rows.length,
            met: rows.filter((row) => row.status === 'MET').length,
            missed: rows.filter((row) => row.status === 'MISSED').length,
            required,
            valid,
            percent: required ? Math.round((valid / required) * 100) : null,
            notCounted: rows.reduce((sum, row) => sum + row.notCounted, 0),
        },
        rows,
    };
};

exports.getScopeUsers = async (actingUserId) => {
    requireActingUser(actingUserId);
    return { users: await DA.scopeUsers({ ActingUserId: actingUserId, ViewAll: await viewAll(actingUserId) }) };
};

exports.getDoctorsOf = async (actingUserId, query) => {
    const userId = await resolveTarget(actingUserId, query.userId);
    return { doctors: (await DA.myDoctors(userId)).map((d) => ({ DoctorId: d.DoctorId, DoctorName: d.DoctorName, AreaName: d.AreaName })) };
};

exports._internals = { monthEndOf, addDaysKey, worstActivity, activityOf };
