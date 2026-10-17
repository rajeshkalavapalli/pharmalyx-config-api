const { SCOPE_CTE, displayName } = require('../../utils/reportScope');

// Every query takes @ActingUserId / @ViewAll (scope) and an optional @UserId filter.
const IN_SCOPE = (column) => `(@UserId IS NULL OR ${column} = @UserId)`;

module.exports = {
    // ---------------------------------------------------------
    // Rules & alert actions
    // ---------------------------------------------------------

    GET_RULES: () => `SELECT RuleCode, IsEnabled, Threshold1, Threshold2 FROM dbo.InsightRules`,

    UPSERT_RULE: () => {
        return `
            UPDATE dbo.InsightRules
            SET IsEnabled = @IsEnabled, Threshold1 = @Threshold1, Threshold2 = @Threshold2, ModifiedBy = @ModifiedBy, ModifiedOn = @Now
            WHERE RuleCode = @RuleCode;

            IF @@ROWCOUNT = 0
                INSERT INTO dbo.InsightRules (RuleCode, IsEnabled, Threshold1, Threshold2, ModifiedBy, ModifiedOn)
                VALUES (@RuleCode, @IsEnabled, @Threshold1, @Threshold2, @ModifiedBy, @Now);
        `;
    },

    DELETE_RULE: () => `DELETE FROM dbo.InsightRules WHERE RuleCode = @RuleCode`,

    GET_ACTIONS: () => {
        return `
            SELECT a.AlertKey, a.RuleCode, a.Status, a.Note, a.ActedOn, ${displayName('u')} AS ActedByName
            FROM dbo.InsightAlertActions a
            INNER JOIN Users u ON u.UserId = a.ActedBy
        `;
    },

    UPSERT_ACTION: () => {
        return `
            UPDATE dbo.InsightAlertActions
            SET Status = @Status, Note = @Note, ActedBy = @ActedBy, ActedOn = @Now
            WHERE AlertKey = @AlertKey;

            IF @@ROWCOUNT = 0
                INSERT INTO dbo.InsightAlertActions (AlertKey, RuleCode, Status, Note, ActedBy, ActedOn)
                VALUES (@AlertKey, @RuleCode, @Status, @Note, @ActedBy, @Now);
        `;
    },

    DELETE_ACTION: () => `DELETE FROM dbo.InsightAlertActions WHERE AlertKey = @AlertKey`,

    // ---------------------------------------------------------
    // Doctor risk
    // ---------------------------------------------------------

    // Class A / B assignments with their last visit by the assigned rep.
    KEY_DOCTOR_LAST_VISITS: () => {
        return `
            ${SCOPE_CTE}
            SELECT
                m.UserId,
                ${displayName('u')} AS EmployeeName,
                d.DoctorId,
                d.DoctorName,
                d.Category,
                d.Speciality,
                t.TerritoryName,
                (SELECT CONVERT(VARCHAR(10), MAX(v.VisitDate), 23) FROM dbo.Visits v
                 WHERE v.UserId = m.UserId AND v.DoctorId = m.DoctorId) AS LastVisit
            FROM Scope s
            INNER JOIN dbo.UserDoctorMapping m ON m.UserId = s.UserId AND ISNULL(m.IsActive, 'Yes') <> 'No'
            INNER JOIN Users u ON u.UserId = m.UserId
            INNER JOIN dbo.Doctor d ON d.DoctorId = m.DoctorId AND ISNULL(d.IsActive, 'Yes') <> 'No'
            LEFT JOIN Territory t ON t.TerritoryId = TRY_CONVERT(UNIQUEIDENTIFIER, d.TerritoryId)
            WHERE d.Category IN ('A', 'B') AND ${IN_SCOPE('m.UserId')}
        `;
    },

    NEGATIVE_FEEDBACK: () => {
        return `
            ${SCOPE_CTE}
            SELECT
                v.UserId,
                ${displayName('u')} AS EmployeeName,
                d.DoctorId,
                d.DoctorName,
                d.Category,
                COUNT(*) AS Negatives,
                CONVERT(VARCHAR(10), MAX(v.VisitDate), 23) AS LastNegative
            FROM Scope s
            INNER JOIN dbo.Visits v ON v.UserId = s.UserId
            INNER JOIN Users u ON u.UserId = v.UserId
            INNER JOIN dbo.Doctor d ON d.DoctorId = v.DoctorId
            WHERE v.Feedback = 'NEGATIVE' AND v.VisitDate >= @Since AND ${IN_SCOPE('v.UserId')}
            GROUP BY v.UserId, ${displayName('u')}, d.DoctorId, d.DoctorName, d.Category
        `;
    },

    // Our vs competitor units per doctor per audit (last 180 days), oldest first.
    RCPA_SHARES: () => {
        return `
            ${SCOPE_CTE}
            SELECT
                r.UserId,
                ${displayName('u')} AS EmployeeName,
                r.DoctorId,
                d.DoctorName,
                d.Category,
                CONVERT(VARCHAR(10), r.AuditDate, 23) AS AuditDate,
                SUM(l.OurQuantity) AS Ours,
                SUM(l.CompetitorQuantity) AS Theirs
            FROM Scope s
            INNER JOIN dbo.RcpaEntries r ON r.UserId = s.UserId
            INNER JOIN dbo.RcpaLines l ON l.RcpaId = r.RcpaId
            INNER JOIN Users u ON u.UserId = r.UserId
            INNER JOIN dbo.Doctor d ON d.DoctorId = r.DoctorId
            WHERE r.AuditDate >= @Since AND ${IN_SCOPE('r.UserId')}
            GROUP BY r.UserId, ${displayName('u')}, r.DoctorId, d.DoctorName, d.Category, r.AuditDate
            ORDER BY r.AuditDate
        `;
    },

    // ---------------------------------------------------------
    // Rep performance: this month so far vs the same days last month
    // ---------------------------------------------------------

    REP_STATS: () => {
        return `
            ${SCOPE_CTE}
            SELECT
                u.UserId,
                ${displayName('u')} AS Name,
                sld.SystemLovDetailName AS DesignationName,
                ${displayName('m')} AS ManagerName,
                (SELECT COUNT(*) FROM dbo.Visits v WHERE v.UserId = u.UserId AND v.VisitDate BETWEEN @MonthStart AND @Today) AS Calls,
                (SELECT COUNT(*) FROM dbo.Visits v WHERE v.UserId = u.UserId AND v.VisitDate BETWEEN @PrevStart AND @PrevSameDay) AS PrevCalls,
                (SELECT COUNT(DISTINCT v.DoctorId) FROM dbo.Visits v WHERE v.UserId = u.UserId AND v.VisitDate BETWEEN @MonthStart AND @Today) AS DoctorsVisited,
                (SELECT COUNT(DISTINCT v.DoctorId) FROM dbo.Visits v WHERE v.UserId = u.UserId AND v.VisitDate BETWEEN @PrevStart AND @PrevSameDay) AS PrevDoctorsVisited,
                (SELECT COUNT(*) FROM dbo.UserDoctorMapping dm INNER JOIN dbo.Doctor d ON d.DoctorId = dm.DoctorId
                 WHERE dm.UserId = u.UserId AND ISNULL(dm.IsActive, 'Yes') <> 'No' AND ISNULL(d.IsActive, 'Yes') <> 'No') AS DoctorsMapped,
                (SELECT COUNT(*) FROM dbo.Visits v WHERE v.UserId = u.UserId AND v.VisitDate BETWEEN @MonthStart AND @Today AND v.LocationStatus = 'CAPTURED') AS WithGps,
                (SELECT COUNT(*) FROM dbo.Visits v WHERE v.UserId = u.UserId AND v.VisitDate BETWEEN @PrevStart AND @PrevSameDay AND v.LocationStatus = 'CAPTURED') AS PrevWithGps,
                (SELECT COUNT(*) FROM dbo.Visits v WHERE v.UserId = u.UserId AND v.VisitDate BETWEEN @MonthStart AND @Today AND v.PlanStatus = 'IN_PLAN') AS InPlan,
                (SELECT COUNT(DISTINCT v.VisitDate) FROM dbo.Visits v WHERE v.UserId = u.UserId AND v.VisitDate BETWEEN @MonthStart AND @Today) AS FieldDays,
                (SELECT COUNT(DISTINCT v.VisitDate) FROM dbo.Visits v WHERE v.UserId = u.UserId AND v.VisitDate BETWEEN @MonthStart AND @DcrCutoff
                 AND NOT EXISTS (SELECT 1 FROM dbo.DailyCallReports r WHERE r.UserId = v.UserId AND r.ReportDate = v.VisitDate)) AS MissedDcrs,
                (SELECT CONVERT(VARCHAR(10), MAX(v.VisitDate), 23) FROM dbo.Visits v WHERE v.UserId = u.UserId) AS LastVisit
            FROM Scope s
            INNER JOIN Users u ON u.UserId = s.UserId
            LEFT JOIN Users m ON m.UserId = u.ManagerId
            LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = u.DesignationId
            WHERE ISNULL(u.IsActive, 1) = 1 AND ${IN_SCOPE('u.UserId')}
        `;
    },

    REP_POB: () => {
        return `
            ${SCOPE_CTE}
            SELECT o.UserId,
                   SUM(CASE WHEN o.OrderDate BETWEEN @MonthStart AND @Today THEN o.NetAmount ELSE 0 END) AS Pob,
                   SUM(CASE WHEN o.OrderDate BETWEEN @PrevStart AND @PrevSameDay THEN o.NetAmount ELSE 0 END) AS PrevPob
            FROM Scope s
            INNER JOIN dbo.Orders o ON o.UserId = s.UserId
            WHERE o.Status <> 'CANCELLED' AND o.OrderDate BETWEEN @PrevStart AND @Today AND ${IN_SCOPE('o.UserId')}
            GROUP BY o.UserId
        `;
    },

    // Secondary vs target per rep per month (last 3 months).
    REP_SALES: () => {
        return `
            ${SCOPE_CTE},
            Sec AS (
                SELECT ss.UserId, ss.StatementMonth AS SalesMonth, SUM(ss.SalesValue) AS Secondary
                FROM Scope s INNER JOIN dbo.SecondaryStatements ss ON ss.UserId = s.UserId
                WHERE ss.Status IN ('SUBMITTED', 'APPROVED') AND ss.StatementMonth >= @SalesFrom
                GROUP BY ss.UserId, ss.StatementMonth
            ),
            Tgt AS (
                SELECT tg.UserId, tg.TargetMonth AS SalesMonth, SUM(tg.TargetValue) AS Target
                FROM Scope s INNER JOIN dbo.SalesTargets tg ON tg.UserId = s.UserId
                WHERE tg.TargetMonth >= @SalesFrom
                GROUP BY tg.UserId, tg.TargetMonth
            )
            SELECT COALESCE(a.UserId, t.UserId) AS UserId,
                   CONVERT(VARCHAR(7), COALESCE(a.SalesMonth, t.SalesMonth), 23) AS SalesMonth,
                   ISNULL(a.Secondary, 0) AS Secondary,
                   ISNULL(t.Target, 0) AS Target
            FROM Sec a
            FULL OUTER JOIN Tgt t ON t.UserId = a.UserId AND t.SalesMonth = a.SalesMonth
            WHERE ${IN_SCOPE('COALESCE(a.UserId, t.UserId)')}
        `;
    },

    // ---------------------------------------------------------
    // Business / stock
    // ---------------------------------------------------------

    // Lines of each stockist's latest submitted / approved statement prepared by someone in scope.
    LATEST_STOCK: () => {
        return `
            ${SCOPE_CTE},
            Latest AS (
                SELECT ss.*, ROW_NUMBER() OVER (PARTITION BY ss.StockistId ORDER BY ss.StatementMonth DESC) AS rn
                FROM Scope s
                INNER JOIN dbo.SecondaryStatements ss ON ss.UserId = s.UserId
                WHERE ss.Status IN ('SUBMITTED', 'APPROVED') AND ${IN_SCOPE('ss.UserId')}
            )
            SELECT
                ls.StatementId,
                ls.UserId,
                ${displayName('u')} AS EmployeeName,
                ls.StockistId,
                st.StockistName,
                CONVERT(VARCHAR(7), ls.StatementMonth, 23) AS StatementMonth,
                l.ProductId,
                p.ProductName,
                l.SalesQty,
                l.ClosingQty,
                l.ClosingValue
            FROM Latest ls
            INNER JOIN dbo.SecondaryStatementLines l ON l.StatementId = ls.StatementId
            INNER JOIN dbo.Products p ON p.ProductId = l.ProductId
            INNER JOIN Users u ON u.UserId = ls.UserId
            LEFT JOIN dbo.Stockist st ON st.StockistId = ls.StockistId
            WHERE ls.rn = 1
        `;
    },

    POB_PENDING: () => {
        return `
            ${SCOPE_CTE}
            SELECT
                o.OrderId,
                o.OrderNumber,
                CONVERT(VARCHAR(10), o.OrderDate, 23) AS OrderDate,
                o.UserId,
                ${displayName('u')} AS EmployeeName,
                o.Status,
                o.NetAmount,
                COALESCE(dd.DoctorName, ph.PharmacyName) AS CustomerName,
                o.CustomerType,
                st.StockistName
            FROM Scope s
            INNER JOIN dbo.Orders o ON o.UserId = s.UserId
            INNER JOIN Users u ON u.UserId = o.UserId
            LEFT JOIN dbo.Doctor dd ON dd.DoctorId = o.DoctorId
            LEFT JOIN dbo.Pharmacy ph ON ph.PharmacyId = o.PharmacyId
            LEFT JOIN dbo.Stockist st ON st.StockistId = o.StockistId
            WHERE o.Status IN ('BOOKED', 'CONFIRMED') AND o.OrderDate <= @Cutoff AND ${IN_SCOPE('o.UserId')}
        `;
    },

    // ---------------------------------------------------------
    // Field intelligence / analytics (last @Since .. @Today)
    // ---------------------------------------------------------

    RECENT_VISITS: () => {
        return `
            ${SCOPE_CTE}
            SELECT TOP (@Limit)
                v.UserId,
                v.DoctorId,
                d.DoctorName,
                d.Category,
                d.Speciality,
                t.TerritoryName,
                CONVERT(VARCHAR(10), v.VisitDate, 23) AS VisitDate,
                DATEPART(WEEKDAY, v.VisitDate) AS WeekdayNo,
                DATEPART(HOUR, v.StartTime) AS VisitHour,
                v.Feedback,
                CASE WHEN v.JointWorkUserId IS NULL THEN 0 ELSE 1 END AS IsJoint
            FROM Scope s
            INNER JOIN dbo.Visits v ON v.UserId = s.UserId
            INNER JOIN dbo.Doctor d ON d.DoctorId = v.DoctorId
            LEFT JOIN Territory t ON t.TerritoryId = TRY_CONVERT(UNIQUEIDENTIFIER, d.TerritoryId)
            WHERE v.VisitDate BETWEEN @Since AND @Today AND ${IN_SCOPE('v.UserId')}
            ORDER BY v.VisitDate DESC
        `;
    },

    DOCTOR_RCPA_TOTALS: () => {
        return `
            ${SCOPE_CTE}
            SELECT r.DoctorId, SUM(l.OurQuantity) AS Ours, SUM(l.CompetitorQuantity) AS Theirs
            FROM Scope s
            INNER JOIN dbo.RcpaEntries r ON r.UserId = s.UserId
            INNER JOIN dbo.RcpaLines l ON l.RcpaId = r.RcpaId
            WHERE r.AuditDate BETWEEN @Since AND @Today AND ${IN_SCOPE('r.UserId')}
            GROUP BY r.DoctorId
        `;
    },

    DOCTOR_POB_TOTALS: () => {
        return `
            ${SCOPE_CTE}
            SELECT o.DoctorId, SUM(o.NetAmount) AS Pob
            FROM Scope s
            INNER JOIN dbo.Orders o ON o.UserId = s.UserId
            WHERE o.CustomerType = 'DOCTOR' AND o.Status <> 'CANCELLED' AND o.OrderDate BETWEEN @Since AND @Today AND ${IN_SCOPE('o.UserId')}
            GROUP BY o.DoctorId
        `;
    },

    // Assigned doctors in scope (for segmentation, including doctors with no calls).
    ASSIGNED_DOCTORS: () => {
        return `
            ${SCOPE_CTE}
            SELECT DISTINCT d.DoctorId, d.DoctorName, d.Category, d.Speciality, t.TerritoryName
            FROM Scope s
            INNER JOIN dbo.UserDoctorMapping m ON m.UserId = s.UserId AND ISNULL(m.IsActive, 'Yes') <> 'No'
            INNER JOIN dbo.Doctor d ON d.DoctorId = m.DoctorId AND ISNULL(d.IsActive, 'Yes') <> 'No'
            LEFT JOIN Territory t ON t.TerritoryId = TRY_CONVERT(UNIQUEIDENTIFIER, d.TerritoryId)
            WHERE ${IN_SCOPE('m.UserId')}
        `;
    },

    // Business per month (last 6 months) for growth and the month-end forecast.
    MONTHLY_BUSINESS: () => {
        return `
            ${SCOPE_CTE}
            SELECT m.SalesMonth,
                   ISNULL((SELECT SUM(o.NetAmount) FROM Scope s2 INNER JOIN dbo.Orders o ON o.UserId = s2.UserId
                           WHERE o.Status <> 'CANCELLED' AND CONVERT(VARCHAR(7), o.OrderDate, 23) = m.SalesMonth AND ${IN_SCOPE('o.UserId')}), 0) AS Pob,
                   ISNULL((SELECT SUM(ss.SalesValue) FROM Scope s3 INNER JOIN dbo.SecondaryStatements ss ON ss.UserId = s3.UserId
                           WHERE ss.Status IN ('SUBMITTED', 'APPROVED') AND CONVERT(VARCHAR(7), ss.StatementMonth, 23) = m.SalesMonth AND ${IN_SCOPE('ss.UserId')}), 0) AS Secondary,
                   ISNULL((SELECT SUM(tg.TargetValue) FROM Scope s4 INNER JOIN dbo.SalesTargets tg ON tg.UserId = s4.UserId
                           WHERE CONVERT(VARCHAR(7), tg.TargetMonth, 23) = m.SalesMonth AND ${IN_SCOPE('tg.UserId')}), 0) AS Target,
                   ISNULL((SELECT COUNT(*) FROM Scope s5 INNER JOIN dbo.Visits v ON v.UserId = s5.UserId
                           WHERE CONVERT(VARCHAR(7), v.VisitDate, 23) = m.SalesMonth AND ${IN_SCOPE('v.UserId')}), 0) AS Calls
            FROM (SELECT value AS SalesMonth FROM STRING_SPLIT(@Months, ',')) m
        `;
    },
};
