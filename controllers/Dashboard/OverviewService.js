const { customQuery } = require('../../utils/dbFunctions');
const { requireActingUser, todayKey } = require('../../utils/access');
const { displayName, IN_TEAM, teamIdsJson, viewAllFor } = require('../../utils/reportScope');

// Company / team overview for managers and head office: headline numbers for the month,
// a leaderboard of the people below them, the latest field activity and what needs attention.
// Everything covers the acting user's team at all levels (head office: the whole company).

const VALID = 'COALESCE(v.ValidityOverride, v.Validity)';
const TEAM_U = IN_TEAM('u.UserId');

const SQL = {
    HEADLINE: `
        SELECT
            (SELECT COUNT(*) FROM dbo.Visits v INNER JOIN Users u ON u.UserId = v.UserId WHERE ${TEAM_U} AND v.VisitDate = @Today) AS VisitsToday,
            (SELECT COUNT(DISTINCT v.UserId) FROM dbo.Visits v INNER JOIN Users u ON u.UserId = v.UserId WHERE ${TEAM_U} AND v.VisitDate = @Today) AS RepsActiveToday,
            (SELECT COUNT(*) FROM dbo.Visits v INNER JOIN Users u ON u.UserId = v.UserId WHERE ${TEAM_U} AND v.VisitDate BETWEEN @MonthStart AND @MonthEnd) AS VisitsMonth,
            (SELECT COUNT(*) FROM dbo.Visits v INNER JOIN Users u ON u.UserId = v.UserId WHERE ${TEAM_U} AND v.VisitDate BETWEEN @MonthStart AND @MonthEnd AND ${VALID} = 'VALID') AS ValidMonth,
            (SELECT ISNULL(SUM(o.NetAmount), 0) FROM dbo.Orders o INNER JOIN Users u ON u.UserId = o.UserId WHERE ${TEAM_U} AND o.OrderDate BETWEEN @MonthStart AND @MonthEnd AND o.Status <> 'CANCELLED') AS PobValue,
            (SELECT COUNT(*) FROM dbo.Orders o INNER JOIN Users u ON u.UserId = o.UserId WHERE ${TEAM_U} AND o.OrderDate BETWEEN @MonthStart AND @MonthEnd AND o.Status <> 'CANCELLED') AS PobCount,
            (SELECT ISNULL(SUM(st.SalesValue), 0) FROM dbo.SecondaryStatements st INNER JOIN Users u ON u.UserId = st.UserId WHERE ${TEAM_U} AND st.StatementMonth = @MonthStart AND st.Status IN ('SUBMITTED', 'APPROVED')) AS SecondaryValue,
            (SELECT ISNULL(SUM(d.TotalValue), 0) FROM dbo.ChemistDeliveries d INNER JOIN Users u ON u.UserId = d.UserId WHERE ${TEAM_U} AND d.DeliveryDate BETWEEN @MonthStart AND @MonthEnd AND d.VoidedOn IS NULL) AS DeliveredValue,
            (SELECT ISNULL(SUM(ABS(c.Amount)), 0) FROM dbo.ChemistLedger c INNER JOIN Users u ON u.UserId = c.UserId WHERE ${TEAM_U} AND c.EntryType = 'PAYMENT' AND c.EntryDate BETWEEN @MonthStart AND @MonthEnd AND c.VoidedOn IS NULL) AS Collected,
            (SELECT COUNT(*) FROM dbo.ChemistLedger c INNER JOIN Users u ON u.UserId = c.UserId WHERE ${TEAM_U} AND c.EntryType = 'PAYMENT' AND c.DepositStatus = 'WITH_MR' AND c.VoidedOn IS NULL) AS PaymentsToConfirm,
            (SELECT ISNULL(SUM(ABS(c.Amount)), 0) FROM dbo.ChemistLedger c INNER JOIN Users u ON u.UserId = c.UserId WHERE ${TEAM_U} AND c.EntryType = 'PAYMENT' AND c.DepositStatus = 'WITH_MR' AND c.VoidedOn IS NULL) AS CashWithMrs
    `,

    // One row per person below the acting user (active), with this month's numbers.
    LEADERBOARD: `
        SELECT u.UserId, ${displayName('u')} AS Name, sld.SystemLovDetailName AS DesignationName,
               ISNULL(vs.Visits, 0) AS Visits, ISNULL(vs.Valid, 0) AS Valid, ISNULL(vs.Doctors, 0) AS Doctors,
               ISNULL(os.PobValue, 0) AS PobValue, ISNULL(ds.DcrSent, 0) AS DcrSent, vs.LastVisit
        FROM Users u
        LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = u.DesignationId
        OUTER APPLY (
            SELECT COUNT(*) AS Visits, SUM(CASE WHEN ${VALID} = 'VALID' THEN 1 ELSE 0 END) AS Valid,
                   COUNT(DISTINCT v.DoctorId) AS Doctors, MAX(v.VisitDate) AS LastVisit
            FROM dbo.Visits v WHERE v.UserId = u.UserId AND v.VisitDate BETWEEN @MonthStart AND @MonthEnd
        ) vs
        OUTER APPLY (
            SELECT SUM(o.NetAmount) AS PobValue FROM dbo.Orders o
            WHERE o.UserId = u.UserId AND o.OrderDate BETWEEN @MonthStart AND @MonthEnd AND o.Status <> 'CANCELLED'
        ) os
        OUTER APPLY (
            SELECT COUNT(*) AS DcrSent FROM dbo.DailyCallReports r
            WHERE r.UserId = u.UserId AND r.ReportDate BETWEEN @MonthStart AND @MonthEnd AND r.Status IN ('SUBMITTED', 'APPROVED')
        ) ds
        -- Field people only: office admins are not ranked or counted as "not in the field".
        WHERE ${TEAM_U} AND ISNULL(u.IsActive, 1) = 1 AND ISNULL(sld.SystemLovDetailCode, '') <> 'ADMIN'
    `,

    // Latest field events across the team (newest first).
    ACTIVITY: `
        SELECT TOP 15 * FROM (
            SELECT 'VISIT' AS Kind, COALESCE(v.CheckInAt, v.RecordedAt, v.CreatedOn) AS At, ${displayName('u')} AS Who,
                   CONCAT('Visited Dr. ', d.DoctorName) AS Text, ${VALID} AS Tag
            FROM dbo.Visits v INNER JOIN Users u ON u.UserId = v.UserId LEFT JOIN dbo.Doctor d ON d.DoctorId = v.DoctorId
            WHERE ${TEAM_U} AND v.VisitDate >= @Since
            UNION ALL
            SELECT 'ORDER', o.CreatedOn, ${displayName('u')}, CONCAT(N'Booked ', o.OrderNumber, N' · ₹', FORMAT(o.NetAmount, 'N0')), o.Status
            FROM dbo.Orders o INNER JOIN Users u ON u.UserId = o.UserId
            WHERE ${TEAM_U} AND o.OrderDate >= @Since
            UNION ALL
            SELECT 'DELIVERY', dl.CreatedOn, ${displayName('u')}, CONCAT(N'Delivered to ', p.PharmacyName, N' · ₹', FORMAT(dl.TotalValue, 'N0')), NULL
            FROM dbo.ChemistDeliveries dl INNER JOIN Users u ON u.UserId = dl.UserId LEFT JOIN Pharmacy p ON p.PharmacyId = dl.PharmacyId
            WHERE ${TEAM_U} AND dl.DeliveryDate >= @Since AND dl.VoidedOn IS NULL
            UNION ALL
            SELECT 'PAYMENT', c.CreatedOn, ${displayName('u')}, CONCAT(N'Collected ₹', FORMAT(ABS(c.Amount), 'N0'), N' from ', p.PharmacyName), c.PaymentMode
            FROM dbo.ChemistLedger c INNER JOIN Users u ON u.UserId = c.UserId LEFT JOIN Pharmacy p ON p.PharmacyId = c.PharmacyId
            WHERE ${TEAM_U} AND c.EntryType = 'PAYMENT' AND c.EntryDate >= @Since AND c.VoidedOn IS NULL
            UNION ALL
            SELECT 'DCR', r.SubmittedOn, ${displayName('u')}, CONCAT('Sent DCR for ', FORMAT(r.ReportDate, 'dd MMM')), r.Status
            FROM dbo.DailyCallReports r INNER JOIN Users u ON u.UserId = r.UserId
            WHERE ${TEAM_U} AND r.SubmittedOn >= @Since
            UNION ALL
            SELECT 'LEAVE', l.SubmittedOn, ${displayName('u')}, CONCAT('Applied for leave from ', FORMAT(l.FromDate, 'dd MMM')), l.Status
            FROM dbo.LeaveRequests l INNER JOIN Users u ON u.UserId = l.UserId
            WHERE ${TEAM_U} AND l.SubmittedOn >= @Since
        ) a
        WHERE a.At IS NOT NULL
        ORDER BY a.At DESC
    `,

    // Working days in the plan before today without a DCR (last 7 days).
    MISSED_DCRS: `
        SELECT COUNT(*) AS Missed
        FROM dbo.TourPlanDetails tpd
        INNER JOIN dbo.TourPlan tp ON tp.TourPlanId = tpd.TourPlanId
        INNER JOIN Users u ON u.UserId = tp.UserId
        WHERE ${TEAM_U} AND tpd.DayType = 'working' AND tpd.PlanDate BETWEEN DATEADD(DAY, -7, @Today) AND DATEADD(DAY, -2, @Today)
          AND NOT EXISTS (SELECT 1 FROM dbo.DailyCallReports r WHERE r.UserId = tp.UserId AND r.ReportDate = tpd.PlanDate AND r.Status IN ('SUBMITTED', 'APPROVED', 'RETURNED'))
    `,

    LOW_STOCK: `
        SELECT COUNT(*) AS Low FROM (
            SELECT s.UserId, s.ItemType, s.ItemId, SUM(s.Quantity) AS Balance
            FROM dbo.EngagementStock s INNER JOIN Users u ON u.UserId = s.UserId
            WHERE ${TEAM_U}
            GROUP BY s.UserId, s.ItemType, s.ItemId
        ) b WHERE b.Balance BETWEEN 0 AND 5
    `,
};

