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

    GET_TOUR_PLAN_BY_USER_MONTH: () => {
        return `
            SELECT
                tp.TourPlanId,
                tp.UserId,
                tp.PlanMonth,
                tp.StatusId,
                u.ManagerId
            FROM dbo.TourPlan tp
            INNER JOIN Users u ON u.UserId = tp.UserId
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
                d.DayType,
                d.TerritoryId,
                t.TerritoryName,
                d.AreaId,
                a.AreaName
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
                ModifiedOn = @ModifiedOn
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
                ModifiedOn = @ModifiedOn
            WHERE TourPlanId = @TourPlanId
              AND StatusId = @FromStatusId;

            IF @@ROWCOUNT = 0
                THROW 50003, 'Tour plan is not in the expected status.', 1;
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
                CreatedOn,
                ModifiedOn
            )
            VALUES (
                @TourPlanId,
                @UserId,
                @PlanMonth,
                @StatusId,
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
                CreatedOn,
                ModifiedOn
            )
            VALUES (
                @TourPlanId,
                @PlanDate,
                @DayType,
                @TerritoryId,
                @AreaId,
                @CreatedOn,
                @ModifiedOn
            )
        `;
    },
};
