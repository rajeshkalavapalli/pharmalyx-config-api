const displayName = (alias) =>
    `COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(${alias}.FirstName, ' ', ${alias}.LastName))), ''), ${alias}.UserName)`;

const activeMapping = `ISNULL(m.IsActive, 'Yes') <> 'No'`;

module.exports = {
    GET_USER: () => {
        return `
            SELECT
                u.UserId,
                ${displayName('u')} AS Name,
                u.ManagerId,
                sld.SystemLovDetailName AS DesignationName
            FROM Users u
            LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = u.DesignationId
            WHERE u.UserId = @UserId
        `;
    },

    // Headline numbers for one user.
    GET_KPIS: () => {
        return `
            SELECT
                (SELECT COUNT(*) FROM dbo.Visits WHERE UserId = @UserId AND VisitDate = @Today) AS VisitsToday,
                (SELECT COUNT(*) FROM dbo.Visits
                 WHERE UserId = @UserId AND VisitDate BETWEEN @MonthStart AND @MonthEnd) AS VisitsMonth,
                (SELECT COUNT(*) FROM dbo.Visits
                 WHERE UserId = @UserId AND VisitDate BETWEEN @PrevMonthStart AND @PrevMonthSameDay) AS VisitsPrevMonthToDate,
                (SELECT COUNT(DISTINCT m.DoctorId) FROM dbo.UserDoctorMapping m
                 WHERE m.UserId = @UserId AND ${activeMapping}) AS DoctorsMapped,
                (SELECT COUNT(DISTINCT v.DoctorId) FROM dbo.Visits v
                 WHERE v.UserId = @UserId AND v.VisitDate BETWEEN @MonthStart AND @MonthEnd) AS DoctorsVisited,
                (SELECT AVG(CAST(DATEDIFF(MINUTE, StartTime, EndTime) AS FLOAT)) FROM dbo.Visits
                 WHERE UserId = @UserId AND VisitDate BETWEEN @MonthStart AND @MonthEnd
                   AND StartTime IS NOT NULL AND EndTime IS NOT NULL) AS AvgCallMinutes,
                (SELECT COUNT(*) FROM dbo.Visits
                 WHERE UserId = @UserId AND VisitDate BETWEEN @MonthStart AND @MonthEnd
                   AND LocationStatus = 'CAPTURED') AS VisitsWithGps,
                (SELECT COUNT(*) FROM dbo.Visits
                 WHERE UserId = @UserId AND VisitDate BETWEEN @MonthStart AND @MonthEnd
                   AND PlanStatus = 'IN_PLAN') AS VisitsInPlan,
                (SELECT COUNT(*) FROM dbo.DailyCallReports
                 WHERE UserId = @UserId AND ReportDate BETWEEN @MonthStart AND @MonthEnd) AS DcrSent,
                (SELECT COUNT(*) FROM dbo.DailyCallReports
                 WHERE UserId = @UserId AND ReportDate BETWEEN @MonthStart AND @MonthEnd
                   AND Status = 'APPROVED') AS DcrApproved,
                (SELECT COUNT(*) FROM dbo.DailyCallReports
                 WHERE UserId = @UserId AND Status = 'RETURNED') AS DcrReturned,
                (SELECT ISNULL(SUM(DistanceKm), 0) FROM dbo.DailyCallReports
                 WHERE UserId = @UserId AND ReportDate BETWEEN @MonthStart AND @MonthEnd) AS DistanceKm,
                (SELECT COUNT(*) FROM dbo.TourPlanDeviation
                 WHERE UserId = @UserId AND DeviationDate BETWEEN @MonthStart AND @MonthEnd) AS DeviationsMonth
        `;
    },

    // Distinct visit days in the month (for missed-DCR counting in the service).
    GET_VISIT_DAYS: () => {
        return `
            SELECT CONVERT(VARCHAR(10), VisitDate, 23) AS VisitDate, COUNT(*) AS VisitCount
            FROM dbo.Visits
            WHERE UserId = @UserId AND VisitDate BETWEEN @FromDate AND @ToDate
            GROUP BY VisitDate
        `;
    },

    GET_DCR_DATES: () => {
        return `
            SELECT CONVERT(VARCHAR(10), ReportDate, 23) AS ReportDate, Status
            FROM dbo.DailyCallReports
            WHERE UserId = @UserId AND ReportDate BETWEEN @FromDate AND @ToDate
        `;
    },

    GET_TODAY_PLAN: () => {
        return `
            SELECT TOP (1)
                REPLACE(d.DayType, '_', '-') AS DayType,
                t.TerritoryName,
                a.AreaName
            FROM dbo.TourPlan tp
            INNER JOIN dbo.TourPlanDetails d ON d.TourPlanId = tp.TourPlanId
            LEFT JOIN Territory t ON t.TerritoryId = d.TerritoryId
            LEFT JOIN Areas a ON a.AreaId = d.AreaId
            WHERE tp.UserId = @UserId
              AND tp.PlanMonth = @MonthStart
              AND d.PlanDate = @Today
        `;
    },

    GET_MONTH_PLAN_STATUS: () => {
        return `
            SELECT TOP (1) sld.SystemLovDetailCode AS Status
            FROM dbo.TourPlan tp
            LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = tp.StatusId
            WHERE tp.UserId = @UserId AND tp.PlanMonth = @MonthStart
        `;
    },

    GET_TODAY_DCR: () => {
        return `
            SELECT Status
            FROM dbo.DailyCallReports
            WHERE UserId = @UserId AND ReportDate = @Today
        `;
    },

    // Items waiting for this user's decision (as a reporting manager).
    GET_APPROVALS: () => {
        return `
            SELECT
                (SELECT COUNT(*) FROM dbo.TourPlan tp
                 INNER JOIN Users u ON u.UserId = tp.UserId
                 INNER JOIN SystemLovDetails sld ON sld.SystemLovDetailId = tp.StatusId
                 WHERE u.ManagerId = @UserId AND sld.SystemLovDetailCode = 'SUBMITTED') AS TourPlans,
                (SELECT COUNT(*) FROM dbo.DailyCallReports r
                 INNER JOIN Users u ON u.UserId = r.UserId
                 WHERE u.ManagerId = @UserId AND r.Status = 'SUBMITTED') AS Dcrs,
                (SELECT COUNT(*) FROM dbo.TourPlanDeviation d
                 INNER JOIN Users u ON u.UserId = d.UserId
                 WHERE u.ManagerId = @UserId AND d.Status = 'PENDING') AS Deviations
        `;
    },

    // One row per direct report with this month's activity.
    GET_TEAM: () => {
        return `
            SELECT
                u.UserId,
                ${displayName('u')} AS Name,
                sld.SystemLovDetailName AS DesignationName,
                (SELECT COUNT(*) FROM dbo.Visits v
                 WHERE v.UserId = u.UserId AND v.VisitDate BETWEEN @MonthStart AND @MonthEnd) AS Visits,
                (SELECT COUNT(DISTINCT v.DoctorId) FROM dbo.Visits v
                 WHERE v.UserId = u.UserId AND v.VisitDate BETWEEN @MonthStart AND @MonthEnd) AS DoctorsVisited,
                (SELECT COUNT(DISTINCT m.DoctorId) FROM dbo.UserDoctorMapping m
                 WHERE m.UserId = u.UserId AND ${activeMapping}) AS DoctorsMapped,
                (SELECT COUNT(*) FROM dbo.DailyCallReports r
                 WHERE r.UserId = u.UserId AND r.ReportDate BETWEEN @MonthStart AND @MonthEnd) AS DcrSent,
                (SELECT MAX(v.VisitDate) FROM dbo.Visits v WHERE v.UserId = u.UserId) AS LastVisitDate
            FROM Users u
            LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = u.DesignationId
            WHERE u.ManagerId = @UserId
            ORDER BY Visits DESC, Name
        `;
    },

    // ---------------------------------------------------------
    // Doctor engagement (each query is optional: tables may not exist yet)
    // ---------------------------------------------------------

    GET_STOCK_SUMMARY: () => {
        return `
            SELECT
                -SUM(CASE WHEN EntryType = 'DISTRIBUTION' AND ItemType = 'SAMPLE'
                          AND EntryDate BETWEEN @MonthStart AND @MonthEnd THEN Quantity ELSE 0 END) AS SamplesGiven,
                -SUM(CASE WHEN EntryType = 'DISTRIBUTION' AND ItemType = 'GIFT'
                          AND EntryDate BETWEEN @MonthStart AND @MonthEnd THEN Quantity ELSE 0 END) AS GiftsGiven,
                COUNT(DISTINCT CASE WHEN EntryType = 'DISTRIBUTION'
                          AND EntryDate BETWEEN @MonthStart AND @MonthEnd THEN DoctorId END) AS DoctorsReached,
                (SELECT COUNT(*) FROM (
                    SELECT SUM(Quantity) AS Balance FROM dbo.EngagementStock
                    WHERE UserId = @UserId GROUP BY ItemType, ItemId
                 ) b WHERE b.Balance BETWEEN 1 AND @LowStock) AS LowStockItems,
                (SELECT COUNT(*) FROM (
                    SELECT SUM(Quantity) AS Balance FROM dbo.EngagementStock
                    WHERE UserId = @UserId GROUP BY ItemType, ItemId
                 ) b WHERE b.Balance > 0) AS ItemsHeld
            FROM dbo.EngagementStock
            WHERE UserId = @UserId
        `;
    },

    GET_BUSINESS_SUMMARY: () => {
        return `
            SELECT SUM(ExpectedValue) AS Expected, SUM(ISNULL(ActualValue, 0)) AS Actual
            FROM dbo.DoctorBusiness
            WHERE UserId = @UserId AND BusinessMonth = @MonthStart
        `;
    },

    GET_RCPA_SUMMARY: () => {
        return `
            SELECT SUM(l.OurQuantity) AS Ours, SUM(l.CompetitorQuantity) AS Theirs, COUNT(DISTINCT r.RcpaId) AS Audits
            FROM dbo.RcpaEntries r
            INNER JOIN dbo.RcpaLines l ON l.RcpaId = r.RcpaId
            WHERE r.UserId = @UserId AND r.AuditDate BETWEEN @MonthStart AND @MonthEnd
        `;
    },

    GET_FEEDBACK_SUMMARY: () => {
        return `
            SELECT Feedback, COUNT(*) AS Visits
            FROM dbo.Visits
            WHERE UserId = @UserId AND VisitDate BETWEEN @MonthStart AND @MonthEnd AND Feedback IS NOT NULL
            GROUP BY Feedback
        `;
    },

    // ---------------------------------------------------------
    // Charts
    // ---------------------------------------------------------

    // Assigned doctors per category and how many were visited this month.
    GET_COVERAGE_BY_CATEGORY: () => {
        return `
            SELECT
                ISNULL(d.Category, 'U') AS Category,
                COUNT(*) AS Mapped,
                SUM(CASE WHEN v.DoctorId IS NOT NULL THEN 1 ELSE 0 END) AS Visited
            FROM dbo.UserDoctorMapping m
            INNER JOIN dbo.Doctor d ON d.DoctorId = m.DoctorId
            LEFT JOIN (
                SELECT DISTINCT DoctorId FROM dbo.Visits
                WHERE UserId = @UserId AND VisitDate BETWEEN @MonthStart AND @MonthEnd
            ) v ON v.DoctorId = m.DoctorId
            WHERE m.UserId = @UserId
              AND ISNULL(m.IsActive, 'Yes') <> 'No'
              AND ISNULL(d.IsActive, 'Yes') <> 'No'
            GROUP BY ISNULL(d.Category, 'U')
        `;
    },

    GET_MONTHLY_VISITS: () => {
        return `
            SELECT CONVERT(VARCHAR(7), VisitDate, 23) AS VisitMonth, COUNT(*) AS Visits
            FROM dbo.Visits
            WHERE UserId = @UserId AND VisitDate BETWEEN @FromDate AND @ToDate
            GROUP BY CONVERT(VARCHAR(7), VisitDate, 23)
        `;
    },

    // ---------------------------------------------------------
    // Team (direct reports of the acting user)
    // ---------------------------------------------------------

    GET_TEAM_VISIT_DAYS: () => {
        return `
            SELECT CONVERT(VARCHAR(10), v.VisitDate, 23) AS VisitDate, COUNT(*) AS VisitCount
            FROM dbo.Visits v
            INNER JOIN Users u ON u.UserId = v.UserId
            WHERE u.ManagerId = @UserId AND v.VisitDate BETWEEN @FromDate AND @ToDate
            GROUP BY v.VisitDate
        `;
    },

    GET_TEAM_TODAY: () => {
        return `
            SELECT
                (SELECT COUNT(*) FROM Users WHERE ManagerId = @UserId) AS Reps,
                (SELECT COUNT(DISTINCT v.UserId) FROM dbo.Visits v
                 INNER JOIN Users u ON u.UserId = v.UserId
                 WHERE u.ManagerId = @UserId AND v.VisitDate = @Today) AS RepsActiveToday,
                (SELECT COUNT(*) FROM dbo.Visits v
                 INNER JOIN Users u ON u.UserId = v.UserId
                 WHERE u.ManagerId = @UserId AND v.VisitDate = @Today) AS VisitsToday,
                (SELECT COUNT(*) FROM dbo.TourPlanDeviation d
                 INNER JOIN Users u ON u.UserId = d.UserId
                 WHERE u.ManagerId = @UserId AND d.DeviationDate BETWEEN @MonthStart AND @MonthEnd) AS DeviationsMonth
        `;
    },

    GET_TEAM_BUSINESS: () => {
        return `
            SELECT SUM(b.ExpectedValue) AS Expected, SUM(ISNULL(b.ActualValue, 0)) AS Actual
            FROM dbo.DoctorBusiness b
            INNER JOIN Users u ON u.UserId = b.UserId
            WHERE u.ManagerId = @UserId AND b.BusinessMonth = @MonthStart
        `;
    },

    GET_TEAM_SAMPLES: () => {
        return `
            SELECT -SUM(s.Quantity) AS Given
            FROM dbo.EngagementStock s
            INNER JOIN Users u ON u.UserId = s.UserId
            WHERE u.ManagerId = @UserId AND s.EntryType = 'DISTRIBUTION'
              AND s.EntryDate BETWEEN @MonthStart AND @MonthEnd
        `;
    },

    // Today's calls: the pre-call plan in call order, plus visits made today that weren't planned.
    GET_TODAY_SCHEDULE: () => {
        return `
            SELECT 'PLAN' AS Source, pc.CallOrder, d.DoctorName, d.HospitalName, d.Category, pc.Objective, pc.Status,
                   (SELECT TOP 1 CONVERT(VARCHAR(5), v.StartTime, 108) FROM dbo.Visits v
                    WHERE v.UserId = pc.UserId AND v.DoctorId = pc.DoctorId AND v.VisitDate = pc.PlanDate
                    ORDER BY v.StartTime) AS VisitTime
            FROM dbo.PreCallPlans pc
            INNER JOIN dbo.Doctor d ON d.DoctorId = pc.DoctorId
            WHERE pc.UserId = @UserId AND pc.PlanDate = @Today

            UNION ALL

            SELECT 'VISIT', NULL, d.DoctorName, d.HospitalName, d.Category, NULL, 'VISITED', CONVERT(VARCHAR(5), v.StartTime, 108)
            FROM dbo.Visits v
            INNER JOIN dbo.Doctor d ON d.DoctorId = v.DoctorId
            WHERE v.UserId = @UserId AND v.VisitDate = @Today
              AND NOT EXISTS (SELECT 1 FROM dbo.PreCallPlans pc
                              WHERE pc.UserId = v.UserId AND pc.DoctorId = v.DoctorId AND pc.PlanDate = v.VisitDate)
        `;
    },

    // Calls planned per day in pre-call planning (for planned vs completed).
    GET_PLANNED_DAYS: () => {
        return `
            SELECT CONVERT(VARCHAR(10), PlanDate, 23) AS PlanDate, COUNT(*) AS Planned
            FROM dbo.PreCallPlans
            WHERE UserId = @UserId AND PlanDate BETWEEN @FromDate AND @ToDate
            GROUP BY PlanDate
        `;
    },

    // Territories of the user's doctors: doctors, doctors visited this month,
    // visits this month, and whether the tour plan still has a working day there.
    GET_TERRITORY_COVERAGE: () => {
        return `
            SELECT
                t.TerritoryId,
                t.TerritoryName,
                COUNT(*) AS Doctors,
                SUM(CASE WHEN vd.DoctorId IS NOT NULL THEN 1 ELSE 0 END) AS DoctorsVisited,
                ISNULL(SUM(vd.Visits), 0) AS Visits,
                MAX(CASE WHEN tpd.TerritoryId IS NOT NULL THEN 1 ELSE 0 END) AS PlannedAhead
            FROM dbo.UserDoctorMapping m
            INNER JOIN dbo.Doctor d ON d.DoctorId = m.DoctorId
            INNER JOIN Territory t ON t.TerritoryId = TRY_CONVERT(UNIQUEIDENTIFIER, d.TerritoryId)
            LEFT JOIN (
                SELECT DoctorId, COUNT(*) AS Visits FROM dbo.Visits
                WHERE UserId = @UserId AND VisitDate BETWEEN @MonthStart AND @MonthEnd
                GROUP BY DoctorId
            ) vd ON vd.DoctorId = m.DoctorId
            LEFT JOIN (
                SELECT DISTINCT dt.TerritoryId
                FROM dbo.TourPlan tp
                INNER JOIN dbo.TourPlanDetails dt ON dt.TourPlanId = tp.TourPlanId
                WHERE tp.UserId = @UserId AND tp.PlanMonth = @MonthStart
                  AND dt.DayType = 'working' AND dt.PlanDate >= @Today
            ) tpd ON tpd.TerritoryId = t.TerritoryId
            WHERE m.UserId = @UserId
              AND ISNULL(m.IsActive, 'Yes') <> 'No'
              AND ISNULL(d.IsActive, 'Yes') <> 'No'
            GROUP BY t.TerritoryId, t.TerritoryName
        `;
    },

    // ---------------------------------------------------------
    // Team view extras
    // ---------------------------------------------------------

    GET_TEAM_PLANNED_DAYS: () => {
        return `
            SELECT CONVERT(VARCHAR(10), pc.PlanDate, 23) AS PlanDate, COUNT(*) AS Planned
            FROM dbo.PreCallPlans pc
            INNER JOIN Users u ON u.UserId = pc.UserId
            WHERE u.ManagerId = @UserId AND pc.PlanDate BETWEEN @FromDate AND @ToDate
            GROUP BY pc.PlanDate
        `;
    },

    // Each direct report today: tour plan day, visits, first/last visit time, DCR status.
    GET_TEAM_MEMBERS_TODAY: () => {
        return `
            SELECT
                u.UserId,
                (SELECT COUNT(*) FROM dbo.Visits v WHERE v.UserId = u.UserId AND v.VisitDate = @Today) AS VisitsToday,
                (SELECT CONVERT(VARCHAR(5), MIN(v.StartTime), 108) FROM dbo.Visits v WHERE v.UserId = u.UserId AND v.VisitDate = @Today) AS FirstVisit,
                (SELECT CONVERT(VARCHAR(5), MAX(v.StartTime), 108) FROM dbo.Visits v WHERE v.UserId = u.UserId AND v.VisitDate = @Today) AS LastVisit,
                (SELECT TOP 1 r.Status FROM dbo.DailyCallReports r WHERE r.UserId = u.UserId AND r.ReportDate = @Today) AS DcrStatus,
                (SELECT TOP 1 REPLACE(d.DayType, '_', '-') FROM dbo.TourPlan tp
                 INNER JOIN dbo.TourPlanDetails d ON d.TourPlanId = tp.TourPlanId
                 WHERE tp.UserId = u.UserId AND tp.PlanMonth = @MonthStart AND d.PlanDate = @Today) AS DayType,
                (SELECT TOP 1 t.TerritoryName FROM dbo.TourPlan tp
                 INNER JOIN dbo.TourPlanDetails d ON d.TourPlanId = tp.TourPlanId
                 LEFT JOIN Territory t ON t.TerritoryId = d.TerritoryId
                 WHERE tp.UserId = u.UserId AND tp.PlanMonth = @MonthStart AND d.PlanDate = @Today) AS TerritoryName
            FROM Users u
            WHERE u.ManagerId = @UserId
        `;
    },

    GET_TEAM_PLANNED_TODAY: () => {
        return `
            SELECT pc.UserId, COUNT(*) AS Planned
            FROM dbo.PreCallPlans pc
            INNER JOIN Users u ON u.UserId = pc.UserId
            WHERE u.ManagerId = @UserId AND pc.PlanDate = @Today
            GROUP BY pc.UserId
        `;
    },

    // Territories across the team's doctor assignments (same rules as the personal view).
    GET_TEAM_TERRITORY_COVERAGE: () => {
        return `
            SELECT
                t.TerritoryId,
                t.TerritoryName,
                COUNT(*) AS Doctors,
                SUM(CASE WHEN vd.DoctorId IS NOT NULL THEN 1 ELSE 0 END) AS DoctorsVisited,
                ISNULL(SUM(vd.Visits), 0) AS Visits,
                MAX(CASE WHEN tpd.TerritoryId IS NOT NULL THEN 1 ELSE 0 END) AS PlannedAhead
            FROM dbo.UserDoctorMapping m
            INNER JOIN Users u ON u.UserId = m.UserId AND u.ManagerId = @UserId
            INNER JOIN dbo.Doctor d ON d.DoctorId = m.DoctorId
            INNER JOIN Territory t ON t.TerritoryId = TRY_CONVERT(UNIQUEIDENTIFIER, d.TerritoryId)
            LEFT JOIN (
                SELECT UserId, DoctorId, COUNT(*) AS Visits FROM dbo.Visits
                WHERE VisitDate BETWEEN @MonthStart AND @MonthEnd
                GROUP BY UserId, DoctorId
            ) vd ON vd.UserId = m.UserId AND vd.DoctorId = m.DoctorId
            LEFT JOIN (
                SELECT DISTINCT dt.TerritoryId
                FROM dbo.TourPlan tp
                INNER JOIN Users tu ON tu.UserId = tp.UserId AND tu.ManagerId = @UserId
                INNER JOIN dbo.TourPlanDetails dt ON dt.TourPlanId = tp.TourPlanId
                WHERE tp.PlanMonth = @MonthStart AND dt.DayType = 'working' AND dt.PlanDate >= @Today
            ) tpd ON tpd.TerritoryId = t.TerritoryId
            WHERE ISNULL(m.IsActive, 'Yes') <> 'No'
              AND ISNULL(d.IsActive, 'Yes') <> 'No'
            GROUP BY t.TerritoryId, t.TerritoryName
        `;
    },
};
