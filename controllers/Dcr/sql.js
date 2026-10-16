const displayName = (alias) =>
    `COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(${alias}.FirstName, ' ', ${alias}.LastName))), ''), ${alias}.UserName)`;

const DCR_SELECT = `
    SELECT
        r.DcrId,
        r.UserId,
        ${displayName('u')} AS UserName,
        sld.SystemLovDetailName AS DesignationName,
        CONVERT(VARCHAR(10), r.ReportDate, 23) AS ReportDate,
        r.Status,
        CONVERT(VARCHAR(5), r.WorkStartTime, 108) AS WorkStartTime,
        CONVERT(VARCHAR(5), r.WorkEndTime, 108) AS WorkEndTime,
        r.TravelMode,
        r.DistanceKm,
        r.Remarks,
        r.VisitCount,
        r.SubmittedOn,
        r.ReviewedBy,
        ${displayName('rv')} AS ReviewedByName,
        r.ReviewedOn,
        r.ReviewRemarks,
        u.ManagerId
    FROM dbo.DailyCallReports r
    INNER JOIN Users u ON u.UserId = r.UserId
    LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = u.DesignationId
    LEFT JOIN Users rv ON rv.UserId = r.ReviewedBy
`;

module.exports = {
    GET_USER: () => {
        return `
            SELECT UserId, ManagerId
            FROM Users
            WHERE UserId = @UserId
        `;
    },

    GET_DCRS_IN_RANGE: () => {
        return `
            ${DCR_SELECT}
            WHERE r.UserId = @UserId
              AND r.ReportDate BETWEEN @FromDate AND @ToDate
        `;
    },

    GET_DCR_FOR_DATE: () => {
        return `
            ${DCR_SELECT}
            WHERE r.UserId = @UserId
              AND r.ReportDate = @ReportDate
        `;
    },

    GET_DCR_BY_ID: () => {
        return `
            ${DCR_SELECT}
            WHERE r.DcrId = @DcrId
        `;
    },

    // DCRs from direct reports waiting for this manager.
    GET_PENDING_REVIEWS: () => {
        return `
            ${DCR_SELECT}
            WHERE u.ManagerId = @ManagerId
              AND r.Status = 'SUBMITTED'
            ORDER BY r.ReportDate, r.SubmittedOn
        `;
    },

    GET_VISIT_DAYS: () => {
        return `
            SELECT
                CONVERT(VARCHAR(10), VisitDate, 23) AS VisitDate,
                COUNT(*) AS VisitCount
            FROM dbo.Visits
            WHERE UserId = @UserId
              AND VisitDate BETWEEN @FromDate AND @ToDate
            GROUP BY VisitDate
        `;
    },

    GET_PLAN_DAYS: () => {
        return `
            SELECT
                CONVERT(VARCHAR(10), d.PlanDate, 23) AS PlanDate,
                d.DayType,
                t.TerritoryName,
                a.AreaName
            FROM dbo.TourPlan tp
            INNER JOIN dbo.TourPlanDetails d ON d.TourPlanId = tp.TourPlanId
            LEFT JOIN Territory t ON t.TerritoryId = d.TerritoryId
            LEFT JOIN Areas a ON a.AreaId = d.AreaId
            WHERE tp.UserId = @UserId
              AND d.PlanDate BETWEEN @FromDate AND @ToDate
        `;
    },

    CREATE_DCR: () => {
        return `
            INSERT INTO dbo.DailyCallReports (
                DcrId,
                UserId,
                ReportDate,
                Status,
                WorkStartTime,
                WorkEndTime,
                TravelMode,
                DistanceKm,
                Remarks,
                VisitCount,
                SubmittedOn,
                CreatedOn,
                ModifiedOn
            )
            VALUES (
                @DcrId,
                @UserId,
                @ReportDate,
                'SUBMITTED',
                @WorkStartTime,
                @WorkEndTime,
                @TravelMode,
                @DistanceKm,
                @Remarks,
                @VisitCount,
                @SubmittedOn,
                @SubmittedOn,
                NULL
            )
        `;
    },

    // Only a returned DCR can be sent again; the previous review is cleared.
    RESUBMIT_DCR: () => {
        return `
            UPDATE dbo.DailyCallReports
            SET Status = 'SUBMITTED',
                WorkStartTime = @WorkStartTime,
                WorkEndTime = @WorkEndTime,
                TravelMode = @TravelMode,
                DistanceKm = @DistanceKm,
                Remarks = @Remarks,
                VisitCount = @VisitCount,
                SubmittedOn = @SubmittedOn,
                ReviewedBy = NULL,
                ReviewedOn = NULL,
                ReviewRemarks = NULL,
                ModifiedOn = @SubmittedOn
            WHERE DcrId = @DcrId
              AND Status = 'RETURNED';

            IF @@ROWCOUNT = 0
                THROW 50021, 'This DCR can no longer be resubmitted.', 1;
        `;
    },

    REVIEW_DCR: () => {
        return `
            UPDATE dbo.DailyCallReports
            SET Status = @Status,
                ReviewedBy = @ReviewedBy,
                ReviewedOn = @ReviewedOn,
                ReviewRemarks = @ReviewRemarks,
                ModifiedOn = @ReviewedOn
            WHERE DcrId = @DcrId
              AND Status = 'SUBMITTED';

            IF @@ROWCOUNT = 0
                THROW 50022, 'This DCR has already been reviewed.', 1;
        `;
    },
};
