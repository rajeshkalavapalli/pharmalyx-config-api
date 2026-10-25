// Facts for TA / DA per day, from verified work only (not the tour plan or the MR's claim):
//   validVisits  valid visits that day (DA needs at least DA_MIN_VALID_VISITS)
//   km           distance actually travelled in work hours (GPS pings, day start, check-ins, check-outs)
//   station      HQ / EX_HQ / OUTSTATION from the STP patch types of the day's valid visits
// A day appears only if it has at least one valid visit.

const { customQuery } = require('../../utils/dbFunctions');
const { EFFECTIVE } = require('./sql');
const DA = require('./VerifiedWorkDA');
const rules = require('./rules');
const { loadSettings } = require('./territory');
const { kmByDay } = require('./VerifiedWorkService');

const VALID_DAYS = `
    SELECT CONVERT(VARCHAR(10), v.VisitDate, 23) AS WorkDate, COUNT(*) AS ValidVisits,
           STRING_AGG(CONVERT(VARCHAR(36), TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId)), ',') AS AreaIds
    FROM dbo.Visits v
    INNER JOIN dbo.Doctor d ON d.DoctorId = v.DoctorId
    WHERE v.UserId = @UserId AND v.VisitDate BETWEEN @From AND @To AND ${EFFECTIVE} IN ('VALID', 'REVIEW')
    GROUP BY v.VisitDate
`;

// The MR still says how they travelled in the DCR; the distance itself is measured.
const DCRS = `
    SELECT DcrId, CONVERT(VARCHAR(10), ReportDate, 23) AS ReportDate, TravelMode
    FROM dbo.DailyCallReports WHERE UserId = @UserId AND ReportDate BETWEEN @From AND @To
`;

exports.dayFacts = async (userId, from, to) => {
    const settings = await loadSettings();
    const [days, dcrs, areas, km] = await Promise.all([
        customQuery(VALID_DAYS, { UserId: userId, From: from, To: to }),
        customQuery(DCRS, { UserId: userId, From: from, To: to }),
        DA.myAreas(userId),
        kmByDay(userId, from, to),
    ]);

    const patchType = new Map(areas.map((area) => [String(area.AreaId).toLowerCase(), area.PatchType || 'HQ']));
    const dcrByDate = new Map(dcrs.map((dcr) => [dcr.ReportDate, dcr]));

    return days.map((day) => {
        const types = String(day.AreaIds || '')
            .split(',')
            .filter(Boolean)
            .map((id) => patchType.get(id.toLowerCase()) || 'HQ');
        const dcr = dcrByDate.get(day.WorkDate);
        const validVisits = Number(day.ValidVisits) || 0;

        return {
            date: day.WorkDate,
            validVisits,
            daEligible: validVisits >= settings.DA_MIN_VALID_VISITS,
            km: km.get(day.WorkDate)?.km || 0,
            points: km.get(day.WorkDate)?.points || 0, // location records used for the km (day checks need a trail)
            station: rules.stationFor(types),
            travelMode: dcr?.TravelMode || 'OTHER',
            dcrId: dcr?.DcrId || null,
        };
    });
};

exports.daMinValidVisits = async () => (await loadSettings()).DA_MIN_VALID_VISITS;
