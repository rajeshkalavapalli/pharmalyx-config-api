// Shared helpers: company rule values, and what territory a user may work in on a date.
// Used by visits, the tour plan, day start and TA / DA.

const DA = require('./VerifiedWorkDA');
const { DEFAULTS, parsePolygon } = require('./rules');

const loadSettings = async () => {
    try {
        const rows = await DA.getSettings();
        const saved = Object.fromEntries(rows.map((row) => [row.SettingKey, Number(row.SettingValue)]).filter(([, value]) => Number.isFinite(value)));
        return { ...DEFAULTS, ...saved };
    } catch {
        return { ...DEFAULTS };
    }
};

/**
 * Allowed territory for a user on a date:
 *  polygons: approved boundaries of the user + their team (a manager covers the team's territory)
 *            + colleagues' boundaries they cover (head-office COVER exception)
 *  specialDuty: head office allowed work anywhere that day
 *  doctorExceptions: doctors just outside the boundary that still count
 */
const allowedTerritory = async (userId, date) => {
    const [own, exceptions] = await Promise.all([DA.teamBoundaries(userId), DA.activeExceptions(userId, date)]);

    const polygons = own.map((row) => parsePolygon(row.Polygon)).filter(Boolean);
    exceptions.filter((e) => e.ExceptionType === 'COVER' && e.CoverPolygon).forEach((e) => {
        const polygon = parsePolygon(e.CoverPolygon);
        if (polygon) polygons.push(polygon);
    });

    return {
        polygons,
        specialDuty: exceptions.some((e) => e.ExceptionType === 'SPECIAL_DUTY'),
        doctorExceptions: new Set(exceptions.filter((e) => e.ExceptionType === 'DOCTOR' && e.DoctorId).map((e) => String(e.DoctorId).toLowerCase())),
        hasOwnBoundary: own.length > 0,
    };
};

// The exception (if any) that lets this visit count outside the boundary.
const exceptionFor = (territory, doctorId) => {
    if (territory.specialDuty) return 'SPECIAL_DUTY';
    if (doctorId && territory.doctorExceptions.has(String(doctorId).toLowerCase())) return 'DOCTOR';
    return null;
};

module.exports = { loadSettings, allowedTerritory, exceptionFor };
