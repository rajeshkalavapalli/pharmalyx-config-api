const DEVIATION_SELECT = `
    SELECT
        d.DeviationId,
        CONVERT(VARCHAR(10), d.DeviationDate, 23) AS DeviationDate,
        d.UserId,
        COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.FirstName, ' ', u.LastName))), ''), u.UserName) AS UserName,
        u.UserName AS UserCode,
        ud.SystemLovDetailName AS DesignationName,
        u.DivisionId,
        dv.DivisionName,
        u.ManagerId,
        COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(m.FirstName, ' ', m.LastName))), ''), m.UserName) AS ManagerName,
        md.SystemLovDetailName AS ManagerDesignationName,
        d.PlannedTerritoryId,
        pt.TerritoryName AS PlannedTerritoryName,
        d.PlannedAreaId,
        pa.AreaName AS PlannedAreaName,
        d.ActualTerritoryId,
        at.TerritoryName AS ActualTerritoryName,
        d.ActualAreaId,
        aa.AreaName AS ActualAreaName,
        d.DeviationType,
        d.Source,
        d.Reason,
        d.Remarks,
        d.Status,
        d.SubmittedOn,
        d.ReviewedBy,
        COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(rv.FirstName, ' ', rv.LastName))), ''), rv.UserName) AS ReviewedByName,
        d.ReviewedOn,
        d.ReviewRemarks
    FROM dbo.TourPlanDeviation d
    INNER JOIN Users u ON u.UserId = d.UserId
    LEFT JOIN SystemLovDetails ud ON ud.SystemLovDetailId = u.DesignationId
    LEFT JOIN Division dv ON dv.DivisionId = u.DivisionId
    LEFT JOIN Users m ON m.UserId = u.ManagerId
    LEFT JOIN SystemLovDetails md ON md.SystemLovDetailId = m.DesignationId
    LEFT JOIN Users rv ON rv.UserId = d.ReviewedBy
    LEFT JOIN Territory pt ON pt.TerritoryId = d.PlannedTerritoryId
    LEFT JOIN Areas pa ON pa.AreaId = d.PlannedAreaId
    LEFT JOIN Territory at ON at.TerritoryId = d.ActualTerritoryId
    LEFT JOIN Areas aa ON aa.AreaId = d.ActualAreaId
`;

module.exports = {
    // Rows visible to the acting user: their own and their direct reports'.
    GET_DEVIATIONS: () => {
        return `
            ${DEVIATION_SELECT}
            WHERE (d.UserId = @ActingUserId OR u.ManagerId = @ActingUserId)
              AND (@MonthStart IS NULL
                   OR (d.DeviationDate >= CAST(@MonthStart AS DATE)
                       AND d.DeviationDate < DATEADD(MONTH, 1, CAST(@MonthStart AS DATE))))
              AND (@UserId IS NULL OR d.UserId = @UserId)
              AND (@DivisionId IS NULL OR u.DivisionId = @DivisionId)
              AND (@TerritoryId IS NULL
                   OR d.PlannedTerritoryId = @TerritoryId
                   OR d.ActualTerritoryId = @TerritoryId)
              AND (@DeviationType IS NULL OR d.DeviationType = @DeviationType)
            ORDER BY d.DeviationDate DESC, d.SubmittedOn DESC
        `;
    },

    GET_DEVIATION_BY_ID: () => {
        return `
            ${DEVIATION_SELECT}
            WHERE d.DeviationId = @DeviationId
        `;
    },

    GET_USER: () => {
        return `
            SELECT UserId, ManagerId
            FROM Users
            WHERE UserId = @UserId
        `;
    },

    // The approved/submitted plan entry for that day, used as the "planned" side.
    GET_PLANNED_FOR_DATE: () => {
        return `
            SELECT TOP (1)
                d.TerritoryId,
                d.AreaId
            FROM dbo.TourPlan tp
            INNER JOIN dbo.TourPlanDetails d ON d.TourPlanId = tp.TourPlanId
            WHERE tp.UserId = @UserId
              AND tp.PlanMonth = @PlanMonth
              AND d.PlanDate = @PlanDate
              AND d.DayType = 'working'
        `;
    },

    GET_TERRITORY_IDS: () => {
        return `SELECT TerritoryId FROM Territory`;
    },

    GET_AREA_TERRITORIES: () => {
        return `SELECT AreaId, TerritoryId FROM Areas`;
    },

    CREATE_DEVIATION: () => {
        return `
            INSERT INTO dbo.TourPlanDeviation (
                DeviationId,
                UserId,
                DeviationDate,
                PlannedTerritoryId,
                PlannedAreaId,
                ActualTerritoryId,
                ActualAreaId,
                DeviationType,
                Source,
                Reason,
                Remarks,
                Status,
                SubmittedOn,
                CreatedOn,
                ModifiedOn
            )
            VALUES (
                @DeviationId,
                @UserId,
                @DeviationDate,
                @PlannedTerritoryId,
                @PlannedAreaId,
                @ActualTerritoryId,
                @ActualAreaId,
                @DeviationType,
                @Source,
                @Reason,
                @Remarks,
                'PENDING',
                @SubmittedOn,
                @SubmittedOn,
                NULL
            )
        `;
    },

    REVIEW_DEVIATION: () => {
        return `
            UPDATE dbo.TourPlanDeviation
            SET Status = @Status,
                ReviewedBy = @ReviewedBy,
                ReviewedOn = @ReviewedOn,
                ReviewRemarks = @ReviewRemarks,
                ModifiedOn = @ReviewedOn
            WHERE DeviationId = @DeviationId
              AND Status = 'PENDING';

            IF @@ROWCOUNT = 0
                THROW 50011, 'Deviation has already been reviewed.', 1;
        `;
    },
};
