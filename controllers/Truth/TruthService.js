const { customQuery } = require('../../utils/dbFunctions');
const { displayName, IN_TEAM, teamIdsJson } = require('../../utils/reportScope');
const { requireActingUser, todayKey } = require('../../utils/access');

// Field Truth Score (0-100) for a month, from our own signals only - doctors are never asked.
//   Presence 40  visits verified at the clinic (Valid = full, Needs a look = half)
//   Pattern  20  minus visits that stop right at the minimum stay, and days with many doctors in minutes
//   Audits   25  joint / cross audits passed vs failed (no audit yet = neutral)
//   Outcome  15  after 90 days: share of visited doctors that prescribe (RCPA), vs the team (before = neutral)
// While "learning mode" is on (setting TRUTH_LEARNING_UNTIL = yyyymmdd), scores are for coaching only.

const WEIGHTS = { presence: 40, pattern: 20, audits: 25, outcome: 15 };
const OUTCOME_AFTER_DAYS = 90;

const USERS = `
    SELECT u.UserId, ${displayName('u')} AS Name, sld.SystemLovDetailName AS DesignationName, sld.SystemLovDetailCode AS DesignationCode,
           CONVERT(VARCHAR(10), COALESCE(ep.JoiningDate, CAST(u.CreatedOn AS DATE)), 23) AS JoiningDate
    FROM Users u
    LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = u.DesignationId
    LEFT JOIN dbo.EmployeeProfiles ep ON ep.UserId = u.UserId
    WHERE ISNULL(u.IsActive, 1) = 1 AND (u.UserId = @UserId OR (@UserId IS NULL AND ${IN_TEAM('u.UserId')}))`;

const USERS_NO_PROFILE = USERS.replace('LEFT JOIN dbo.EmployeeProfiles ep ON ep.UserId = u.UserId', '').replace('COALESCE(ep.JoiningDate, CAST(u.CreatedOn AS DATE))', 'CAST(u.CreatedOn AS DATE)');

const VISITS = `
    DECLARE @MinSec INT = 60 * ISNULL((SELECT TOP 1 TRY_CAST(SettingValue AS INT) FROM dbo.AntiFraudSettings WHERE SettingKey = 'MIN_DWELL_MINUTES'), 3);
    WITH V AS (
        SELECT v.UserId, v.DoctorId, v.DwellSeconds, COALESCE(v.ValidityOverride, v.Validity) AS FinalValidity
        FROM dbo.Visits v
        WHERE v.VisitDate BETWEEN @From AND @To AND v.UserId IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@Ids))
    ),
    Rx AS (
        SELECT DISTINCT r.DoctorId
        FROM dbo.RcpaEntries r INNER JOIN dbo.RcpaLines l ON l.RcpaId = r.RcpaId
        WHERE r.AuditDate >= DATEADD(DAY, -90, @To) AND l.OurQuantity > 0
    )
    SELECT V.UserId,
           COUNT(*) AS Visits,
           SUM(CASE WHEN V.FinalValidity = 'VALID' THEN 1 ELSE 0 END) AS Valid,
           SUM(CASE WHEN V.FinalValidity = 'REVIEW' THEN 1 ELSE 0 END) AS Review,
           SUM(CASE WHEN V.DwellSeconds IS NOT NULL THEN 1 ELSE 0 END) AS Timed,
           SUM(CASE WHEN V.DwellSeconds >= @MinSec AND V.DwellSeconds < @MinSec + 60 THEN 1 ELSE 0 END) AS JustEnough,
           COUNT(DISTINCT V.DoctorId) AS Doctors,
           COUNT(DISTINCT Rx.DoctorId) AS Prescribing
    FROM V
    LEFT JOIN Rx ON Rx.DoctorId = V.DoctorId
    GROUP BY V.UserId`;

const CHECKINS = `
    SELECT v.UserId, CONVERT(VARCHAR(10), v.VisitDate, 23) AS VisitDate, v.CheckInAt, v.DoctorId
    FROM dbo.Visits v
    WHERE v.VisitDate BETWEEN @From AND @To AND v.CheckInAt IS NOT NULL AND v.UserId IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@Ids))
    ORDER BY v.UserId, v.CheckInAt`;

