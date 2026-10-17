const { SCOPE_CTE, displayName } = require('../../utils/reportScope');

// Visits in scope, date range and optional employee / territory (the doctor's territory).
const CALLS_FROM = `
    FROM Scope s
    INNER JOIN dbo.Visits v ON v.UserId = s.UserId
    INNER JOIN dbo.Doctor doc ON doc.DoctorId = v.DoctorId
    LEFT JOIN Territory t ON t.TerritoryId = TRY_CONVERT(UNIQUEIDENTIFIER, doc.TerritoryId)
    WHERE v.VisitDate BETWEEN @FromDate AND @ToDate
      AND (@UserId IS NULL OR v.UserId = @UserId)
      AND (@TerritoryId IS NULL OR t.TerritoryId = @TerritoryId)
`;

module.exports = {
    // ---------------------------------------------------------
    // DCR / Call report
    // ---------------------------------------------------------

    CALL_TOTALS: () => {
        return `
            ${SCOPE_CTE}
            SELECT
                COUNT(*) AS Calls,
                COUNT(DISTINCT v.DoctorId) AS Doctors,
                COUNT(DISTINCT CONCAT(v.UserId, '|', v.VisitDate)) AS FieldDays,
                SUM(CASE WHEN v.LocationStatus = 'CAPTURED' THEN 1 ELSE 0 END) AS WithGps,
                SUM(CASE WHEN v.PlanStatus = 'IN_PLAN' THEN 1 ELSE 0 END) AS InPlan,
                SUM(CASE WHEN v.JointWorkUserId IS NOT NULL THEN 1 ELSE 0 END) AS JointCalls,
                AVG(CAST(DATEDIFF(MINUTE, v.StartTime, v.EndTime) AS FLOAT)) AS AvgMinutes
            ${CALLS_FROM}
        `;
    },

    CALLS_BY_DAY: () => {
        return `
            ${SCOPE_CTE}
            SELECT CONVERT(VARCHAR(10), v.VisitDate, 23) AS VisitDate, COUNT(*) AS Calls
            ${CALLS_FROM}
            GROUP BY v.VisitDate
        `;
    },

    // One row per employee in scope (also those with no calls), for the summary table.
    CALLS_BY_EMPLOYEE: () => {
        return `
            ${SCOPE_CTE},
            Calls AS (
                SELECT
                    v.UserId,
                    COUNT(*) AS Calls,
                    COUNT(DISTINCT v.DoctorId) AS Doctors,
                    COUNT(DISTINCT v.VisitDate) AS FieldDays,
                    SUM(CASE WHEN v.LocationStatus = 'CAPTURED' THEN 1 ELSE 0 END) AS WithGps,
                    SUM(CASE WHEN v.PlanStatus = 'IN_PLAN' THEN 1 ELSE 0 END) AS InPlan,
                    AVG(CAST(DATEDIFF(MINUTE, v.StartTime, v.EndTime) AS FLOAT)) AS AvgMinutes
                ${CALLS_FROM}
                GROUP BY v.UserId
            ),
            Dcrs AS (
                SELECT r.UserId,
                       SUM(CASE WHEN r.Status = 'APPROVED' THEN 1 ELSE 0 END) AS DcrApproved,
                       SUM(CASE WHEN r.Status = 'SUBMITTED' THEN 1 ELSE 0 END) AS DcrPending,
                       SUM(CASE WHEN r.Status = 'RETURNED' THEN 1 ELSE 0 END) AS DcrReturned
                FROM Scope s
                INNER JOIN dbo.DailyCallReports r ON r.UserId = s.UserId
                WHERE r.ReportDate BETWEEN @FromDate AND @ToDate
                GROUP BY r.UserId
            )
            SELECT
                u.UserId,
                ${displayName('u')} AS Name,
                sld.SystemLovDetailName AS DesignationName,
                ${displayName('m')} AS ManagerName,
                ISNULL(c.Calls, 0) AS Calls,
                ISNULL(c.Doctors, 0) AS Doctors,
                ISNULL(c.FieldDays, 0) AS FieldDays,
                ISNULL(c.WithGps, 0) AS WithGps,
                ISNULL(c.InPlan, 0) AS InPlan,
                c.AvgMinutes,
                ISNULL(d.DcrApproved, 0) AS DcrApproved,
                ISNULL(d.DcrPending, 0) AS DcrPending,
                ISNULL(d.DcrReturned, 0) AS DcrReturned
            FROM Scope s
            INNER JOIN Users u ON u.UserId = s.UserId
            LEFT JOIN Users m ON m.UserId = u.ManagerId
            LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = u.DesignationId
            LEFT JOIN Calls c ON c.UserId = u.UserId
            LEFT JOIN Dcrs d ON d.UserId = u.UserId
            WHERE (@UserId IS NULL OR u.UserId = @UserId)
            ORDER BY ISNULL(c.Calls, 0) DESC, Name
        `;
    },

    // Call-level detail, newest first, capped at @Limit + 1 rows (the extra row flags truncation).
    CALL_ROWS: () => {
        return `
            ${SCOPE_CTE}
            SELECT TOP (@Limit + 1)
                v.VisitId,
                CONVERT(VARCHAR(10), v.VisitDate, 23) AS VisitDate,
                CONVERT(VARCHAR(5), v.StartTime, 108) AS StartTime,
                CONVERT(VARCHAR(5), v.EndTime, 108) AS EndTime,
                DATEDIFF(MINUTE, v.StartTime, v.EndTime) AS Minutes,
                ${displayName('u')} AS EmployeeName,
                doc.DoctorName,
                doc.Category,
                doc.Speciality,
                doc.HospitalName,
                t.TerritoryName,
                a.AreaName,
                v.LocationStatus,
                v.PlanStatus,
                ${displayName('ju')} AS JointWorkName,
                v.Feedback,
                CONVERT(VARCHAR(10), v.FollowUpDate, 23) AS FollowUpDate
            ${CALLS_FROM.replace(
                'LEFT JOIN Territory t',
                `INNER JOIN Users u ON u.UserId = v.UserId
    LEFT JOIN Users ju ON ju.UserId = v.JointWorkUserId
    LEFT JOIN Areas a ON a.AreaId = TRY_CONVERT(UNIQUEIDENTIFIER, doc.AreaId)
    LEFT JOIN Territory t`
            )}
            ORDER BY v.VisitDate DESC, v.StartTime DESC
        `;
    },

    // ---------------------------------------------------------
    // Coverage / Missed visits: every active doctor assignment in scope
    // ---------------------------------------------------------

    DOCTOR_ASSIGNMENTS: () => {
        return `
            ${SCOPE_CTE},
            Vis AS (
                SELECT v.UserId, v.DoctorId, COUNT(*) AS Visits
                FROM Scope s
                INNER JOIN dbo.Visits v ON v.UserId = s.UserId
                WHERE v.VisitDate BETWEEN @FromDate AND @ToDate
                GROUP BY v.UserId, v.DoctorId
            ),
            LastEver AS (
                SELECT v.UserId, v.DoctorId, MAX(v.VisitDate) AS LastVisit
                FROM Scope s
                INNER JOIN dbo.Visits v ON v.UserId = s.UserId
                WHERE v.VisitDate <= @ToDate
                GROUP BY v.UserId, v.DoctorId
            )
            SELECT TOP (@Limit + 1)
                m.UserId,
                ${displayName('u')} AS EmployeeName,
                d.DoctorId,
                d.DoctorName,
                d.Category,
                d.Speciality,
                d.HospitalName,
                t.TerritoryName,
                a.AreaName,
                ISNULL(d.VisitsPerMonth, 0) AS Norm,
                ISNULL(vi.Visits, 0) AS Visits,
                CONVERT(VARCHAR(10), le.LastVisit, 23) AS LastVisit
            FROM Scope s
            INNER JOIN dbo.UserDoctorMapping m ON m.UserId = s.UserId AND ISNULL(m.IsActive, 'Yes') <> 'No'
            INNER JOIN Users u ON u.UserId = m.UserId
            INNER JOIN dbo.Doctor d ON d.DoctorId = m.DoctorId AND ISNULL(d.IsActive, 'Yes') <> 'No'
            LEFT JOIN Territory t ON t.TerritoryId = TRY_CONVERT(UNIQUEIDENTIFIER, d.TerritoryId)
            LEFT JOIN Areas a ON a.AreaId = TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId)
            LEFT JOIN Vis vi ON vi.UserId = m.UserId AND vi.DoctorId = m.DoctorId
            LEFT JOIN LastEver le ON le.UserId = m.UserId AND le.DoctorId = m.DoctorId
            WHERE (@UserId IS NULL OR m.UserId = @UserId)
              AND (@TerritoryId IS NULL OR t.TerritoryId = @TerritoryId)
            ORDER BY EmployeeName, CASE d.Category WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END, d.DoctorName
        `;
    },

    // Pre-call plans that passed without the visit (up to yesterday).
    MISSED_PLANNED_CALLS: () => {
        return `
            ${SCOPE_CTE}
            SELECT TOP (@Limit + 1)
                pc.PreCallId,
                CONVERT(VARCHAR(10), pc.PlanDate, 23) AS PlanDate,
                ${displayName('u')} AS EmployeeName,
                d.DoctorName,
                d.Category,
                t.TerritoryName,
                pc.Objective
            FROM Scope s
            INNER JOIN dbo.PreCallPlans pc ON pc.UserId = s.UserId
            INNER JOIN Users u ON u.UserId = pc.UserId
            INNER JOIN dbo.Doctor d ON d.DoctorId = pc.DoctorId
            LEFT JOIN Territory t ON t.TerritoryId = TRY_CONVERT(UNIQUEIDENTIFIER, d.TerritoryId)
            WHERE pc.PlanDate BETWEEN @FromDate AND @ToDate
              AND pc.PlanDate < @Today
              AND pc.Status = 'PLANNED'
              AND (@UserId IS NULL OR pc.UserId = @UserId)
              AND (@TerritoryId IS NULL OR t.TerritoryId = @TerritoryId)
            ORDER BY pc.PlanDate DESC, EmployeeName
        `;
    },

    // Tour-plan working days (up to yesterday) with no visit logged.
    MISSED_FIELD_DAYS: () => {
        return `
            ${SCOPE_CTE}
            SELECT TOP (@Limit + 1)
                CONVERT(VARCHAR(10), dt.PlanDate, 23) AS PlanDate,
                ${displayName('u')} AS EmployeeName,
                t.TerritoryName,
                a.AreaName
            FROM Scope s
            INNER JOIN dbo.TourPlan tp ON tp.UserId = s.UserId
            INNER JOIN dbo.TourPlanDetails dt ON dt.TourPlanId = tp.TourPlanId
            INNER JOIN Users u ON u.UserId = tp.UserId
            LEFT JOIN Territory t ON t.TerritoryId = dt.TerritoryId
            LEFT JOIN Areas a ON a.AreaId = dt.AreaId
            WHERE dt.DayType = 'working'
              AND dt.PlanDate BETWEEN @FromDate AND @ToDate
              AND dt.PlanDate < @Today
              AND (@UserId IS NULL OR tp.UserId = @UserId)
              AND (@TerritoryId IS NULL OR dt.TerritoryId = @TerritoryId)
              AND NOT EXISTS (SELECT 1 FROM dbo.Visits v WHERE v.UserId = tp.UserId AND v.VisitDate = dt.PlanDate)
            ORDER BY dt.PlanDate DESC, EmployeeName
        `;
    },

    // ---------------------------------------------------------
    // POB: one row per order line (customer territory = doctor's or chemist's)
    // ---------------------------------------------------------

    POB_LINES: () => {
        return `
            ${SCOPE_CTE}
            SELECT TOP (@Limit + 1)
                o.OrderId,
                o.OrderNumber,
                CONVERT(VARCHAR(10), o.OrderDate, 23) AS OrderDate,
                CONVERT(VARCHAR(7), o.OrderDate, 23) AS OrderMonth,
                o.UserId,
                ${displayName('u')} AS EmployeeName,
                o.CustomerType,
                COALESCE(dd.DoctorName, ph.PharmacyName) AS CustomerName,
                t.TerritoryName,
                st.StockistName,
                o.Status,
                l.ProductId,
                p.ProductName,
                l.Quantity,
                l.FreeQuantity,
                l.NetAmount
            FROM Scope s
            INNER JOIN dbo.Orders o ON o.UserId = s.UserId
            INNER JOIN dbo.OrderLines l ON l.OrderId = o.OrderId
            INNER JOIN dbo.Products p ON p.ProductId = l.ProductId
            INNER JOIN Users u ON u.UserId = o.UserId
            LEFT JOIN dbo.Doctor dd ON dd.DoctorId = o.DoctorId
            LEFT JOIN dbo.Pharmacy ph ON ph.PharmacyId = o.PharmacyId
            LEFT JOIN dbo.Stockist st ON st.StockistId = o.StockistId
            LEFT JOIN Territory t ON t.TerritoryId = COALESCE(TRY_CONVERT(UNIQUEIDENTIFIER, dd.TerritoryId), TRY_CONVERT(UNIQUEIDENTIFIER, ph.TerritoryId))
            WHERE o.OrderDate BETWEEN @FromDate AND @ToDate
              AND (@UserId IS NULL OR o.UserId = @UserId)
              AND (@TerritoryId IS NULL OR t.TerritoryId = @TerritoryId)
              AND (@ProductId IS NULL OR l.ProductId = @ProductId)
            ORDER BY o.OrderDate DESC, o.OrderNumber DESC
        `;
    },

    // ---------------------------------------------------------
    // Secondary sales (submitted / approved statements) and targets, by month
    // ---------------------------------------------------------

    SECONDARY_LINES: () => {
        return `
            ${SCOPE_CTE}
            SELECT TOP (@Limit + 1)
                CONVERT(VARCHAR(7), ss.StatementMonth, 23) AS SalesMonth,
                ss.UserId,
                ${displayName('u')} AS EmployeeName,
                ss.StockistId,
                st.StockistName,
                t.TerritoryName,
                ss.Status,
                l.ProductId,
                p.ProductName,
                l.ReceiptQty,
                l.SalesQty,
                l.SalesValue,
                l.ClosingQty,
                l.ClosingValue
            FROM Scope s
            INNER JOIN dbo.SecondaryStatements ss ON ss.UserId = s.UserId
            INNER JOIN dbo.SecondaryStatementLines l ON l.StatementId = ss.StatementId
            INNER JOIN dbo.Products p ON p.ProductId = l.ProductId
            INNER JOIN Users u ON u.UserId = ss.UserId
            LEFT JOIN dbo.Stockist st ON st.StockistId = ss.StockistId
            LEFT JOIN Territory t ON t.TerritoryId = TRY_CONVERT(UNIQUEIDENTIFIER, st.TerritoryId)
            WHERE ss.Status IN ('SUBMITTED', 'APPROVED')
              AND ss.StatementMonth BETWEEN @FromMonth AND @ToMonth
              AND (@UserId IS NULL OR ss.UserId = @UserId)
              AND (@TerritoryId IS NULL OR t.TerritoryId = @TerritoryId)
              AND (@ProductId IS NULL OR l.ProductId = @ProductId)
            ORDER BY ss.StatementMonth DESC, EmployeeName, st.StockistName
        `;
    },

    TARGETS: () => {
        return `
            ${SCOPE_CTE}
            SELECT
                CONVERT(VARCHAR(7), tg.TargetMonth, 23) AS TargetMonth,
                tg.UserId,
                tg.ProductId,
                p.ProductName,
                tg.TargetQty,
                tg.TargetValue
            FROM Scope s
            INNER JOIN dbo.SalesTargets tg ON tg.UserId = s.UserId
            INNER JOIN dbo.Products p ON p.ProductId = tg.ProductId
            WHERE tg.TargetMonth BETWEEN @FromMonth AND @ToMonth
              AND (@UserId IS NULL OR tg.UserId = @UserId)
              AND (@ProductId IS NULL OR tg.ProductId = @ProductId)
        `;
    },

    // ---------------------------------------------------------
    // MIS / Graphical extras
    // ---------------------------------------------------------

    CALLS_BY_MONTH: () => {
        return `
            ${SCOPE_CTE}
            SELECT CONVERT(VARCHAR(7), v.VisitDate, 23) AS VisitMonth,
                   COUNT(*) AS Calls,
                   COUNT(DISTINCT v.DoctorId) AS Doctors,
                   COUNT(DISTINCT CONCAT(v.UserId, '|', v.VisitDate)) AS FieldDays
            ${CALLS_FROM}
            GROUP BY CONVERT(VARCHAR(7), v.VisitDate, 23)
        `;
    },

    FEEDBACK_SPLIT: () => {
        return `
            ${SCOPE_CTE}
            SELECT ISNULL(v.Feedback, 'NONE') AS Feedback, COUNT(*) AS Calls
            ${CALLS_FROM}
            GROUP BY ISNULL(v.Feedback, 'NONE')
        `;
    },

    ENGAGEMENT_TOTALS: () => {
        return `
            ${SCOPE_CTE}
            SELECT
                (SELECT -ISNULL(SUM(e.Quantity), 0) FROM Scope s INNER JOIN dbo.EngagementStock e ON e.UserId = s.UserId
                 WHERE e.EntryType = 'DISTRIBUTION' AND e.ItemType = 'SAMPLE' AND e.EntryDate BETWEEN @FromDate AND @ToDate
                   AND (@UserId IS NULL OR e.UserId = @UserId)) AS SamplesGiven,
                (SELECT -ISNULL(SUM(e.Quantity), 0) FROM Scope s INNER JOIN dbo.EngagementStock e ON e.UserId = s.UserId
                 WHERE e.EntryType = 'DISTRIBUTION' AND e.ItemType = 'GIFT' AND e.EntryDate BETWEEN @FromDate AND @ToDate
                   AND (@UserId IS NULL OR e.UserId = @UserId)) AS GiftsGiven,
                (SELECT COUNT(*) FROM Scope s INNER JOIN dbo.RcpaEntries r ON r.UserId = s.UserId
                 WHERE r.AuditDate BETWEEN @FromDate AND @ToDate AND (@UserId IS NULL OR r.UserId = @UserId)) AS RcpaAudits
        `;
    },

    EXPENSES_BY_MONTH: () => {
        return `
            ${SCOPE_CTE}
            SELECT CONVERT(VARCHAR(7), c.ClaimMonth, 23) AS ClaimMonth,
                   SUM(CASE WHEN c.Status <> 'DRAFT' THEN c.ClaimedAmount ELSE 0 END) AS Claimed,
                   SUM(CASE WHEN c.Status IN ('APPROVED', 'PAID') THEN ISNULL(c.ApprovedAmount, 0) ELSE 0 END) AS Approved,
                   SUM(CASE WHEN c.Status = 'PAID' THEN ISNULL(c.ApprovedAmount, 0) ELSE 0 END) AS Paid
            FROM Scope s
            INNER JOIN dbo.ExpenseClaims c ON c.UserId = s.UserId
            WHERE c.ClaimMonth BETWEEN @FromMonth AND @ToMonth
              AND (@UserId IS NULL OR c.UserId = @UserId)
            GROUP BY CONVERT(VARCHAR(7), c.ClaimMonth, 23)
        `;
    },
};
