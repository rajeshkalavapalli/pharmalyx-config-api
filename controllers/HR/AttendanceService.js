const HRDA = require('./HRDA');
const VerifiedWork = require('../VerifiedWork/VerifiedWorkService');

const { generateUUID } = require('../../utils/commonUtils');
const { getScopeUsers, resolveScope } = require('../../utils/reportScope');
const { fail, optionalText, requireActingUser, todayKey, toMonthStart } = require('../../utils/access');

const LOCATION_STATUSES = ['CAPTURED', 'DENIED', 'UNAVAILABLE'];

// Check-ins after this time are flagged late.
const LATE_AFTER = '10:00';

const addDays = (key, days) => {
    const date = new Date(`${key}T00:00:00`);
    date.setDate(date.getDate() + days);
    return todayKey(date);
};

const monthEnd = (monthStart) => {
    const date = new Date(`${monthStart}T00:00:00`);
    return todayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
};

// GPS is optional (denied / unavailable), but when captured it must be a real coordinate.
const parseLocation = (payload) => {
    const status = String(payload.LocationStatus || '').toUpperCase();
    if (!LOCATION_STATUSES.includes(status)) throw fail(400, 'Location status is invalid.');

    if (status !== 'CAPTURED') return { LocationStatus: status, Latitude: null, Longitude: null, Accuracy: null };

    const latitude = Number(payload.Latitude);
    const longitude = Number(payload.Longitude);
    const accuracy = payload.Accuracy == null ? null : Number(payload.Accuracy);

    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        throw fail(400, 'Location coordinates are invalid.');
    }
    if (accuracy != null && (!Number.isFinite(accuracy) || accuracy < 0)) throw fail(400, 'Location accuracy is invalid.');

    return { LocationStatus: status, Latitude: latitude, Longitude: longitude, Accuracy: accuracy == null ? null : Math.round(accuracy * 100) / 100 };
};

const timeOf = (value) => (value ? new Date(value).toTimeString().slice(0, 5) : null);

// =========================================================
// TODAY: check in / check out
// =========================================================

exports.getToday = async (actingUserId) => {
    requireActingUser(actingUserId);
    const today = todayKey();
    const log = await HRDA.getDayLog({ UserId: actingUserId, Day: today });

    return {
        date: today,
        lateAfter: LATE_AFTER,
        checkIn: log ? { at: log.CheckInAt, time: timeOf(log.CheckInAt), location: log.CheckInLocation } : null,
        checkOut: log?.CheckOutAt ? { at: log.CheckOutAt, time: timeOf(log.CheckOutAt), location: log.CheckOutLocation } : null,
        remarks: log?.Remarks || null,
    };
};

exports.checkIn = async (actingUserId, payload) => {
    requireActingUser(actingUserId);
    const today = todayKey();

    if (await HRDA.getDayLog({ UserId: actingUserId, Day: today })) throw fail(409, 'You have already checked in today.');

    try {
        await HRDA.checkIn({
            AttendanceId: generateUUID(),
            UserId: actingUserId,
            Day: today,
            Now: new Date(),
            Remarks: optionalText(payload.Remarks, 300, 'Remarks'),
            ...parseLocation(payload),
        });
    } catch (error) {
        // Two taps at once: the unique (user, day) key keeps one row.
        if (/UQ_AttendanceLogs_Day|duplicate key/i.test(error.message)) throw fail(409, 'You have already checked in today.');
        throw error;
    }

    // First activity of the day: starts the work day silently (flagged for head office only if outside the territory).
    const location = parseLocation(payload);
    await VerifiedWork.startDay(
        actingUserId,
        location.LocationStatus === 'CAPTURED' ? { lat: location.Latitude, lng: location.Longitude, accuracy: location.Accuracy, isMock: payload.IsMock === true } : null,
        'ATTENDANCE'
    ).catch((error) => console.error('Day start not recorded:', error.message));

    return { message: 'Checked in. Have a good day in the field.' };
};

exports.checkOut = async (actingUserId, payload) => {
    requireActingUser(actingUserId);
    const today = todayKey();
    const log = await HRDA.getDayLog({ UserId: actingUserId, Day: today });

    if (!log) throw fail(409, 'Check in first.');
    if (log.CheckOutAt) throw fail(409, 'You have already checked out today.');

    const changed = await HRDA.checkOut({ UserId: actingUserId, Day: today, Now: new Date(), Remarks: optionalText(payload.Remarks, 300, 'Remarks'), ...parseLocation(payload) });
    if (!changed) throw fail(409, 'You have already checked out today.');

    return { message: 'Checked out.' };
};