const AUDITS = `
    SELECT a.UserId,
           SUM(CASE WHEN a.Status = 'PASSED' THEN 1 ELSE 0 END) AS Passed,
           SUM(CASE WHEN a.Status IN ('DOCTOR_NOT_FOUND', 'CLINIC_NOT_FOUND', 'NOT_RECOGNISED') THEN 1 ELSE 0 END) AS Failed
    FROM dbo.JointAudits a
    WHERE a.AuditDate BETWEEN DATEADD(DAY, -90, @To) AND @To AND a.UserId IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@Ids))
    GROUP BY a.UserId`;

const LEARNING = `SELECT TOP 1 SettingValue FROM dbo.AntiFraudSettings WHERE SettingKey = 'TRUTH_LEARNING_UNTIL'`;

const n = (v) => Number(v) || 0;
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);

const monthRange = (value) => {
    const month = /^\d{4}-\d{2}/.test(String(value || '')) ? String(value).slice(0, 7) : todayKey().slice(0, 7);
    const from = `${month}-01`;
    const end = new Date(`${from}T00:00:00`);
    end.setMonth(end.getMonth() + 1);
    end.setDate(0);
    const last = todayKey(end);
    return { month, from, to: last < todayKey() ? last : todayKey() };
};

// Days with N+ different doctors checked in within 20 minutes.
const rapidDays = (rows) => {
    const byDay = new Map();
    rows.forEach((r) => {
        const key = `${String(r.UserId).toLowerCase()}|${r.VisitDate}`;
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(r);
    });
    const perUser = new Map();
    byDay.forEach((list, key) => {
        let worst = 0;
        for (let i = 0; i < list.length; i += 1) {
            const start = new Date(list[i].CheckInAt).getTime();
            const doctors = new Set();
            for (let k = i; k < list.length && new Date(list[k].CheckInAt).getTime() - start <= 20 * 60000; k += 1) doctors.add(String(list[k].DoctorId).toLowerCase());
            worst = Math.max(worst, doctors.size);
        }
        if (worst >= 4) {
            const user = key.split('|')[0];
            perUser.set(user, (perUser.get(user) || 0) + 1);
        }
    });
    return perUser;
};

const optional = async (promise, fallback) => {
    try {
        return await promise;
    } catch (error) {
        if (/Invalid object name/i.test(error.message)) return fallback;
        throw error;
    }
};

