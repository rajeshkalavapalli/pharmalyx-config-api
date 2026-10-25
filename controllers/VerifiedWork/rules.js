// Pure rules for verified work (no database). Every number comes from `settings`,
// which head office can change per company; DEFAULTS are used when a value is missing.

const { distanceMeters } = require('../../utils/doctorMatching');

const DEFAULTS = {
    GEOFENCE_METERS: 200, // clinic radius
    MIN_DWELL_MINUTES: 3,
    MAX_WALK_KMH: 12,
    BOUNDARY_MARGIN_KM: 2.5,
    VISITS_CLASS_A: 3,
    VISITS_CLASS_B: 2,
    VISITS_CLASS_C: 1,
    DA_MIN_VALID_VISITS: 6,
    PING_INTERVAL_MINUTES: 10,
    WORK_START_HOUR: 7,
    WORK_END_HOUR: 21,
    TIMING_MIN_VISITS: 5,
    TIMING_MIN_SHARE: 0.6,
    UNPINNED_CLINIC_VALID: 0,
    REQUIRE_BOUNDARY: 0,
    // Day checks (a day that looks unusual is put on hold for review, never cut automatically).
    RAPID_VISITS_COUNT: 4, // this many visits checked in ...
    RAPID_WINDOW_MINUTES: 5, // ... within this many minutes (unless all in one hospital)
    ONE_SPOT_VISITS: 5, // this many visits to doctors of different areas ...
    ONE_SPOT_METERS: 100, // ... reported from within this distance of each other
    NO_TRAVEL_KM: 5, // an Ex-HQ / Outstation day with less travel than this
};

const IST_OFFSET_MINUTES = 330;

// Why a visit is not plain "counted" (shown to the MR, manager and head office).
// HARD reasons: clear evidence it was not a real visit -> NOT COUNTED (INVALID).
// Anything else (a short stop, weak or drifting GPS, moving phone, clinic not pinned) -> NEEDS A LOOK
// (REVIEW): it still counts for DA and coverage unless the manager or head office rejects it,
// and the employee can explain it. One honest miss never costs an employee money.
const REASONS = {
    NO_CHECKIN: 'Logged without a live check-in at the clinic (typed in later)',
    NO_GPS: 'No GPS location at check-in or check-out',
    MOCK_GPS: 'The phone reported a fake (mock) GPS location',
    IN_VEHICLE: 'The phone was moving in a vehicle',
    SHORT_STOP: 'Stayed at the clinic for less than the minimum time',
    NO_REAL_STOP: 'Under a minute at the clinic (a quick call)',
    AWAY_FROM_CLINIC: 'Check-in or check-out was not within the clinic radius',
    CLINIC_NOT_PINNED: "The doctor's clinic location is not pinned yet, so presence can't be checked",
    OUTSIDE_TERRITORY: 'Outside the approved territory boundary',
    NO_BOUNDARY: 'No approved territory boundary yet',
    OVERLAP: 'Overlaps another visit at the same time',
    ON_LEAVE: 'Logged on a day of approved leave',
};

const HARD_REASONS = new Set(['NO_CHECKIN', 'NO_GPS', 'MOCK_GPS', 'OUTSIDE_TERRITORY', 'OVERLAP', 'ON_LEAVE']);

// Under this many seconds a visit is a quick call (needs a look, still counts); many quick calls
// close together are caught by the day checks (dayChecks.js), which put the day on hold for review.
const NO_REAL_STOP_SECONDS = 60;

// VALID (counted), REVIEW (needs a look, counted) or INVALID (not counted).
const validityFor = (reasons) => (!reasons.length ? 'VALID' : reasons.some((r) => HARD_REASONS.has(r)) ? 'INVALID' : 'REVIEW');

// Results that count towards DA, coverage and targets.
const COUNTED = ['VALID', 'REVIEW'];

// ---------------------------------------------------------------------
// Time helpers (IST)
// ---------------------------------------------------------------------

const toIst = (date) => new Date(new Date(date).getTime() + IST_OFFSET_MINUTES * 60000);

// YYYY-MM-DD in IST.
const istDateKey = (date = new Date()) => toIst(date).toISOString().slice(0, 10);

const istHour = (date) => toIst(date).getUTCHours() + toIst(date).getUTCMinutes() / 60;

const inWorkHours = (date, settings) => {
    const hour = istHour(date);
    return hour >= settings.WORK_START_HOUR && hour < settings.WORK_END_HOUR;
};

// ---------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------

