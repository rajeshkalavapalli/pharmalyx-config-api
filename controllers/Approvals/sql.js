const displayName = (alias) =>
    `COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(${alias}.FirstName, ' ', ${alias}.LastName))), ''), ${alias}.UserName)`;

// Items waiting for the acting user. Manager steps: submitted by a direct report (ManagerId = @UserId).
module.exports = {
    TOUR_PLANS: () => {
        return `
            SELECT
                tp.TourPlanId AS Id,
                ${displayName('u')} AS UserName,
                CONVERT(VARCHAR(7), tp.PlanMonth, 23) AS Period,
                tp.SubmittedOn,
                (SELECT COUNT(*) FROM dbo.TourPlanDetails d WHERE d.TourPlanId = tp.TourPlanId AND d.DayType = 'working') AS WorkingDays,
                (SELECT COUNT(*) FROM dbo.TourPlanDetails d WHERE d.TourPlanId = tp.TourPlanId) AS DaysPlanned
            FROM dbo.TourPlan tp
            INNER JOIN Users u ON u.UserId = tp.UserId
            INNER JOIN SystemLovDetails s ON s.SystemLovDetailId = tp.StatusId
            WHERE u.ManagerId = @UserId
              AND (UPPER(s.SystemLovDetailCode) = 'SUBMITTED' OR UPPER(s.SystemLovDetailName) IN ('SUBMITTED', 'SUBMITTED FOR APPROVAL'))
        `;
    },

    DEVIATIONS: () => {
        return `
            SELECT
                d.DeviationId AS Id,
                ${displayName('u')} AS UserName,
                CONVERT(VARCHAR(10), d.DeviationDate, 23) AS Period,
                d.SubmittedOn,
                d.DeviationType,
                d.Reason,
                pt.TerritoryName AS PlannedTerritory,
                at.TerritoryName AS ActualTerritory
            FROM dbo.TourPlanDeviation d
            INNER JOIN Users u ON u.UserId = d.UserId
            LEFT JOIN Territory pt ON pt.TerritoryId = d.PlannedTerritoryId
            LEFT JOIN Territory at ON at.TerritoryId = d.ActualTerritoryId
            WHERE u.ManagerId = @UserId AND d.Status = 'PENDING'
        `;
    },

    DCRS: () => {
        return `
            SELECT
                r.DcrId AS Id,
                ${displayName('u')} AS UserName,
                CONVERT(VARCHAR(10), r.ReportDate, 23) AS Period,
                r.SubmittedOn,
                r.VisitCount,
                r.TravelMode,
                r.DistanceKm
            FROM dbo.DailyCallReports r
            INNER JOIN Users u ON u.UserId = r.UserId
            WHERE u.ManagerId = @UserId AND r.Status = 'SUBMITTED'
        `;
    },

    STATEMENTS: () => {
        return `
            SELECT
                ss.StatementId AS Id,
                ${displayName('u')} AS UserName,
                CONVERT(VARCHAR(7), ss.StatementMonth, 23) AS Period,
                ss.SubmittedOn,
                st.StockistName,
                ss.SalesValue,
                ss.TotalSalesQty
            FROM dbo.SecondaryStatements ss
            INNER JOIN Users u ON u.UserId = ss.UserId
            LEFT JOIN dbo.Stockist st ON st.StockistId = ss.StockistId
            WHERE u.ManagerId = @UserId AND ss.Status = 'SUBMITTED'
        `;
    },

    DOCTOR_PLANS: () => {
        return `
            SELECT
                p.PlanId AS Id,
                ${displayName('u')} AS UserName,
                CONVERT(VARCHAR(7), p.PlanMonth, 23) AS Period,
                p.SubmittedOn,
                (SELECT COUNT(*) FROM dbo.DoctorPlanDoctors d WHERE d.PlanId = p.PlanId) AS Doctors
            FROM dbo.DoctorPlans p
            INNER JOIN Users u ON u.UserId = p.UserId
            WHERE u.ManagerId = @UserId AND p.Status = 'SUBMITTED'
        `;
    },

    CLAIMS_MANAGER: () => {
        return `
            SELECT
                c.ClaimId AS Id,
                ${displayName('u')} AS UserName,
                CONVERT(VARCHAR(7), c.ClaimMonth, 23) AS Period,
                c.SubmittedOn,
                c.ClaimedAmount
            FROM dbo.ExpenseClaims c
            INNER JOIN Users u ON u.UserId = c.UserId
            WHERE u.ManagerId = @UserId AND c.Status = 'SUBMITTED'
        `;
    },

    // Finance step: any manager-approved claim except your own.
    CLAIMS_FINANCE: () => {
        return `
            SELECT
                c.ClaimId AS Id,
                ${displayName('u')} AS UserName,
                CONVERT(VARCHAR(7), c.ClaimMonth, 23) AS Period,
                COALESCE(c.ManagerReviewedOn, c.SubmittedOn) AS SubmittedOn,
                c.ClaimedAmount,
                c.ApprovedAmount
            FROM dbo.ExpenseClaims c
            INNER JOIN Users u ON u.UserId = c.UserId
            WHERE c.Status = 'MANAGER_APPROVED' AND c.UserId <> @UserId
        `;
    },
};