const compute = async (users, range) => {
    const ids = JSON.stringify(users.map((u) => String(u.UserId)));
    const inputs = { Ids: ids, From: range.from, To: range.to };
    const [visits, checkins, audits, learning] = await Promise.all([
        customQuery(VISITS, inputs),
        customQuery(CHECKINS, inputs),
        optional(customQuery(AUDITS, inputs), []),
        optional(customQuery(LEARNING), []),
    ]);
    const key = (id) => String(id).toLowerCase();
    const visitOf = new Map(visits.map((r) => [key(r.UserId), r]));
    const auditOf = new Map(audits.map((r) => [key(r.UserId), r]));
    const rapid = rapidDays(checkins);

    // Team benchmark for the outcome part: average share of visited doctors that prescribe.
    const shares = visits.filter((r) => n(r.Doctors) >= 5).map((r) => n(r.Prescribing) / n(r.Doctors));
    const teamShare = shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : null;

    const learningUntil = String(learning[0]?.SettingValue || '');
    const learningMode = /^\d{8}$/.test(learningUntil) && `${learningUntil.slice(0, 4)}-${learningUntil.slice(4, 6)}-${learningUntil.slice(6, 8)}` >= todayKey();

    const scores = users.map((u) => {
        const v = visitOf.get(key(u.UserId)) || {};
        const a = auditOf.get(key(u.UserId)) || {};
        const visitsCount = n(v.Visits);
        const notes = [];

        const presencePart = visitsCount ? (n(v.Valid) + n(v.Review) * 0.5) / visitsCount : null;
        const presence = presencePart == null ? null : Math.round(presencePart * WEIGHTS.presence);

        const justPct = n(v.Timed) ? Math.round((n(v.JustEnough) / n(v.Timed)) * 100) : 0;
        const rapidCount = rapid.get(key(u.UserId)) || 0;
        let pattern = WEIGHTS.pattern;
        if (justPct >= 60) { pattern -= 10; notes.push(`${justPct}% of visits ended right at the minimum stay`); }
        if (rapidCount) { pattern -= Math.min(10, rapidCount * 5); notes.push(`${rapidCount} day(s) with many doctors in a few minutes`); }

        const audited = n(a.Passed) + n(a.Failed);
        const auditsPart = audited ? Math.round((n(a.Passed) / audited) * WEIGHTS.audits) : Math.round(WEIGHTS.audits / 2);
        if (!audited) notes.push('No audits in the last 90 days (counted as neutral)');
        if (n(a.Failed)) notes.push(`${a.Failed} failed audit(s)`);

        const tenure = u.JoiningDate ? daysBetween(u.JoiningDate, range.to) : 0;
        let outcome = Math.round(WEIGHTS.outcome / 2);
        let outcomeCounted = false;
        if (tenure >= OUTCOME_AFTER_DAYS && n(v.Doctors) >= 5 && teamShare) {
            const share = n(v.Prescribing) / n(v.Doctors);
            outcome = Math.round(Math.max(0, Math.min(1, share / teamShare)) * WEIGHTS.outcome);
            outcomeCounted = true;
        } else {
            notes.push(tenure < OUTCOME_AFTER_DAYS ? `Prescriptions count after ${OUTCOME_AFTER_DAYS} days in the job (neutral for now)` : 'Too few doctors to compare prescriptions (neutral)');
        }

        const total = presence == null ? null : presence + Math.max(0, pattern) + auditsPart + outcome;
        return {
            userId: u.UserId,
            name: u.Name,
            designation: u.DesignationName,
            joiningDate: u.JoiningDate,
            visits: visitsCount,
            score: total,
            band: total == null ? 'NO_DATA' : total >= 80 ? 'TRUSTED' : total >= 60 ? 'WATCH' : 'RISK',
            parts: {
                presence: { value: presence, max: WEIGHTS.presence, valid: n(v.Valid), review: n(v.Review) },
                pattern: { value: Math.max(0, pattern), max: WEIGHTS.pattern, justEnoughPct: justPct, rapidDays: rapidCount },
                audits: { value: auditsPart, max: WEIGHTS.audits, passed: n(a.Passed), failed: n(a.Failed) },
                outcome: { value: outcome, max: WEIGHTS.outcome, counted: outcomeCounted, prescribing: n(v.Prescribing), doctors: n(v.Doctors) },
            },
            notes,
        };
    });
    return { learningMode, learningUntil: learningMode ? learningUntil : null, teamShare: teamShare == null ? null : Math.round(teamShare * 100), scores };
};

const loadUsers = async (inputs) => {
    try {
        return await customQuery(USERS, inputs);
    } catch (error) {
        if (/EmployeeProfiles/i.test(error.message)) return customQuery(USERS_NO_PROFILE, inputs);
        throw error;
    }
};

// Everyone below the acting user (head office: the whole company), office admins left out.
exports.getScores = async (actingUserId, query) => {
    requireActingUser(actingUserId);
    const range = monthRange(query.month);
    const TeamIds = await teamIdsJson(actingUserId);
    const users = (await loadUsers({ UserId: null, TeamIds })).filter((u) => u.DesignationCode !== 'ADMIN');
    if (!users.length) return { month: range.month, available: false, scores: [] };
    const result = await compute(users, range);
    result.scores.sort((a, b) => (a.score ?? 999) - (b.score ?? 999));
    return { month: range.month, available: true, weights: WEIGHTS, ...result };
};

// A person's own score (audits shown as counts only - never which doctors).
exports.getMine = async (actingUserId, query) => {
    requireActingUser(actingUserId);
    const range = monthRange(query.month);
    const users = await loadUsers({ UserId: actingUserId, TeamIds: '[]' });
    if (!users.length) return { month: range.month, available: false };
    const result = await compute(users, range);
    return { month: range.month, available: true, weights: WEIGHTS, learningMode: result.learningMode, learningUntil: result.learningUntil, score: result.scores[0] };
};