const n = (value) => Number(value) || 0;
const pct = (part, whole) => (whole ? Math.round((n(part) / n(whole)) * 100) : null);
const optional = (promise, fallback) => promise.catch((error) => {
    console.error('Dashboard overview part skipped:', error.message);
    return fallback;
});

const monthEnd = (start) => {
    const d = new Date(`${start}T00:00:00`);
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    return todayKey(d);
};

exports.getOverview = async (actingUserId) => {
    requireActingUser(actingUserId);

    const TeamIds = await teamIdsJson(actingUserId);
    const team = JSON.parse(TeamIds);
    const headOffice = Boolean(await viewAllFor(actingUserId));
    if (!team.length) return { available: false, headOffice };

    const today = todayKey();
    const monthStart = `${today.slice(0, 7)}-01`;
    const since = (() => {
        const d = new Date(`${today}T00:00:00`);
        d.setDate(d.getDate() - 7);
        return todayKey(d);
    })();
    const inputs = { TeamIds, Today: today, MonthStart: monthStart, MonthEnd: monthEnd(monthStart), Since: since };

    const [[head], board, activity, [missed], [low]] = await Promise.all([
        customQuery(SQL.HEADLINE, inputs),
        optional(customQuery(SQL.LEADERBOARD, inputs), []),
        optional(customQuery(SQL.ACTIVITY, inputs), []),
        optional(customQuery(SQL.MISSED_DCRS, inputs), [{}]),
        optional(customQuery(SQL.LOW_STOCK, inputs), [{}]),
    ]);

    const people = board
        .map((row) => ({
            UserId: row.UserId,
            Name: row.Name,
            DesignationName: row.DesignationName,
            visits: n(row.Visits),
            valid: n(row.Valid),
            validPct: pct(row.Valid, row.Visits),
            doctors: n(row.Doctors),
            pobValue: Math.round(n(row.PobValue)),
            dcrSent: n(row.DcrSent),
            lastVisit: row.LastVisit,
        }))
        // Most field work first: visits, then POB value.
        .sort((a, b) => b.visits - a.visits || b.pobValue - a.pobValue || String(a.Name).localeCompare(String(b.Name)));

    return {
        available: true,
        headOffice,
        month: monthStart,
        people: people.length,
        headline: {
            visitsToday: n(head.VisitsToday),
            repsActiveToday: n(head.RepsActiveToday),
            visitsMonth: n(head.VisitsMonth),
            validMonth: n(head.ValidMonth),
            validPct: pct(head.ValidMonth, head.VisitsMonth),
            pobValue: Math.round(n(head.PobValue)),
            pobCount: n(head.PobCount),
            secondaryValue: Math.round(n(head.SecondaryValue)),
            deliveredValue: Math.round(n(head.DeliveredValue)),
            collected: Math.round(n(head.Collected)),
            paymentsToConfirm: n(head.PaymentsToConfirm),
            cashWithMrs: Math.round(n(head.CashWithMrs)),
        },
        leaderboard: people.slice(0, 8),
        activity: activity.map((row) => ({ kind: row.Kind, at: row.At, who: row.Who, text: row.Text, tag: row.Tag })),
        attention: {
            paymentsToConfirm: n(head.PaymentsToConfirm),
            missedDcrs: n(missed?.Missed),
            lowStock: n(low?.Low),
            inactiveToday: Math.max(0, people.length - n(head.RepsActiveToday)),
        },
    };
};
