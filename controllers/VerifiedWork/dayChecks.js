// Day checks: patterns over a whole work day that a single visit can't show. A day with findings is
// put ON HOLD for review (Expenses/DayReviewService.js); nothing here cuts money by itself.
// Findings are plain, checkable facts (times, counts, km), never labels about the person.
//
//   RAPID_VISITS     several visits checked in within a few minutes (unless all in one hospital)
//   ONE_SPOT         visits to doctors of different areas, all reported from one place
//   NO_FIELD_TRAVEL  an Ex-HQ / Outstation day, but the location trail shows almost no travel

const { customQuery } = require('../../utils/dbFunctions');
const { distanceMeters } = require('../../utils/doctorMatching');
const { EFFECTIVE } = require('./sql');

const lower = (value) => String(value || '').toLowerCase();
const timeOf = (value) => new Date(new Date(value).getTime() + 330 * 60000).toISOString().slice(11, 16); // IST hh:mm

// Counted visits with a live check-in, per day.
const DAY_VISITS = `
    SELECT CONVERT(VARCHAR(10), v.VisitDate, 23) AS WorkDate, v.VisitId, v.CheckInAt, v.Latitude, v.Longitude,
           v.HospitalId, d.DoctorName, TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId) AS AreaId
    FROM dbo.Visits v
    INNER JOIN dbo.Doctor d ON d.DoctorId = v.DoctorId
    WHERE v.UserId = @UserId AND v.VisitDate BETWEEN @From AND @To
      AND v.CheckInAt IS NOT NULL AND ${EFFECTIVE} IN ('VALID', 'REVIEW')
    ORDER BY v.CheckInAt`;

// The largest group of visits checked in within `minutes` of the first one.
const densestWindow = (visits, minutes) => {
    let best = [];
    for (let i = 0; i < visits.length; i++) {
        const start = new Date(visits[i].CheckInAt).getTime();
        const group = visits.filter((v) => {
            const t = new Date(v.CheckInAt).getTime();
            return t >= start && t - start <= minutes * 60000;
        });
        if (group.length > best.length) best = group;
    }
    return best;
};

// The largest group of visits reported within `metres` of one of them.
const tightestSpot = (visits, metres) => {
    const located = visits.filter((v) => v.Latitude != null && v.Longitude != null);
    let best = [];
    located.forEach((centre) => {
        const group = located.filter((v) => (distanceMeters(Number(centre.Latitude), Number(centre.Longitude), Number(v.Latitude), Number(v.Longitude)) || 0) <= metres);
        if (group.length > best.length) best = group;
    });
    return best;
};

const sameHospital = (group) => group.length > 0 && group.every((v) => v.HospitalId && lower(v.HospitalId) === lower(group[0].HospitalId));

/**
 * Findings for one day (pure).
 *  visits:  counted visits with check-in [{ CheckInAt, Latitude, Longitude, HospitalId, AreaId, DoctorName }]
 *  day:     { km, station, points } from the allowance facts (points = location records that day)
 *  settings: company rule values
 * Returns [{ code, text }] (empty = nothing unusual).
 */
const findingsForDay = (visits, day, settings) => {
    const findings = [];

    const rapid = densestWindow(visits, settings.RAPID_WINDOW_MINUTES);
    if (rapid.length >= settings.RAPID_VISITS_COUNT && !sameHospital(rapid)) {
        const first = timeOf(rapid[0].CheckInAt);
        const last = timeOf(rapid[rapid.length - 1].CheckInAt);
        findings.push({
            code: 'RAPID_VISITS',
            text: `${rapid.length} visits to different doctors were checked in ${first === last ? `at ${first}` : `between ${first} and ${last}`} (within ${settings.RAPID_WINDOW_MINUTES} minutes).`,
        });
    }

    const spot = tightestSpot(visits, settings.ONE_SPOT_METERS);
    const areas = new Set(spot.map((v) => lower(v.AreaId)).filter(Boolean));
    if (spot.length >= settings.ONE_SPOT_VISITS && areas.size >= 2 && !sameHospital(spot)) {
        findings.push({
            code: 'ONE_SPOT',
            text: `${spot.length} visits to doctors of ${areas.size} different areas were reported from one location (within ${settings.ONE_SPOT_METERS} m).`,
        });
    }

    if (day && ['EX_HQ', 'OUTSTATION'].includes(day.station) && (day.points || 0) >= 3 && Number(day.km || 0) < settings.NO_TRAVEL_KM) {
        findings.push({
            code: 'NO_FIELD_TRAVEL',
            text: `This is an ${day.station === 'EX_HQ' ? 'Ex-HQ' : 'Outstation'} day, but the location trail shows about ${Number(day.km || 0).toFixed(1)} km travelled in work hours.`,
        });
    }

    return findings;
};

// Findings per date for a user and date range: Map(date -> findings), only days with findings.
// `facts` are the allowance day facts (date, km, station, points) for the same range.
const findingsFor = async (userId, from, to, facts, settings) => {
    const visits = await customQuery(DAY_VISITS, { UserId: userId, From: from, To: to });
    const byDay = new Map();
    visits.forEach((v) => {
        if (!byDay.has(v.WorkDate)) byDay.set(v.WorkDate, []);
        byDay.get(v.WorkDate).push(v);
    });
    const factByDate = new Map((facts || []).map((f) => [f.date, f]));

    const result = new Map();
    new Set([...byDay.keys(), ...factByDate.keys()]).forEach((date) => {
        const findings = findingsForDay(byDay.get(date) || [], factByDate.get(date), settings);
        if (findings.length) result.set(date, findings);
    });
    return result;
};

module.exports = { findingsForDay, findingsFor, _internals: { densestWindow, tightestSpot } };
