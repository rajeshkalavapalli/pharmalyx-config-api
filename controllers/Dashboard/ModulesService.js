// Dashboard per module (the tab bar under the greeting): a few headline numbers and bar-chart
// series for each sidebar module, for "my work" or "my team" (the reporting hierarchy; head office sees all).
// Read-only. Each section is independent: a table that is missing or empty gives zeros, not an error.

const { customQuery } = require('../../utils/dbFunctions');
const { SCOPE_CTE } = require('../../utils/reportScope');
const { getPermissions } = require('../../utils/permissions');
const { fail, requireActingUser } = require('../../utils/access');

// People counted: the hierarchy (team) or just the acting user (me).
const PEOPLE = `${SCOPE_CTE}, People AS (
    SELECT UserId FROM Scope WHERE @Team = 1
    UNION SELECT @ActingUserId WHERE @Team = 0
)`;

const MONTH = (column) => `DATEFROMPARTS(YEAR(${column}), MONTH(${column}), 1)`;
const VALID = `COALESCE(v.ValidityOverride, v.Validity)`;
const TERRITORIES = `(SELECT TerritoryId FROM dbo.UserTerritoryMapping m INNER JOIN People p ON p.UserId = m.UserId
                      UNION SELECT u.TerritoryId FROM Users u INNER JOIN People p ON p.UserId = u.UserId WHERE u.TerritoryId IS NOT NULL)`;

const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const monthStart = (offset = 0) => {
    const d = new Date(`${istToday().slice(0, 8)}01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + offset);
    return d.toISOString().slice(0, 10);
};
const monthEnd = (start) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1, 0);
    return d.toISOString().slice(0, 10);
};
const shortMonth = (key) => new Date(`${key}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
const iso = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));
const num = (value) => Number(value) || 0;
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// A failed query (e.g. a table not created yet) counts as no data.
const rows = async (sql, inputs) => {
    try {
        return await customQuery(`${PEOPLE}\n${sql}`, inputs);
    } catch (error) {
        console.error('Dashboard module query skipped:', error.message);
        return [];
    }
};

// Last 6 months as chart items, filling months with no data.
const months6 = (list, valueOf) => {
    const map = new Map(list.map((row) => [iso(row.M), row]));
    return Array.from({ length: 6 }, (_, i) => {
        const key = monthStart(i - 5);
        return { key, label: shortMonth(key), value: num(valueOf(map.get(key) || {})) };
    });
};

const byKey = (list, labels, valueField = 'N') => Object.entries(labels).map(([key, label]) => ({ key, label, value: num(list.find((row) => String(row.K) === key)?.[valueField]) }));
const free = (list, valueField = 'N') => list.map((row) => ({ key: String(row.K), label: String(row.K), value: num(row[valueField]) }));

const chart = (key, title, subtitle, unit, items, money = false) => ({ key, title, subtitle, unit, money, items });
const stat = (label, value, caption, color, icon, progress) => ({ label, value, caption, color, icon, progress });

// =========================================================
// Sections
// =========================================================

