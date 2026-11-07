const { customQuery } = require('../../utils/dbFunctions');
const { canViewUser, fail, isGuid, requireActingUser, todayKey } = require('../../utils/access');
const { teamIdsJson } = require('../../utils/reportScope');

// Market truth: where each doctor is on the way to prescribing, and whether a brand problem or a rep problem
// is behind low prescriptions (same brand, peers compared). Uses visits, samples given, RCPA and doctor business.

const STAGES = [
    { key: 'NOT_VISITED', label: 'Not visited (90 days)' },
    { key: 'VISITED', label: 'Visited' },
    { key: 'SAMPLED', label: 'Samples given' },
    { key: 'FIRST_RX', label: 'First prescription' },
    { key: 'REGULAR', label: 'Regular prescriber' },
    { key: 'STALLED', label: 'Stalled: many visits, no Rx' },
];
const STALL_VISITS = 6; // visits in 90 days with nothing to show

const JOURNEY = `
    WITH Mine AS (
        SELECT d.DoctorId, d.DoctorName, d.Category, d.Speciality, a.AreaName
        FROM dbo.UserDoctorMapping m
        INNER JOIN dbo.Doctor d ON d.DoctorId = m.DoctorId
        LEFT JOIN Areas a ON a.AreaId = TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId)
        WHERE m.UserId = @UserId AND ISNULL(m.IsActive, 'Yes') <> 'No' AND ISNULL(d.IsActive, 'Yes') <> 'No'
    )
    SELECT x.DoctorId, x.DoctorName, x.Category, x.Speciality, x.AreaName,
           (SELECT COUNT(*) FROM dbo.Visits v WHERE v.UserId = @UserId AND v.DoctorId = x.DoctorId AND v.VisitDate >= @Since) AS Visits,
           (SELECT CONVERT(VARCHAR(10), MAX(v.VisitDate), 23) FROM dbo.Visits v WHERE v.UserId = @UserId AND v.DoctorId = x.DoctorId) AS LastVisit,
           (SELECT ISNULL(SUM(-s.Quantity), 0) FROM dbo.EngagementStock s WHERE s.DoctorId = x.DoctorId AND s.UserId = @UserId AND s.EntryType = 'DISTRIBUTION' AND s.EntryDate >= @Since) AS SamplesGiven,
           (SELECT COUNT(DISTINCT CONVERT(VARCHAR(7), r.AuditDate, 23)) FROM dbo.RcpaEntries r INNER JOIN dbo.RcpaLines l ON l.RcpaId = r.RcpaId
             WHERE r.DoctorId = x.DoctorId AND r.AuditDate >= @Since AND l.OurQuantity > 0) AS RxMonths,
           (SELECT COUNT(*) FROM dbo.DoctorBusiness b WHERE b.DoctorId = x.DoctorId AND b.BusinessMonth >= @SinceMonth AND b.ActualValue > 0) AS BusinessMonths
    FROM Mine x`;

// Per product and rep: doctors visited in the period, and how many of them prescribe that product (RCPA).
const BRANDS = `
    WITH V AS (
        SELECT DISTINCT v.UserId, v.DoctorId
        FROM dbo.Visits v
        WHERE v.VisitDate >= @Since AND v.UserId IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@Ids))
    ),
    Rx AS (
        SELECT DISTINCT r.DoctorId, l.ProductId
        FROM dbo.RcpaEntries r INNER JOIN dbo.RcpaLines l ON l.RcpaId = r.RcpaId
        WHERE r.AuditDate >= @Since AND l.OurQuantity > 0 AND l.ProductId IS NOT NULL
    ),
    Audited AS (
        SELECT DISTINCT r.DoctorId, l.ProductId
        FROM dbo.RcpaEntries r INNER JOIN dbo.RcpaLines l ON l.RcpaId = r.RcpaId
        WHERE r.AuditDate >= @Since AND l.ProductId IS NOT NULL
    )
    SELECT V.UserId, ${'COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.FirstName, \' \', u.LastName))), \'\'), u.UserName)'} AS Name,
           a.ProductId, p.ProductName,
           COUNT(DISTINCT a.DoctorId) AS AuditedDoctors,
           COUNT(DISTINCT rx.DoctorId) AS PrescribingDoctors
    FROM V
    INNER JOIN Users u ON u.UserId = V.UserId
    INNER JOIN Audited a ON a.DoctorId = V.DoctorId
    INNER JOIN dbo.Products p ON p.ProductId = a.ProductId
    LEFT JOIN Rx rx ON rx.DoctorId = a.DoctorId AND rx.ProductId = a.ProductId
    GROUP BY V.UserId, u.FirstName, u.LastName, u.UserName, a.ProductId, p.ProductName`;

