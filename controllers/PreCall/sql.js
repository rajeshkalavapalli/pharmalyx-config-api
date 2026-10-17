module.exports = {
    // The tour plan entry for the day (territory/area or off day), with the plan's status.
    GET_DAY_PLAN: () => {
        return `
            SELECT TOP (1)
                d.DayType,
                d.TerritoryId,
                t.TerritoryName,
                d.AreaId,
                a.AreaName,
                d.Remarks,
                sld.SystemLovDetailCode AS PlanStatus
            FROM dbo.TourPlan tp
            INNER JOIN dbo.TourPlanDetails d ON d.TourPlanId = tp.TourPlanId
            LEFT JOIN Territory t ON t.TerritoryId = d.TerritoryId
            LEFT JOIN Areas a ON a.AreaId = d.AreaId
            LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = tp.StatusId
            WHERE tp.UserId = @UserId
              AND tp.PlanMonth = @MonthStart
              AND d.PlanDate = @PlanDate
        `;
    },

    // Every assigned doctor with what a representative needs before the call.
    // Doctor.TerritoryId/AreaId are varchar, so TRY_CONVERT keeps bad values harmless.
    GET_DOCTOR_BRIEFS: () => {
        return `
            SELECT
                d.DoctorId,
                d.DoctorName,
                d.Qualification,
                d.Speciality,
                d.HospitalName,
                d.MobileNumber,
                d.Category,
                d.VisitsPerMonth,
                CONVERT(VARCHAR(10), d.DateOfBirth, 23) AS DateOfBirth,
                CONVERT(VARCHAR(10), d.AnniversaryDate, 23) AS AnniversaryDate,
                TRY_CONVERT(UNIQUEIDENTIFIER, d.TerritoryId) AS TerritoryId,
                t.TerritoryName,
                TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId) AS AreaId,
                a.AreaName,

                (SELECT COUNT(*) FROM dbo.Visits v
                 WHERE v.UserId = @UserId AND v.DoctorId = d.DoctorId
                   AND v.VisitDate BETWEEN @MonthStart AND @MonthEnd) AS VisitsThisMonth,

                (SELECT COUNT(*) FROM dbo.Visits v
                 WHERE v.UserId = @UserId AND v.DoctorId = d.DoctorId AND v.VisitDate = @PlanDate) AS VisitsOnDay,

                lv.VisitId AS LastVisitId,
                CONVERT(VARCHAR(10), lv.VisitDate, 23) AS LastVisitDate,
                lv.Feedback AS LastFeedback,
                lv.Notes AS LastNotes,
                CONVERT(VARCHAR(10), lv.FollowUpDate, 23) AS FollowUpDate,

                (SELECT STRING_AGG(CONCAT(COALESCE(p.ProductName, g.GiftName), ' × ', -s.Quantity), ', ')
                 FROM dbo.EngagementStock s
                 LEFT JOIN dbo.Products p ON s.ItemType = 'SAMPLE' AND p.ProductId = s.ItemId
                 LEFT JOIN dbo.Gifts g ON s.ItemType = 'GIFT' AND g.GiftId = s.ItemId
                 WHERE s.VisitId = lv.VisitId AND s.EntryType = 'DISTRIBUTION') AS LastItemsGiven,

                rc.OurQuantity AS RcpaOurs,
                rc.CompetitorQuantity AS RcpaTheirs,
                rc.TopCompetitor AS RcpaTopCompetitor,

                b.ExpectedValue AS BusinessExpected,
                b.ActualValue AS BusinessActual
            FROM dbo.UserDoctorMapping m
            INNER JOIN dbo.Doctor d ON d.DoctorId = m.DoctorId
            LEFT JOIN Territory t ON t.TerritoryId = TRY_CONVERT(UNIQUEIDENTIFIER, d.TerritoryId)
            LEFT JOIN Areas a ON a.AreaId = TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId)
            OUTER APPLY (
                SELECT TOP (1) v.VisitId, v.VisitDate, v.Feedback, v.Notes, v.FollowUpDate
                FROM dbo.Visits v
                WHERE v.UserId = @UserId AND v.DoctorId = d.DoctorId AND v.VisitDate < @PlanDate
                ORDER BY v.VisitDate DESC, v.CreatedOn DESC
            ) lv
            OUTER APPLY (
                SELECT
                    SUM(l.OurQuantity) AS OurQuantity,
                    SUM(l.CompetitorQuantity) AS CompetitorQuantity,
                    (SELECT TOP (1) l2.CompetitorBrand
                     FROM dbo.RcpaLines l2
                     INNER JOIN dbo.RcpaEntries r2 ON r2.RcpaId = l2.RcpaId
                     WHERE r2.UserId = @UserId AND r2.DoctorId = d.DoctorId
                       AND r2.AuditDate >= @RcpaFrom AND l2.CompetitorBrand IS NOT NULL
                     GROUP BY l2.CompetitorBrand
                     ORDER BY SUM(l2.CompetitorQuantity) DESC) AS TopCompetitor
                FROM dbo.RcpaLines l
                INNER JOIN dbo.RcpaEntries r ON r.RcpaId = l.RcpaId
                WHERE r.UserId = @UserId AND r.DoctorId = d.DoctorId AND r.AuditDate >= @RcpaFrom
            ) rc
            LEFT JOIN dbo.DoctorBusiness b
                ON b.UserId = @UserId AND b.DoctorId = d.DoctorId AND b.BusinessMonth = @MonthStart
            WHERE m.UserId = @UserId
              AND ISNULL(m.IsActive, 'Yes') <> 'No'
              AND ISNULL(d.IsActive, 'Yes') <> 'No'
        `;
    },

    // ---------------------------------------------------------
    // Pre-call plans
    // ---------------------------------------------------------

    GET_PLANS: () => {
        return `
            SELECT
                pc.PreCallId,
                pc.DoctorId,
                pc.CallOrder,
                pc.Objective,
                pc.KeyMessages,
                pc.Status,
                pc.VisitId,
                (SELECT STRING_AGG(CONVERT(VARCHAR(36), pp.ProductId), ',')
                 FROM dbo.PreCallPlanProducts pp WHERE pp.PreCallId = pc.PreCallId) AS ProductIds,
                (SELECT STRING_AGG(p.ProductName, ', ')
                 FROM dbo.PreCallPlanProducts pp
                 INNER JOIN dbo.Products p ON p.ProductId = pp.ProductId
                 WHERE pp.PreCallId = pc.PreCallId) AS ProductNames
            FROM dbo.PreCallPlans pc
            WHERE pc.UserId = @UserId AND pc.PlanDate = @PlanDate
            ORDER BY pc.CallOrder
        `;
    },

    GET_PLAN_BY_ID: () => {
        return `SELECT PreCallId, UserId, PlanDate, Status FROM dbo.PreCallPlans WHERE PreCallId = @PreCallId`;
    },

    FIND_PLAN: () => {
        return `
            SELECT PreCallId, Status FROM dbo.PreCallPlans
            WHERE UserId = @UserId AND PlanDate = @PlanDate AND DoctorId = @DoctorId
        `;
    },

    NEXT_ORDER: () => {
        return `
            SELECT ISNULL(MAX(CallOrder), 0) + 1 AS NextOrder
            FROM dbo.PreCallPlans WHERE UserId = @UserId AND PlanDate = @PlanDate
        `;
    },

    IS_DOCTOR_MAPPED: () => {
        return `
            SELECT 1 AS Found FROM dbo.UserDoctorMapping
            WHERE UserId = @UserId AND DoctorId = @DoctorId AND ISNULL(IsActive, 'Yes') <> 'No'
        `;
    },

    GET_ACTIVE_PRODUCT_IDS: () => {
        return `SELECT ProductId FROM dbo.Products WHERE IsActive = 1`;
    },

    INSERT_PLAN: () => {
        return `
            INSERT INTO dbo.PreCallPlans (PreCallId, UserId, PlanDate, DoctorId, CallOrder, Objective, KeyMessages, Status, CreatedOn)
            VALUES (@PreCallId, @UserId, @PlanDate, @DoctorId, @CallOrder, @Objective, @KeyMessages, 'PLANNED', @Now)
        `;
    },

    // Visited plans are kept as they were.
    UPDATE_PLAN: () => {
        return `
            UPDATE dbo.PreCallPlans
            SET Objective = @Objective, KeyMessages = @KeyMessages, ModifiedOn = @Now
            WHERE PreCallId = @PreCallId AND Status = 'PLANNED';

            IF @@ROWCOUNT = 0
                THROW 50041, 'This call has already been visited, so its plan can no longer change.', 1;
        `;
    },

    CLEAR_PRODUCTS: () => {
        return `DELETE FROM dbo.PreCallPlanProducts WHERE PreCallId = @PreCallId`;
    },

    ADD_PRODUCT: () => {
        return `INSERT INTO dbo.PreCallPlanProducts (PreCallId, ProductId) VALUES (@PreCallId, @ProductId)`;
    },

    DELETE_PLAN: () => {
        return `
            DELETE FROM dbo.PreCallPlans WHERE PreCallId = @PreCallId AND Status = 'PLANNED';

            IF @@ROWCOUNT = 0
                THROW 50041, 'This call has already been visited, so it stays in the plan.', 1;
        `;
    },

    SET_ORDER: () => {
        return `
            UPDATE dbo.PreCallPlans SET CallOrder = @CallOrder, ModifiedOn = @Now
            WHERE PreCallId = @PreCallId AND UserId = @UserId AND PlanDate = @PlanDate
        `;
    },
};