const SECTIONS = {
    field: async (p) => {
        const [visits, dcr, weekday, deviations, validity] = await Promise.all([
            rows(`SELECT ${MONTH('v.VisitDate')} AS M, COUNT(*) AS N, SUM(CASE WHEN ${VALID} IN ('VALID', 'REVIEW') THEN 1 ELSE 0 END) AS V
                  FROM dbo.Visits v INNER JOIN People pp ON pp.UserId = v.UserId WHERE v.VisitDate >= @From GROUP BY ${MONTH('v.VisitDate')}`, p),
            rows(`SELECT r.Status AS K, COUNT(*) AS N FROM dbo.DailyCallReports r INNER JOIN People pp ON pp.UserId = r.UserId
                  WHERE r.ReportDate BETWEEN @Month AND @MonthEnd GROUP BY r.Status`, p),
            rows(`SELECT DATEDIFF(DAY, '19000101', v.VisitDate) % 7 AS K, COUNT(*) AS N FROM dbo.Visits v INNER JOIN People pp ON pp.UserId = v.UserId
                  WHERE v.VisitDate BETWEEN @Month AND @MonthEnd GROUP BY DATEDIFF(DAY, '19000101', v.VisitDate) % 7`, p),
            rows(`SELECT ${MONTH('d.DeviationDate')} AS M, COUNT(*) AS N FROM dbo.TourPlanDeviation d INNER JOIN People pp ON pp.UserId = d.UserId
                  WHERE d.DeviationDate >= @From GROUP BY ${MONTH('d.DeviationDate')}`, p),
            rows(`SELECT ISNULL(${VALID}, 'UNCHECKED') AS K, COUNT(*) AS N FROM dbo.Visits v INNER JOIN People pp ON pp.UserId = v.UserId
                  WHERE v.VisitDate BETWEEN @Month AND @MonthEnd GROUP BY ISNULL(${VALID}, 'UNCHECKED')`, p),
        ]);
        const month = months6(visits, (r) => r.N);
        // Counted = valid + needs a look.
        const valid = num(validity.find((r) => r.K === 'VALID')?.N) + num(validity.find((r) => r.K === 'REVIEW')?.N);
        const total = validity.reduce((s, r) => s + num(r.N), 0);
        return {
            stats: [
                stat('Visits this month', month[5].value, `${month[4].value} last month`, 'primary', 'visits'),
                stat('Valid visits', valid, `${pct(valid, total)}% of this month's visits`, 'success', 'valid', pct(valid, total)),
                stat('DCRs sent', dcr.filter((r) => r.K !== 'DRAFT').reduce((s, r) => s + num(r.N), 0), `${num(dcr.find((r) => r.K === 'APPROVED')?.N)} approved`, 'info', 'dcr'),
                stat('Plan deviations', months6(deviations, (r) => r.N)[5].value, 'This month', 'warning', 'route'),
            ],
            charts: [
                chart('visits', 'Visits by month', 'Last 6 months', 'visits', month),
                chart('valid', 'Valid visits by month', 'Counted as work (check-in at the clinic)', 'visits', months6(visits, (r) => r.V)),
                chart('weekday', 'Visits by weekday', 'This month', 'visits', WEEKDAYS.map((label, i) => ({ key: String(i), label, value: num(weekday.find((r) => Number(r.K) === i)?.N) }))),
                chart('dcr', 'DCRs by status', 'This month', 'DCRs', byKey(dcr, { DRAFT: 'Draft', SUBMITTED: 'Sent', APPROVED: 'Approved', RETURNED: 'Returned' })),
                chart('validity', 'Visit results', 'This month', 'visits', byKey(validity, { VALID: 'Valid', INVALID: 'Not counted', UNCHECKED: 'Before check' })),
                chart('deviations', 'Plan deviations by month', 'Last 6 months', 'deviations', months6(deviations, (r) => r.N)),
            ],
            link: { label: 'Visits', to: '/field-operation/visits' },
        };
    },

    engagement: async (p) => {
        const [samples, rcpa, feedback, classes] = await Promise.all([
            rows(`SELECT ${MONTH('s.EntryDate')} AS M, -SUM(s.Quantity) AS N FROM dbo.EngagementStock s INNER JOIN People pp ON pp.UserId = s.UserId
                  WHERE s.EntryType = 'DISTRIBUTION' AND s.EntryDate >= @From GROUP BY ${MONTH('s.EntryDate')}`, p),
            rows(`SELECT ${MONTH('r.AuditDate')} AS M, COUNT(*) AS N FROM dbo.RcpaEntries r INNER JOIN People pp ON pp.UserId = r.UserId
                  WHERE r.AuditDate >= @From GROUP BY ${MONTH('r.AuditDate')}`, p),
            rows(`SELECT v.Feedback AS K, COUNT(*) AS N FROM dbo.Visits v INNER JOIN People pp ON pp.UserId = v.UserId
                  WHERE v.VisitDate BETWEEN @Month AND @MonthEnd AND v.Feedback IS NOT NULL GROUP BY v.Feedback`, p),
            rows(`SELECT ISNULL(d.Category, 'U') AS K, COUNT(DISTINCT d.DoctorId) AS N, COUNT(DISTINCT vv.DoctorId) AS V
                  FROM dbo.UserDoctorMapping m INNER JOIN People pp ON pp.UserId = m.UserId INNER JOIN dbo.Doctor d ON d.DoctorId = m.DoctorId
                  LEFT JOIN (SELECT DISTINCT v.UserId, v.DoctorId FROM dbo.Visits v WHERE v.VisitDate BETWEEN @Month AND @MonthEnd) vv
                         ON vv.DoctorId = d.DoctorId AND vv.UserId = m.UserId
                  WHERE ISNULL(m.IsActive, 'Yes') <> 'No' GROUP BY ISNULL(d.Category, 'U')`, p),
        ]);
        const fb = (k) => num(feedback.find((r) => r.K === k)?.N);
        const fbTotal = fb('POSITIVE') + fb('NEUTRAL') + fb('NEGATIVE');
        const mapped = classes.reduce((s, r) => s + num(r.N), 0);
        const visited = classes.reduce((s, r) => s + num(r.V), 0);
        const LABELS = { A: 'Class A', B: 'Class B', C: 'Class C', U: 'Unrated' };
        return {
            stats: [
                stat('Doctors covered', `${visited}/${mapped}`, `${pct(visited, mapped)}% visited this month`, 'success', 'doctors', pct(visited, mapped)),
                stat('Samples given', months6(samples, (r) => r.N)[5].value, 'Units this month', 'info', 'samples'),
                stat('RCPA audits', months6(rcpa, (r) => r.N)[5].value, 'This month', 'primary', 'rcpa'),
                stat('Positive feedback', `${pct(fb('POSITIVE'), fbTotal)}%`, `${fbTotal} visit(s) with feedback`, 'warning', 'feedback', pct(fb('POSITIVE'), fbTotal)),
            ],
            charts: [
                chart('coverage', 'Doctors visited by class', 'This month · visited of mapped', 'doctors', Object.entries(LABELS).filter(([k]) => classes.some((r) => r.K === k)).map(([key, label]) => ({ key, label, value: num(classes.find((r) => r.K === key)?.V), detail: `of ${num(classes.find((r) => r.K === key)?.N)} mapped` }))),
                chart('samples', 'Samples given by month', 'Units, last 6 months', 'units', months6(samples, (r) => r.N)),
                chart('rcpa', 'RCPA audits by month', 'Last 6 months', 'audits', months6(rcpa, (r) => r.N)),
                chart('feedback', "Doctors' response", 'This month', 'visits', [
                    { key: 'POSITIVE', label: 'Positive', value: fb('POSITIVE') },
                    { key: 'NEUTRAL', label: 'Neutral', value: fb('NEUTRAL') },
                    { key: 'NEGATIVE', label: 'Negative', value: fb('NEGATIVE') },
                ]),
            ],
            link: { label: 'RCPA', to: '/doctor-engagement/rcpa' },
        };
    },

    sales: async (p) => {
        const [pob, status, products, dispatch, returns, secondary] = await Promise.all([
            rows(`SELECT ${MONTH('o.OrderDate')} AS M, SUM(o.NetAmount) AS N, SUM(CASE WHEN o.Status = 'SUPPLIED' THEN o.NetAmount ELSE 0 END) AS V
                  FROM dbo.Orders o INNER JOIN People pp ON pp.UserId = o.UserId WHERE o.Status <> 'CANCELLED' AND o.OrderDate >= @From GROUP BY ${MONTH('o.OrderDate')}`, p),
            rows(`SELECT o.Status AS K, COUNT(*) AS N FROM dbo.Orders o INNER JOIN People pp ON pp.UserId = o.UserId
                  WHERE o.OrderDate BETWEEN @Month AND @MonthEnd GROUP BY o.Status`, p),
            rows(`SELECT TOP 6 pr.ProductName AS K, SUM(l.NetAmount) AS N FROM dbo.OrderLines l INNER JOIN dbo.Orders o ON o.OrderId = l.OrderId
                  INNER JOIN People pp ON pp.UserId = o.UserId INNER JOIN dbo.Products pr ON pr.ProductId = l.ProductId
                  WHERE o.Status <> 'CANCELLED' AND o.OrderDate BETWEEN @Month AND @MonthEnd GROUP BY pr.ProductName ORDER BY SUM(l.NetAmount) DESC`, p),
            rows(`SELECT ${MONTH('d.DispatchDate')} AS M, SUM(d.Value) AS N FROM dbo.PrimaryDispatches d
                  WHERE d.VoidedOn IS NULL AND d.DispatchDate >= @From AND d.TerritoryId IN ${TERRITORIES} GROUP BY ${MONTH('d.DispatchDate')}`, p),
            rows(`SELECT ${MONTH('r.ReturnDate')} AS M, SUM(r.Value) AS N FROM dbo.StockReturns r
                  WHERE r.VoidedOn IS NULL AND r.ReturnDate >= @From AND r.TerritoryId IN ${TERRITORIES} GROUP BY ${MONTH('r.ReturnDate')}`, p),
            rows(`SELECT ${MONTH('s.StatementMonth')} AS M, SUM(s.SalesValue) AS N FROM dbo.SecondaryStatements s INNER JOIN People pp ON pp.UserId = s.UserId
                  WHERE s.StatementMonth >= @From GROUP BY ${MONTH('s.StatementMonth')}`, p),
        ]);
        const pobMonths = months6(pob, (r) => r.N);
        const back = new Map(months6(returns, (r) => r.N).map((m) => [m.key, m.value]));
        const net = months6(dispatch, (r) => r.N).map((m) => ({ ...m, value: Math.round(m.value - (back.get(m.key) || 0)) }));
        const supplied = months6(pob, (r) => r.V)[5].value;
        return {
            stats: [
                stat('POB this month', pobMonths[5].value, `${pobMonths[4].value ? `vs ${Math.round(pobMonths[4].value)} last month` : 'Excluding cancelled'}`, 'primary', 'money', null, true),
                stat('POB supplied', supplied, `${pct(supplied, pobMonths[5].value)}% of POB value`, 'success', 'supplied', pct(supplied, pobMonths[5].value), true),
                stat('Net sales this month', net[5].value, 'Dispatch − returns and expiry', 'info', 'net', null, true),
                stat('Secondary sales', months6(secondary, (r) => r.N)[5].value, 'From stockist statements', 'warning', 'secondary', null, true),
            ].map((s, i) => ({ ...s, money: [0, 1, 2, 3].includes(i) })),
            charts: [
                chart('pob', 'POB value by month', 'Last 6 months', 'Rs', pobMonths, true),
                chart('net', 'Net sales by month', 'Dispatch to stockists − returns and expiry', 'Rs', net, true),
                chart('status', 'POB by status', 'This month', 'orders', byKey(status, { BOOKED: 'Raised', CONFIRMED: 'Follow-up', SUPPLIED: 'Supplied', CANCELLED: 'Cancelled' })),
                chart('products', 'Top products', 'POB value this month', 'Rs', free(products), true),
                chart('secondary', 'Secondary sales by month', 'Last 6 months', 'Rs', months6(secondary, (r) => r.N), true),
            ],
            link: { label: 'Business tracker', to: '/sales/tracker' },
        };
    },

    planning: async (p) => {
        const [tour, doctor, targets, stp] = await Promise.all([
            rows(`SELECT ISNULL(sld.SystemLovDetailName, 'Not started') AS K, COUNT(*) AS N
                  FROM People pp LEFT JOIN dbo.TourPlan tp ON tp.UserId = pp.UserId AND tp.PlanMonth = @Month
                  LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = tp.StatusId GROUP BY ISNULL(sld.SystemLovDetailName, 'Not started')`, p),
            rows(`SELECT ISNULL(dp.Status, 'NOT_STARTED') AS K, COUNT(*) AS N
                  FROM People pp LEFT JOIN dbo.DoctorPlans dp ON dp.UserId = pp.UserId AND dp.PlanMonth = @Month GROUP BY ISNULL(dp.Status, 'NOT_STARTED')`, p),
            rows(`SELECT ${MONTH('t.TargetMonth')} AS M, SUM(t.TargetValue) AS N FROM dbo.SalesTargets t INNER JOIN People pp ON pp.UserId = t.UserId
                  WHERE t.TargetMonth >= @From GROUP BY ${MONTH('t.TargetMonth')}`, p),
            rows(`SELECT s.Status AS K, COUNT(*) AS N FROM dbo.Stp s INNER JOIN People pp ON pp.UserId = s.UserId
                  WHERE s.Status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') GROUP BY s.Status`, p),
        ]);
        const people = tour.reduce((s, r) => s + num(r.N), 0);
        const approved = tour.filter((r) => /approv/i.test(r.K)).reduce((s, r) => s + num(r.N), 0);
        const targetMonths = months6(targets, (r) => r.N);
        return {
            stats: [
                stat('Tour plans approved', `${approved}/${people}`, 'This month', 'success', 'plan', pct(approved, people)),
                stat('Doctor plans', doctor.filter((r) => r.K !== 'NOT_STARTED').reduce((s, r) => s + num(r.N), 0), `${num(doctor.find((r) => r.K === 'APPROVED')?.N)} approved`, 'primary', 'doctors'),
                stat('Sales target', targetMonths[5].value, 'This month', 'info', 'money', null, true),
                stat('STPs approved', num(stp.find((r) => r.K === 'APPROVED')?.N), `${num(stp.find((r) => r.K === 'SUBMITTED')?.N)} with head office`, 'warning', 'route'),
            ].map((s, i) => ({ ...s, money: i === 2 })),
            charts: [
                chart('tour', 'Tour plans by status', 'This month', 'people', free(tour)),
                chart('doctor', 'Doctor business plans by status', 'This month', 'people', byKey(doctor, { NOT_STARTED: 'Not started', DRAFT: 'Draft', SUBMITTED: 'Sent', APPROVED: 'Approved', RETURNED: 'Returned' })),
                chart('targets', 'Sales targets by month', 'Last 6 months', 'Rs', targetMonths, true),
                chart('stp', 'Standard tour plans', 'Current status', 'plans', byKey(stp, { DRAFT: 'Draft', SUBMITTED: 'With head office', RETURNED: 'Returned', APPROVED: 'Approved' })),
            ],
            link: { label: 'Tour plan', to: '/field-operation/tour-plan' },
        };
    },

    expenses: async (p) => {
        const [claims, statuses, now, items] = await Promise.all([
            rows(`SELECT ${MONTH('c.ClaimMonth')} AS M, SUM(c.ClaimedAmount) AS N, SUM(COALESCE(c.ApprovedAmount, 0)) AS V
                  FROM dbo.ExpenseClaims c INNER JOIN People pp ON pp.UserId = c.UserId WHERE c.ClaimMonth >= @From GROUP BY ${MONTH('c.ClaimMonth')}`, p),
            rows(`SELECT c.Status AS K, COUNT(*) AS N FROM dbo.ExpenseClaims c INNER JOIN People pp ON pp.UserId = c.UserId WHERE c.ClaimMonth >= @From GROUP BY c.Status`, p),
            rows(`SELECT SUM(c.DaTotal) AS Da, SUM(c.TaTotal) AS Ta, SUM(c.OtherTotal) AS Other FROM dbo.ExpenseClaims c INNER JOIN People pp ON pp.UserId = c.UserId WHERE c.ClaimMonth = @Month`, p),
            rows(`SELECT i.ExpenseType AS K, SUM(i.Amount) AS N FROM dbo.ExpenseClaimItems i INNER JOIN dbo.ExpenseClaims c ON c.ClaimId = i.ClaimId
                  INNER JOIN People pp ON pp.UserId = c.UserId WHERE c.ClaimMonth >= @From GROUP BY i.ExpenseType`, p),
        ]);
        const m = now[0] || {};
        const pending = statuses.filter((r) => ['SUBMITTED', 'MANAGER_APPROVED'].includes(r.K)).reduce((s, r) => s + num(r.N), 0);
        return {
            stats: [
                stat('Claimed this month', months6(claims, (r) => r.N)[5].value, 'TA + DA + other', 'primary', 'money', null, true),
                stat('DA this month', num(m.Da), 'Days with enough valid visits', 'success', 'da', null, true),
                stat('TA this month', num(m.Ta), 'GPS distance × rate', 'info', 'ta', null, true),
                stat('Claims in review', pending, 'With manager or finance', pending ? 'warning' : 'secondary', 'review'),
            ].map((s, i) => ({ ...s, money: i < 3 })),
            charts: [
                chart('claimed', 'Claimed by month', 'Last 6 months', 'Rs', months6(claims, (r) => r.N), true),
                chart('approved', 'Approved by month', 'Last 6 months', 'Rs', months6(claims, (r) => r.V), true),
                chart('split', 'This month by type', 'DA, TA and other expenses', 'Rs', [
                    { key: 'DA', label: 'DA', value: Math.round(num(m.Da)) },
                    { key: 'TA', label: 'TA', value: Math.round(num(m.Ta)) },
                    { key: 'OTHER', label: 'Other', value: Math.round(num(m.Other)) },
                ], true),
                chart('status', 'Claims by status', 'Last 6 months', 'claims', byKey(statuses, { DRAFT: 'Draft', SUBMITTED: 'Manager', MANAGER_APPROVED: 'Finance', RETURNED: 'Returned', APPROVED: 'Approved', PAID: 'Paid' })),
                chart('other', 'Other expenses by type', 'Last 6 months', 'Rs', byKey(items, { COURIER: 'Courier', STATIONERY: 'Stationery', MEETING_TRAVEL: 'Meeting travel', MISC: 'Misc' }), true),
            ],
            link: { label: 'TA / Claims', to: '/expenses/claims' },
        };
    },

    hr: async (p) => {
        const [present, weekday, leaveTypes, leaveStatus] = await Promise.all([
            rows(`SELECT ${MONTH('a.AttendanceDate')} AS M, COUNT(*) AS N FROM dbo.AttendanceLogs a INNER JOIN People pp ON pp.UserId = a.UserId
                  WHERE a.AttendanceDate >= @From GROUP BY ${MONTH('a.AttendanceDate')}`, p),
            rows(`SELECT DATEDIFF(DAY, '19000101', a.AttendanceDate) % 7 AS K, COUNT(*) AS N FROM dbo.AttendanceLogs a INNER JOIN People pp ON pp.UserId = a.UserId
                  WHERE a.AttendanceDate BETWEEN @Month AND @MonthEnd GROUP BY DATEDIFF(DAY, '19000101', a.AttendanceDate) % 7`, p),
            rows(`SELECT t.Name AS K, SUM(l.Days) AS N FROM dbo.LeaveRequests l INNER JOIN People pp ON pp.UserId = l.UserId INNER JOIN dbo.LeaveTypes t ON t.LeaveTypeId = l.LeaveTypeId
                  WHERE l.Status = 'APPROVED' AND YEAR(l.FromDate) = YEAR(@Month) GROUP BY t.Name`, p),
            rows(`SELECT l.Status AS K, COUNT(*) AS N FROM dbo.LeaveRequests l INNER JOIN People pp ON pp.UserId = l.UserId
                  WHERE YEAR(l.FromDate) = YEAR(@Month) GROUP BY l.Status`, p),
        ]);
        const presentMonths = months6(present, (r) => r.N);
        const taken = leaveTypes.reduce((s, r) => s + num(r.N), 0);
        return {
            stats: [
                stat('Days present', presentMonths[5].value, 'Check-ins this month', 'success', 'present'),
                stat('Last month', presentMonths[4].value, 'Check-ins', 'primary', 'calendar'),
                stat('Leave taken', taken, 'Approved days this year', 'info', 'leave'),
                stat('Leave requests waiting', num(leaveStatus.find((r) => r.K === 'PENDING')?.N), 'For the manager', 'warning', 'review'),
            ],
            charts: [
                chart('present', 'Attendance by month', 'Check-ins, last 6 months', 'days', presentMonths),
                chart('weekday', 'Check-ins by weekday', 'This month', 'days', WEEKDAYS.map((label, i) => ({ key: String(i), label, value: num(weekday.find((r) => Number(r.K) === i)?.N) }))),
                chart('leave', 'Leave taken by type', 'Approved days this year', 'days', free(leaveTypes)),
                chart('leaveStatus', 'Leave requests by status', 'This year', 'requests', byKey(leaveStatus, { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' })),
            ],
            link: { label: 'Attendance', to: '/hr/attendance' },
        };
    },

    reports: async (p) => {
        const [calls, coverage, mapped, missed, reps, dcrs, orders] = await Promise.all([
            rows(`SELECT ${MONTH('v.VisitDate')} AS M, COUNT(*) AS N, COUNT(DISTINCT CONCAT(CONVERT(VARCHAR(36), v.UserId), CONVERT(VARCHAR(10), v.VisitDate, 23))) AS D
                  FROM dbo.Visits v INNER JOIN People pp ON pp.UserId = v.UserId WHERE v.VisitDate >= @From GROUP BY ${MONTH('v.VisitDate')}`, p),
            rows(`SELECT ${MONTH('v.VisitDate')} AS M, COUNT(DISTINCT CONCAT(CONVERT(VARCHAR(36), v.UserId), CONVERT(VARCHAR(36), v.DoctorId))) AS N
                  FROM dbo.Visits v INNER JOIN People pp ON pp.UserId = v.UserId WHERE v.VisitDate >= @From GROUP BY ${MONTH('v.VisitDate')}`, p),
            rows(`SELECT COUNT(*) AS N FROM dbo.UserDoctorMapping m INNER JOIN People pp ON pp.UserId = m.UserId WHERE ISNULL(m.IsActive, 'Yes') <> 'No'`, p),
            rows(`SELECT ISNULL(d.Category, 'U') AS K, COUNT(*) AS N
                  FROM dbo.UserDoctorMapping m INNER JOIN People pp ON pp.UserId = m.UserId INNER JOIN dbo.Doctor d ON d.DoctorId = m.DoctorId
                  LEFT JOIN (SELECT DISTINCT v.UserId, v.DoctorId FROM dbo.Visits v WHERE v.VisitDate BETWEEN @Month AND @MonthEnd) vv
                         ON vv.UserId = m.UserId AND vv.DoctorId = m.DoctorId
                  WHERE ISNULL(m.IsActive, 'Yes') <> 'No' AND vv.DoctorId IS NULL GROUP BY ISNULL(d.Category, 'U')`, p),
            rows(`SELECT TOP 8 COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.FirstName, ' ', u.LastName))), ''), u.UserName) AS K, COUNT(*) AS N
                  FROM dbo.Visits v INNER JOIN People pp ON pp.UserId = v.UserId INNER JOIN Users u ON u.UserId = v.UserId
                  WHERE v.VisitDate BETWEEN @Month AND @MonthEnd GROUP BY u.UserId, u.FirstName, u.LastName, u.UserName ORDER BY COUNT(*) DESC`, p),
            rows(`SELECT ${MONTH('r.ReportDate')} AS M, COUNT(*) AS N FROM dbo.DailyCallReports r INNER JOIN People pp ON pp.UserId = r.UserId
                  WHERE r.Status <> 'DRAFT' AND r.ReportDate >= @From GROUP BY ${MONTH('r.ReportDate')}`, p),
            rows(`SELECT ${MONTH('o.OrderDate')} AS M, COUNT(*) AS N FROM dbo.Orders o INNER JOIN People pp ON pp.UserId = o.UserId
                  WHERE o.Status <> 'CANCELLED' AND o.OrderDate >= @From GROUP BY ${MONTH('o.OrderDate')}`, p),
        ]);
        const callAvg = months6(calls, (r) => (num(r.D) ? Math.round((num(r.N) / num(r.D)) * 10) / 10 : 0));
        const assignments = num(mapped[0]?.N);
        const coveragePct = months6(coverage, (r) => pct(num(r.N), assignments));
        const missedTotal = missed.reduce((s, r) => s + num(r.N), 0);
        const dcrMonths = months6(dcrs, (r) => r.N);
        const LABELS = { A: 'Class A', B: 'Class B', C: 'Class C', U: 'Unrated' };
        return {
            stats: [
                stat('Call average', callAvg[5].value, 'Visits per field day this month', 'primary', 'visits'),
                stat('Doctor coverage', `${coveragePct[5].value}%`, `${assignments} doctor assignment(s)`, 'success', 'doctors', coveragePct[5].value),
                stat('Missed doctors', missedTotal, 'Not visited yet this month', missedTotal ? 'error' : 'success', 'high'),
                stat('DCRs submitted', dcrMonths[5].value, `${dcrMonths[4].value} last month`, 'info', 'dcr'),
            ],
            charts: [
                chart('callAvg', 'Call average by month', 'Visits per field day', 'calls/day', callAvg),
                chart('coverage', 'Doctor coverage by month', '% of assigned doctors visited', '%', coveragePct),
                chart('missed', 'Missed doctors by class', 'Assigned but not visited this month', 'doctors', Object.entries(LABELS).map(([key, label]) => ({ key, label, value: num(missed.find((r) => r.K === key)?.N) })).filter((item) => item.value || item.key !== 'U')),
                chart('reps', 'Top representatives by visits', 'This month', 'visits', free(reps)),
                chart('dcrs', 'DCRs submitted by month', 'Last 6 months', 'DCRs', dcrMonths),
                chart('orders', 'POB orders by month', 'Excluding cancelled', 'orders', months6(orders, (r) => r.N)),
            ],
            link: { label: 'MIS reports', to: '/reports/mis' },
        };
    },

    insights: async (p, actingUserId) => {
        const Insights = require('../Insights/InsightsService');
        const data = await Insights.getAlerts(actingUserId, p.Team ? {} : { userId: actingUserId }).catch(() => null);
        const s = data?.summary || { open: 0, high: 0, acknowledged: 0, resolved: 0, byGroup: [] };
        const alerts = data?.alerts || [];
        const sev = (k) => alerts.filter((a) => a.severity === k && a.status !== 'RESOLVED').length;
        const GROUPS = { DOCTOR: 'Doctors', REP: 'Reps', STOCK: 'Stock', GPS: 'GPS' };
        return {
            stats: [
                stat('Open alerts', num(s.open), 'Doctors, reps, stock, GPS', 'primary', 'alert'),
                stat('High priority', num(s.high), 'Open and marked high', num(s.high) ? 'error' : 'success', 'high'),
                stat('Acknowledged', num(s.acknowledged), 'Being worked on', 'info', 'ack'),
                stat('Resolved', num(s.resolved), 'Closed with a note', 'success', 'valid'),
            ],
            charts: [
                chart('groups', 'Open alerts by area', 'Rules set in Insight rules', 'alerts', Object.entries(GROUPS).map(([key, label]) => ({ key, label, value: num(s.byGroup.find((g) => g.group === key)?.open) }))),
                chart('severity', 'Open alerts by priority', 'Now', 'alerts', [
                    { key: 'HIGH', label: 'High', value: sev('HIGH') },
                    { key: 'MEDIUM', label: 'Medium', value: sev('MEDIUM') },
                    { key: 'LOW', label: 'Low', value: sev('LOW') },
                ]),
            ],
            link: { label: 'Risk & alerts', to: '/insights/risk' },
        };
    },

    admin: async (p, actingUserId) => {
        const Approvals = require('../Approvals/ApprovalsService');
        const [inbox, requests, verifications, roles] = await Promise.all([
            Approvals.getInbox(actingUserId).catch(() => null),
            rows(`SELECT r.Status AS K, COUNT(*) AS N FROM dbo.DoctorRequests r INNER JOIN People pp ON pp.UserId = r.RequestedBy WHERE r.CreatedOn >= @From GROUP BY r.Status`, p),
            rows(`SELECT v.Status AS K, COUNT(*) AS N FROM dbo.DoctorVerifications v INNER JOIN People pp ON pp.UserId = v.SubmittedBy WHERE v.SubmittedOn >= @From GROUP BY v.Status`, p),
            rows(`SELECT ISNULL(ro.RoleName, 'No role') AS K, COUNT(*) AS N FROM People pp INNER JOIN Users u ON u.UserId = pp.UserId LEFT JOIN Roles ro ON ro.RoleId = u.RoleId
                  WHERE ISNULL(u.IsActive, 1) = 1 GROUP BY ISNULL(ro.RoleName, 'No role')`, p),
        ]);
        const types = (inbox?.types || []).filter((t) => t.count > 0);
        return {
            stats: [
                stat('Waiting for review', num(inbox?.total), `${num(inbox?.overdue)} overdue`, num(inbox?.overdue) ? 'error' : 'primary', 'review'),
                stat('Doctor requests', requests.reduce((s, r) => s + num(r.N), 0), `${num(requests.find((r) => r.K === 'PENDING')?.N)} pending`, 'info', 'doctors'),
                stat('Verifications', verifications.reduce((s, r) => s + num(r.N), 0), `${num(verifications.find((r) => r.K === 'PENDING')?.N)} pending`, 'success', 'valid'),
                stat('People', roles.reduce((s, r) => s + num(r.N), 0), 'Active users in scope', 'secondary', 'people'),
            ],
            charts: [
                chart('inbox', 'Approvals waiting by type', 'Your inbox now', 'items', types.map((t) => ({ key: t.type, label: t.label, value: t.count }))),
                chart('requests', 'Doctor requests by status', 'Last 6 months', 'requests', byKey(requests, { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled' })),
                chart('verifications', 'Doctor verifications by status', 'Last 6 months', 'verifications', byKey(verifications, { PENDING: 'Pending', ACCEPTED: 'Accepted', REJECTED: 'Rejected' })),
                chart('roles', 'People by role', 'Active', 'people', free(roles)),
            ],
            link: { label: 'Approvals', to: '/admin/approvals' },
        };
    },
};

// How each chart is drawn: line (monthly trend), donut (a split), rank (top list), bar (comparison).
const CHART_TYPES = {
    field: { visits: 'line', valid: 'line', weekday: 'bar', dcr: 'donut', validity: 'donut', deviations: 'line' },
    engagement: { coverage: 'rank', samples: 'line', rcpa: 'line', feedback: 'donut' },
    sales: { pob: 'line', net: 'line', status: 'donut', products: 'rank', secondary: 'line' },
    planning: { tour: 'donut', doctor: 'donut', targets: 'line', stp: 'donut' },
    expenses: { claimed: 'line', approved: 'line', split: 'donut', status: 'donut', other: 'rank' },
    hr: { present: 'line', weekday: 'bar', leave: 'rank', leaveStatus: 'donut' },
    reports: { callAvg: 'line', coverage: 'line', missed: 'bar', reps: 'rank', dcrs: 'line', orders: 'line' },
    insights: { groups: 'rank', severity: 'donut' },
    admin: { inbox: 'rank', requests: 'donut', verifications: 'donut', roles: 'donut' },
};

// Which monthly chart gives each stat card its little trend line and "vs last month" change.
const STAT_SERIES = {
    field: ['visits', 'valid', null, 'deviations'],
    engagement: [null, 'samples', 'rcpa', null],
    sales: ['pob', null, 'net', 'secondary'],
    planning: [null, null, 'targets', null],
    expenses: ['claimed', null, null, null],
    hr: ['present', null, null, null],
    reports: ['callAvg', 'coverage', null, 'dcrs'],
};

const decorate = (section, result) => {
    const types = CHART_TYPES[section] || {};
    const charts = result.charts.map((c) => ({ ...c, type: types[c.key] || 'bar' }));
    const stats = result.stats.map((st, i) => {
        const source = charts.find((c) => c.key === (STAT_SERIES[section] || [])[i]);
        if (!source) return st;
        const spark = source.items.map((item) => item.value);
        const [prev, last] = spark.slice(-2);
        return { ...st, spark, trend: prev ? Math.round(((last - prev) / prev) * 100) : null };
    });
    return { ...result, charts, stats };
};

exports.SECTION_KEYS = Object.keys(SECTIONS);

exports.getModule = async (actingUserId, section, query) => {
    requireActingUser(actingUserId);
    if (!SECTIONS[section]) throw fail(404, 'Unknown dashboard section.');

    const permissions = await getPermissions(actingUserId);
    const viewAll = permissions.has('reports.viewall') || permissions.has('verifiedwork.approve') ? 1 : 0;
    const team = query.scope === 'me' ? 0 : 1;
    const month = monthStart(0);
    const inputs = { ActingUserId: actingUserId, ViewAll: viewAll, Team: team, Month: month, MonthEnd: monthEnd(month), From: monthStart(-5) };

    const result = decorate(section, await SECTIONS[section](inputs, actingUserId));
    return { section, scope: team ? 'team' : 'me', month, ...result };
};

exports._internals = { months6, byKey };