// =========================================================
// MONTH: day status per employee
// =========================================================

// Priority: leave > present (check-in, visits or DCR) > week off (Sunday / tour-plan off day) > absent (past days only).
const dayStatus = ({ day, today, leave, log, visits, dcr, off }) => {
    if (leave) return leave.HalfDay ? 'HALF_DAY_LEAVE' : 'LEAVE';
    if (log || visits || dcr) return 'PRESENT';
    if (off || new Date(`${day}T00:00:00`).getDay() === 0) return 'WEEK_OFF';
    if (day > today) return 'UPCOMING';
    if (day === today) return 'TODAY';
    return 'ABSENT';
};

exports.getMonth = async (actingUserId, query) => {
    const scope = await resolveScope(actingUserId, query.userId);
    const FromDate = toMonthStart(query.month || todayKey().slice(0, 7));
    const ToDate = monthEnd(FromDate);
    const inputs = { ...scope, FromDate, ToDate };
    const today = todayKey();

    const [{ users }, logs, visits, dcrs, leaves, offs] = await Promise.all([
        getScopeUsers(actingUserId),
        HRDA.getLogs(inputs),
        HRDA.getVisitDays(inputs),
        HRDA.getDcrDays(inputs),
        HRDA.getApprovedLeaves(inputs),
        HRDA.getOffDays(inputs),
    ]);

    const key = (userId, day) => `${String(userId).toLowerCase()}|${day}`;
    const logMap = new Map(logs.map((row) => [key(row.UserId, row.Day), row]));
    const visitMap = new Map(visits.map((row) => [key(row.UserId, row.Day), row.Visits]));
    const dcrSet = new Set(dcrs.map((row) => key(row.UserId, row.Day)));
    const offSet = new Set(offs.map((row) => key(row.UserId, row.Day)));

    const days = [];
    for (let day = FromDate; day <= ToDate; day = addDays(day, 1)) days.push(day);

    const people = users
        .filter((user) => !scope.UserId || String(user.UserId).toLowerCase() === String(scope.UserId).toLowerCase())
        .map((user) => {
            const userLeaves = leaves.filter((row) => String(row.UserId).toLowerCase() === String(user.UserId).toLowerCase());

            const calendar = days.map((day) => {
                const log = logMap.get(key(user.UserId, day));
                const leave = userLeaves.find((row) => row.FromDate <= day && row.ToDate >= day);
                const status = dayStatus({ day, today, leave, log, visits: visitMap.get(key(user.UserId, day)), dcr: dcrSet.has(key(user.UserId, day)), off: offSet.has(key(user.UserId, day)) });

                return {
                    day,
                    status,
                    checkIn: log?.CheckIn || null,
                    checkOut: log?.CheckOut || null,
                    hours: log?.Minutes != null ? Math.round((log.Minutes / 60) * 10) / 10 : null,
                    late: Boolean(log?.CheckIn && log.CheckIn > LATE_AFTER),
                    gps: log?.CheckInLocation || null,
                    visits: visitMap.get(key(user.UserId, day)) || 0,
                    leave: leave ? leave.LeaveName : null,
                };
            });

            const count = (status) => calendar.filter((item) => item.status === status).length;
            const worked = calendar.filter((item) => item.hours != null);

            return {
                UserId: user.UserId,
                Name: user.Name,
                DesignationName: user.DesignationName,
                IsSelf: Boolean(user.IsSelf),
                summary: {
                    present: count('PRESENT'),
                    absent: count('ABSENT'),
                    leave: count('LEAVE') + count('HALF_DAY_LEAVE') * 0.5,
                    weekOff: count('WEEK_OFF'),
                    late: calendar.filter((item) => item.late).length,
                    checkedIn: calendar.filter((item) => item.checkIn).length,
                    avgHours: worked.length ? Math.round((worked.reduce((sum, item) => sum + item.hours, 0) / worked.length) * 10) / 10 : null,
                },
                days: calendar,
            };
        });

    return { month: FromDate, today, lateAfter: LATE_AFTER, days, people };
};