const n = (v) => Number(v) || 0;
const pct = (a, b) => (b ? Math.round((n(a) / n(b)) * 100) : null);
const daysAgo = (days) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return todayKey(d);
};

const stageOf = (row) => {
    const visits = n(row.Visits);
    const rx = Math.max(n(row.RxMonths), n(row.BusinessMonths));
    if (rx >= 2) return 'REGULAR';
    if (rx === 1) return 'FIRST_RX';
    if (visits >= STALL_VISITS) return 'STALLED';
    if (n(row.SamplesGiven) > 0) return 'SAMPLED';
    if (visits > 0) return 'VISITED';
    return 'NOT_VISITED';
};

// One person's doctors by stage (yourself, or someone you can see).
exports.getJourney = async (actingUserId, query) => {
    requireActingUser(actingUserId);
    const userId = query.userId || actingUserId;
    if (!isGuid(userId)) throw fail(400, 'User is invalid.');
    if (!(await canViewUser(actingUserId, userId))) throw fail(403, "You can only see your own or your team's doctors.");

    const since = daysAgo(90);
    const rows = await customQuery(JOURNEY, { UserId: userId, Since: since, SinceMonth: `${since.slice(0, 7)}-01` });
    const doctors = rows.map((r) => ({
        doctorId: r.DoctorId,
        doctorName: r.DoctorName,
        category: r.Category,
        speciality: r.Speciality,
        areaName: r.AreaName,
        visits: n(r.Visits),
        lastVisit: r.LastVisit,
        samplesGiven: n(r.SamplesGiven),
        rxMonths: Math.max(n(r.RxMonths), n(r.BusinessMonths)),
        stage: stageOf(r),
    }));
    const order = new Map(STAGES.map((s, i) => [s.key, i]));
    doctors.sort((a, b) => order.get(a.stage) - order.get(b.stage) || b.visits - a.visits);
    return {
        since,
        stages: STAGES.map((s) => ({ ...s, count: doctors.filter((d) => d.stage === s.key).length })),
        doctors,
    };
};

// Brand x rep conversion: share of RCPA-audited, visited doctors that prescribe each product.
// A brand low for everyone points at the brand (price, competition); one rep far below peers points at the rep.
exports.getBrands = async (actingUserId) => {
    requireActingUser(actingUserId);
    const ids = JSON.parse(await teamIdsJson(actingUserId));
    ids.push(String(actingUserId));
    const rows = await customQuery(BRANDS, { Ids: JSON.stringify(ids), Since: daysAgo(90) });

    const byProduct = new Map();
    rows.forEach((r) => {
        const key = String(r.ProductId).toLowerCase();
        if (!byProduct.has(key)) byProduct.set(key, { productId: r.ProductId, productName: r.ProductName, audited: 0, prescribing: 0, reps: [] });
        const p = byProduct.get(key);
        p.audited += n(r.AuditedDoctors);
        p.prescribing += n(r.PrescribingDoctors);
        p.reps.push({ userId: r.UserId, name: r.Name, audited: n(r.AuditedDoctors), prescribing: n(r.PrescribingDoctors), conversion: pct(r.PrescribingDoctors, r.AuditedDoctors) });
    });

    const products = [...byProduct.values()].map((p) => {
        const team = pct(p.prescribing, p.audited);
        const reps = p.reps
            .map((r) => ({ ...r, vsTeam: team == null || r.conversion == null ? null : r.conversion - team }))
            .sort((a, b) => (a.conversion ?? 0) - (b.conversion ?? 0));
        // Verdict: brand-wide weakness, or individual reps well below their peers.
        const behind = reps.filter((r) => r.audited >= 3 && r.vsTeam != null && r.vsTeam <= -20);
        const verdict = p.audited >= 5 && team != null && team < 20 ? 'BRAND_WEAK' : behind.length ? 'REPS_BEHIND' : 'OK';
        return { productId: p.productId, productName: p.productName, auditedDoctors: p.audited, prescribingDoctors: p.prescribing, teamConversion: team, verdict, repsBehind: behind.map((r) => r.name), reps };
    });
    products.sort((a, b) => (a.teamConversion ?? 101) - (b.teamConversion ?? 101));
    return { since: daysAgo(90), products };
};

exports.STAGES = STAGES;