// Ray casting on lat / lng (fine for territory-sized shapes). polygon: [[lat, lng], ...]
const pointInPolygon = (lat, lng, polygon) => {
    if (!Array.isArray(polygon) || polygon.length < 3) return false;

    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [latI, lngI] = polygon[i];
        const [latJ, lngJ] = polygon[j];
        const crosses = lngI > lng !== lngJ > lng && lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI) + latI;
        if (crosses) inside = !inside;
    }
    return inside;
};

// Convex hull (monotone chain) of [lat, lng] points, returned as [[lat, lng], ...].
const convexHull = (points) => {
    const pts = [...new Map(points.map((p) => [`${p[0].toFixed(6)},${p[1].toFixed(6)}`, p])).values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    if (pts.length < 3) return pts;

    // x = lng, y = lat
    const cross = (o, a, b) => (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
    const lower = [];
    for (const p of pts) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
    }
    upper.pop();
    lower.pop();
    return lower.concat(upper);
};

// Boundary around the doctors' clinics with a margin: the hull of a circle (16 points) around each clinic.
const autoBoundary = (clinics, marginKm) => {
    const margin = Number(marginKm) * 1000;
    const ring = [];

    clinics.forEach(([lat, lng]) => {
        const dLat = margin / 111320;
        const dLng = margin / (111320 * Math.cos((lat * Math.PI) / 180));
        for (let k = 0; k < 16; k++) {
            const angle = (2 * Math.PI * k) / 16;
            ring.push([Number((lat + dLat * Math.sin(angle)).toFixed(6)), Number((lng + dLng * Math.cos(angle)).toFixed(6))]);
        }
    });

    return convexHull(ring);
};

// Checks a drawn / edited polygon: 3-200 points, valid coordinates.
const parsePolygon = (value) => {
    let points = value;
    if (typeof value === 'string') {
        try {
            points = JSON.parse(value);
        } catch {
            return null;
        }
    }
    if (!Array.isArray(points) || points.length < 3 || points.length > 200) return null;

    const clean = points.map((p) => [Number(p?.[0]), Number(p?.[1])]);
    if (clean.some(([lat, lng]) => !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)) return null;
    return clean.map(([lat, lng]) => [Number(lat.toFixed(6)), Number(lng.toFixed(6))]);
};

// Inside any of the allowed boundaries? null when there is nothing to check against.
const insideAny = (lat, lng, polygons) => {
    if (lat == null || lng == null || !polygons.length) return null;
    return polygons.some((polygon) => pointInPolygon(Number(lat), Number(lng), polygon));
};

// ---------------------------------------------------------------------
// Visit validity
// ---------------------------------------------------------------------

/**
 * Decides whether a visit counts. Never uses doctor timing.
 *  checkIn / checkOut: { at, lat, lng, accuracy, isMock, activity } (at = server time)
 *  clinic: { lat, lng, radius } (hospital or doctor's pinned clinic) or null
 *  territory: { polygons, exception } exception = 'DOCTOR' | 'SPECIAL_DUTY' | 'COVER' | null
 *  motion: activities seen during the visit (from the phone), e.g. ['STILL', 'WALKING']
 *  overlaps: true when another of the MR's visits overlaps this one
 */
const judgeVisit = ({ checkIn, checkOut, clinic, territory, motion = [], overlaps = false, onLeave = false, settings }) => {
    const reasons = [];
    const notes = [];

    if (!checkIn) {
        reasons.push('NO_CHECKIN');
        return { validity: 'INVALID', reasons, notes, dwellSeconds: null, insideBoundary: null };
    }

    const fixes = [checkIn, checkOut].filter(Boolean);
    const hasGps = fixes.length === 2 && fixes.every((fix) => fix.lat != null && fix.lng != null);
    if (!hasGps) reasons.push('NO_GPS');

    if (fixes.some((fix) => fix.isMock)) reasons.push('MOCK_GPS');

    const dwellSeconds = checkOut ? Math.max(0, Math.round((new Date(checkOut.at) - new Date(checkIn.at)) / 1000)) : 0;

    // Moving: the phone said "in vehicle", or the two fixes imply vehicle speed.
    const activities = [checkIn.activity, checkOut?.activity, ...motion].map((a) => String(a || '').toUpperCase());
    let moving = activities.includes('IN_VEHICLE');
    if (!moving && hasGps && dwellSeconds > 0) {
        const metres = distanceMeters(checkIn.lat, checkIn.lng, checkOut.lat, checkOut.lng) || 0;
        const kmh = metres / 1000 / (dwellSeconds / 3600);
        if (metres > 100 && kmh > settings.MAX_WALK_KMH) moving = true;
    }
    if (moving) reasons.push('IN_VEHICLE');

    // Doctors often give only a minute ("brand and MRP, then go"): a quick call still counts.
    if (dwellSeconds < NO_REAL_STOP_SECONDS) reasons.push('NO_REAL_STOP');
    else if (dwellSeconds < settings.MIN_DWELL_MINUTES * 60) reasons.push('SHORT_STOP');

    // Presence at the clinic: both fixes inside the radius (GPS accuracy up to 100 m is allowed for).
    if (clinic && clinic.lat != null && clinic.lng != null) {
        if (hasGps) {
            const radius = Number(clinic.radius) || settings.GEOFENCE_METERS;
            const away = fixes.some((fix) => {
                const metres = distanceMeters(fix.lat, fix.lng, Number(clinic.lat), Number(clinic.lng));
                return metres - Math.min(Number(fix.accuracy) || 0, 100) > radius;
            });
            if (away) reasons.push('AWAY_FROM_CLINIC');
        }
    } else if (Number(settings.UNPINNED_CLINIC_VALID) === 1) {
        notes.push('CLINIC_NOT_PINNED');
    } else {
        reasons.push('CLINIC_NOT_PINNED');
    }

    // Territory: inside the boundary, unless head office granted an exception.
    let insideBoundary = null;
    if (hasGps) {
        insideBoundary = insideAny(checkIn.lat, checkIn.lng, territory?.polygons || []);
        if (insideBoundary === false && !territory?.exception) reasons.push('OUTSIDE_TERRITORY');
        if (insideBoundary === null) {
            if (Number(settings.REQUIRE_BOUNDARY) === 1 && !territory?.exception) reasons.push('NO_BOUNDARY');
            else notes.push('NO_BOUNDARY');
        }
    }

    if (overlaps) reasons.push('OVERLAP');
    if (onLeave) reasons.push('ON_LEAVE');

    return { validity: validityFor(reasons), reasons, notes, dwellSeconds, insideBoundary };
};

// Intervals [start, end] overlap (touching ends do not count).
const overlapsAny = (start, end, others) =>
    others.some((other) => other.start && other.end && new Date(start) < new Date(other.end) && new Date(other.start) < new Date(end));

// ---------------------------------------------------------------------
// Distance actually travelled (TA)
// ---------------------------------------------------------------------

const MAX_ACCURACY_M = 200;
const MIN_HOP_M = 30; // GPS jitter while standing still
const MAX_PLAUSIBLE_KMH = 150;

// points: [{ at, lat, lng, accuracy, isMock }] in any order -> km travelled (2 decimals) + dropped points.
const travelledKm = (points) => {
    const usable = points
        .filter((p) => p && p.lat != null && p.lng != null && !p.isMock && (p.accuracy == null || Number(p.accuracy) <= MAX_ACCURACY_M))
        .map((p) => ({ ...p, t: new Date(p.at).getTime(), lat: Number(p.lat), lng: Number(p.lng) }))
        .sort((a, b) => a.t - b.t);

    let metres = 0;
    let dropped = 0;
    let last = usable[0] || null;

    for (let i = 1; i < usable.length; i++) {
        const point = usable[i];
        const hop = distanceMeters(last.lat, last.lng, point.lat, point.lng) || 0;
        const hours = (point.t - last.t) / 3600000;

        if (hop < MIN_HOP_M) continue; // standing still; keep the earlier anchor
        if (hours <= 0 || hop / 1000 / hours > MAX_PLAUSIBLE_KMH) {
            dropped++; // a jump no road trip can make: ignore this point
            continue;
        }
        metres += hop;
        last = point;
    }

    return { km: Math.round(metres / 10) / 100, points: usable.length, dropped };
};

// ---------------------------------------------------------------------
// Doctor timing suggestion (plan order only, never validity)
// ---------------------------------------------------------------------

const SLOTS = [
    { code: 'MORNING', label: 'Morning (6 AM – 12 PM)', from: 6, to: 12 },
    { code: 'AFTERNOON', label: 'Afternoon (12 – 5 PM)', from: 12, to: 17 },
    { code: 'EVENING', label: 'Evening (5 – 10 PM)', from: 17, to: 22 },
    { code: 'NIGHT', label: 'Night (10 PM – 6 AM)', from: 22, to: 30 },
];

const slotOf = (date) => {
    const hour = istHour(date);
    return SLOTS.find((slot) => (hour >= slot.from && hour < slot.to) || (slot.code === 'NIGHT' && hour < 6)).code;
};

// times: valid visit check-in times -> { slot, label, visits } or { slot: null, label: 'No fixed timing' }
const timingSuggestion = (times, settings) => {
    const counts = {};
    times.forEach((time) => {
        const slot = slotOf(time);
        counts[slot] = (counts[slot] || 0) + 1;
    });

    const total = times.length;
    const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [null, 0];

    if (total >= settings.TIMING_MIN_VISITS && best && count / total >= settings.TIMING_MIN_SHARE) {
        const slot = SLOTS.find((item) => item.code === best);
        return { slot: best, label: `Usually available: ${slot.label}`, visits: total };
    }
    return { slot: null, label: 'No fixed timing', visits: total };
};

const SLOT_ORDER = { MORNING: 0, AFTERNOON: 1, EVENING: 2, NIGHT: 3 };

// Day order: doctors with a known slot by slot, then the rest (class A first).
const orderByTiming = (doctors) =>
    [...doctors].sort(
        (a, b) =>
            (a.timing?.slot ? SLOT_ORDER[a.timing.slot] : 9) - (b.timing?.slot ? SLOT_ORDER[b.timing.slot] : 9) ||
            String(a.Category || 'Z').localeCompare(String(b.Category || 'Z')) ||
            String(a.DoctorName).localeCompare(String(b.DoctorName))
    );

// ---------------------------------------------------------------------
// STP -> month plan
// ---------------------------------------------------------------------

const requiredVisits = (doctor, settings) => {
    const own = Number(doctor.VisitsPerMonth);
    if (Number.isInteger(own) && own > 0) return own;
    return { A: settings.VISITS_CLASS_A, B: settings.VISITS_CLASS_B, C: settings.VISITS_CLASS_C }[String(doctor.Category || '').toUpperCase()] || settings.VISITS_CLASS_C;
};

const pad = (n) => String(n).padStart(2, '0');

const monthDates = (monthStart) => {
    const year = Number(monthStart.slice(0, 4));
    const month = Number(monthStart.slice(5, 7));
    const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return Array.from({ length: count }, (_, i) => `${monthStart.slice(0, 8)}${pad(i + 1)}`);
};

// 1 = Monday .. 7 = Sunday
const weekdayOf = (dateKey) => ((new Date(`${dateKey}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

// Week of the month (1-based) folded into the STP cycle: day 1-7 = week 1, 8-14 = week 2, ...
const cycleWeekOf = (dateKey, cycleWeeks) => (Math.floor((Number(dateKey.slice(8, 10)) - 1) / 7) % Math.max(1, cycleWeeks)) + 1;

/**
 * Builds the month from the STP: each date gets the patch for its cycle week and weekday.
 * leaveDates: dates of approved leave (no field work).
 * Returns [{ date, areaId | null, dayType }]
 */
const planFromStp = (monthStart, stp, days, leaveDates = new Set()) => {
    const slot = new Map(days.map((day) => [`${day.CycleWeek}:${day.Weekday}`, day.AreaId || null]));

    return monthDates(monthStart).map((date) => {
        if (leaveDates.has(date)) return { date, areaId: null, dayType: 'non-working', remarks: 'Leave' };
        const areaId = slot.get(`${cycleWeekOf(date, stp.CycleWeeks)}:${weekdayOf(date)}`) || null;
        return { date, areaId, dayType: areaId ? 'working' : 'non-working', remarks: areaId ? 'From STP' : null };
    });
};

// Which of a patch's planned dates each doctor should be seen on: `remaining` dates spread evenly.
const spreadDates = (dates, remaining) => {
    if (remaining <= 0 || !dates.length) return [];
    if (remaining >= dates.length) return [...dates];
    return Array.from({ length: remaining }, (_, i) => dates[Math.floor((i * dates.length) / remaining)]);
};

// Station type for TA / DA: the "furthest" patch type among the day's valid visits.
const stationFor = (patchTypes) => {
    if (patchTypes.includes('OUTSTATION')) return 'OUTSTATION';
    if (patchTypes.includes('EX_HQ')) return 'EX_HQ';
    return 'HQ';
};

module.exports = {
    DEFAULTS,
    REASONS,
    SLOTS,
    istDateKey,
    istHour,
    inWorkHours,
    pointInPolygon,
    convexHull,
    autoBoundary,
    parsePolygon,
    insideAny,
    judgeVisit,
    validityFor,
    HARD_REASONS,
    NO_REAL_STOP_SECONDS,
    COUNTED,
    overlapsAny,
    travelledKm,
    slotOf,
    timingSuggestion,
    orderByTiming,
    requiredVisits,
    monthDates,
    weekdayOf,
    cycleWeekOf,
    planFromStp,
    spreadDates,
    stationFor,
};
