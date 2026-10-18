module.exports = {
    GET_STATUS_LOVS: () => {
        return `
            SELECT
                SystemLovDetailId,
                SystemLovDetailCode,
                SystemLovDetailName
            FROM SystemLovDetails
            WHERE UPPER(SystemLovDetailCode) IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED')
               OR UPPER(SystemLovDetailName) IN ('DRAFT', 'SUBMITTED', 'SUBMITTED FOR APPROVAL', 'APPROVED', 'REJECTED')
        `;
    },

    GET_USER: () => {
        return `
            SELECT UserId, ManagerId
            FROM Users
            WHERE UserId = @UserId
        `;
    },

    // Who owns a plan and who approves it.
    GET_OWNER: () => {
        return `
            SELECT
                u.UserId,
                COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.FirstName, ' ', u.LastName))), ''), u.UserName) AS Name,
                sld.SystemLovDetailName AS DesignationName,
                u.ManagerId,
                COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(m.FirstName, ' ', m.LastName))), ''), m.UserName) AS ManagerName
            FROM Users u
            LEFT JOIN Users m ON m.UserId = u.ManagerId
            LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = u.DesignationId
            WHERE u.UserId = @UserId
        `;
    },

    // Every direct report with their plan (if any) for the month.
    GET_TEAM_PLANS: () => {
        return `
            SELECT
                u.UserId,
                COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.FirstName, ' ', u.LastName))), ''), u.UserName) AS Name,
                sld.SystemLovDetailName AS DesignationName,
                tp.TourPlanId,
                tp.StatusId,
                tp.SubmittedOn,
                tp.ReviewedOn,
                (SELECT COUNT(*) FROM dbo.TourPlanDetails d WHERE d.TourPlanId = tp.TourPlanId) AS DaysPlanned,
                (SELECT COUNT(*) FROM dbo.TourPlanDetails d
                 WHERE d.TourPlanId = tp.TourPlanId AND d.DayType = 'working') AS WorkingDays
            FROM Users u
            LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = u.DesignationId
            LEFT JOIN dbo.TourPlan tp ON tp.UserId = u.UserId AND tp.PlanMonth = @PlanMonth
            WHERE u.ManagerId = @ManagerId
            ORDER BY Name
        `;
    },

    // A user's plans, newest month first.
    GET_PLAN_HISTORY: () => {
        return `
            SELECT TOP (12)
                tp.TourPlanId,
                CONVERT(VARCHAR(10), tp.PlanMonth, 23) AS PlanMonth,
                tp.StatusId,
                tp.SubmittedOn,
                tp.ReviewedOn,
                tp.ReviewRemarks,
                COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(rv.FirstName, ' ', rv.LastName))), ''), rv.UserName) AS ReviewedByName,
                (SELECT COUNT(*) FROM dbo.TourPlanDetails d WHERE d.TourPlanId = tp.TourPlanId) AS DaysPlanned
            FROM dbo.TourPlan tp
            LEFT JOIN Users rv ON rv.UserId = tp.ReviewedBy
            WHERE tp.UserId = @UserId
            ORDER BY tp.PlanMonth DESC
        `;
    },

    GET_TOUR_PLAN_BY_USER_MONTH: () => {
        return `
            SELECT
                tp.TourPlanId,
                tp.UserId,
                tp.PlanMonth,
                tp.StatusId,
                u.ManagerId,
                tp.CreatedOn,
                tp.ModifiedOn,
                tp.SubmittedOn,
                tp.ReviewedOn,
                tp.ReviewRemarks,
                COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(rv.FirstName, ' ', rv.LastName))), ''), rv.UserName) AS ReviewedByName
            FROM dbo.TourPlan tp
            INNER JOIN Users u ON u.UserId = tp.UserId
            LEFT JOIN Users rv ON rv.UserId = tp.ReviewedBy
            WHERE tp.UserId = @UserId
              AND tp.PlanMonth = @PlanMonth
        `;
    },

    GET_TOUR_PLAN_BY_ID: () => {
        return `
            SELECT
                tp.TourPlanId,
                tp.UserId,
                tp.PlanMonth,
                tp.StatusId,
                u.ManagerId
            FROM dbo.TourPlan tp
            INNER JOIN Users u ON u.UserId = tp.UserId
            WHERE tp.TourPlanId = @TourPlanId
        `;
    },

    GET_TOUR_PLAN_DETAILS: () => {
        return `
            SELECT
                d.TourPlanId,
                CONVERT(VARCHAR(10), d.PlanDate, 23) AS PlanDate,
                REPLACE(d.DayType, '_', '-') AS DayType,
                d.TerritoryId,
                t.TerritoryName,
                d.AreaId,
                a.AreaName,
                d.Remarks
            FROM dbo.TourPlanDetails d
            LEFT JOIN Territory t ON t.TerritoryId = d.TerritoryId
            LEFT JOIN Areas a ON a.AreaId = d.AreaId
            WHERE d.TourPlanId = @TourPlanId
            ORDER BY d.PlanDate
        `;
    },

    GET_TERRITORY_IDS: () => {
        return `SELECT TerritoryId FROM Territory`;
    },

    GET_AREA_TERRITORIES: () => {
        return `SELECT AreaId, TerritoryId FROM Areas`;
    },

    // Serialises concurrent creates for the same user and month.
    ASSERT_NO_PLAN_FOR_MONTH: () => {
        return `
            IF EXISTS (
                SELECT 1 FROM dbo.TourPlan WITH (UPDLOCK, HOLDLOCK)
                WHERE UserId = @UserId AND PlanMonth = @PlanMonth
            )
                THROW 50001, 'A tour plan already exists for this month.', 1;
        `;
    },

    // Only drafts and rejected plans are editable.
    UPDATE_EDITABLE_TOUR_PLAN: () => {
        return `
            UPDATE dbo.TourPlan
            SET StatusId = @StatusId,
                ModifiedOn = @ModifiedOn,
                -- A (re)submission starts a fresh review cycle.
                SubmittedOn = CASE WHEN @SubmittedOn IS NULL THEN SubmittedOn ELSE @SubmittedOn END,
                ReviewedBy = CASE WHEN @SubmittedOn IS NULL THEN ReviewedBy ELSE NULL END,
                ReviewedOn = CASE WHEN @SubmittedOn IS NULL THEN ReviewedOn ELSE NULL END,
                ReviewRemarks = CASE WHEN @SubmittedOn IS NULL THEN ReviewRemarks ELSE NULL END
            WHERE TourPlanId = @TourPlanId
              AND StatusId IN (@DraftStatusId, @RejectedStatusId);

            IF @@ROWCOUNT = 0
                THROW 50002, 'Tour plan can no longer be edited.', 1;
        `;
    },

    TRANSITION_TOUR_PLAN_STATUS: () => {
        return `
            UPDATE dbo.TourPlan
            SET StatusId = @StatusId,
                ModifiedOn = @ModifiedOn,
                ReviewedBy = @ReviewedBy,
                ReviewedOn = @ModifiedOn,
                ReviewRemarks = @ReviewRemarks
            WHERE TourPlanId = @TourPlanId
              AND StatusId = @FromStatusId;

            IF @@ROWCOUNT = 0
                THROW 50003, 'Tour plan is not in the expected status.', 1;
        `;
    },

    // Owner saves a plan inside their territory: approved straight away (no manager approval).
    APPROVE_OWN_PLAN: () => {
        return `
            UPDATE dbo.TourPlan
            SET StatusId = @StatusId, ModifiedOn = @Now, SubmittedOn = ISNULL(SubmittedOn, @Now),
                ReviewedBy = NULL, ReviewedOn = @Now, ReviewRemarks = @Remarks
            WHERE TourPlanId = @TourPlanId;

            IF @@ROWCOUNT = 0
                THROW 50002, 'Tour plan not found.', 1;
        `;
    },

    DELETE_TOUR_PLAN_DETAILS: () => {
        return `
            DELETE FROM dbo.TourPlanDetails
            WHERE TourPlanId = @TourPlanId
        `;
    },

    CREATE_TOUR_PLAN: () => {
        return `
            INSERT INTO dbo.TourPlan (
                TourPlanId,
                UserId,
                PlanMonth,
                StatusId,
                SubmittedOn,
                CreatedOn,
                ModifiedOn
            )
            VALUES (
                @TourPlanId,
                @UserId,
                @PlanMonth,
                @StatusId,
                @SubmittedOn,
                @CreatedOn,
                @ModifiedOn
            )
        `;
    },

    CREATE_TOUR_PLAN_DETAILS: () => {
        return `
            INSERT INTO dbo.TourPlanDetails (
                TourPlanId,
                PlanDate,
                DayType,
                TerritoryId,
                AreaId,
                Remarks,
                CreatedOn,
                ModifiedOn
            )
            VALUES (
                @TourPlanId,
                @PlanDate,
                @DayType,
                @TerritoryId,
                @AreaId,
                @Remarks,
                @CreatedOn,
                @ModifiedOn
            )
        `;
    },
};
