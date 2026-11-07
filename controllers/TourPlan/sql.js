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

    // withJoint: the JointWithUserId column exists. A joint work day shows the team member's
    // planned area for that date (live, so it follows their plan), and the joint day's status.
    GET_TOUR_PLAN_DETAILS: (withJoint = false) => {
        if (!withJoint) {
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
        }
        return `
            SELECT
                d.TourPlanId,
                CONVERT(VARCHAR(10), d.PlanDate, 23) AS PlanDate,
                REPLACE(d.DayType, '_', '-') AS DayType,
                COALESCE(mp.TerritoryId, d.TerritoryId) AS TerritoryId,
                t.TerritoryName,
                COALESCE(mp.AreaId, d.AreaId) AS AreaId,
                a.AreaName,
                d.Remarks,
                d.JointWithUserId,
                COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(jw.FirstName, ' ', jw.LastName))), ''), jw.UserName) AS JointWithName,
                (SELECT TOP 1 j.Status FROM dbo.JointWorkDays j
                   WHERE j.UserId = d.JointWithUserId AND j.ColleagueUserId = tp.UserId AND j.WorkDate = d.PlanDate) AS JointStatus
            FROM dbo.TourPlanDetails d
            INNER JOIN dbo.TourPlan tp ON tp.TourPlanId = d.TourPlanId
            LEFT JOIN Users jw ON jw.UserId = d.JointWithUserId
            OUTER APPLY (
                SELECT TOP 1 md.TerritoryId, md.AreaId
                FROM dbo.TourPlan mt
                INNER JOIN dbo.TourPlanDetails md ON md.TourPlanId = mt.TourPlanId
                WHERE d.JointWithUserId IS NOT NULL AND mt.UserId = d.JointWithUserId AND md.PlanDate = d.PlanDate AND md.DayType = 'working'
            ) mp
            LEFT JOIN Territory t ON t.TerritoryId = COALESCE(mp.TerritoryId, d.TerritoryId)
            LEFT JOIN Areas a ON a.AreaId = COALESCE(mp.AreaId, d.AreaId)
            WHERE d.TourPlanId = @TourPlanId
            ORDER BY d.PlanDate
        `;
    },

    HAS_JOINT_COLUMN: () => `SELECT COL_LENGTH('dbo.TourPlanDetails', 'JointWithUserId') AS Size`,

    // 1 when @UserId reports to @ManagerId at any level.
    IS_IN_TEAM: () => `
        WITH Up AS (
            SELECT u.ManagerId, 0 AS Depth FROM Users u WHERE u.UserId = @UserId
            UNION ALL
            SELECT m.ManagerId, up.Depth + 1 FROM Users m INNER JOIN Up up ON m.UserId = up.ManagerId WHERE up.Depth < 15
        )
        SELECT CASE WHEN EXISTS (SELECT 1 FROM Up WHERE ManagerId = @ManagerId) THEN 1 ELSE 0 END AS InTeam`,

    // A person's planned days in a month (for joint work checks).
    MEMBER_DAYS: () => `
        SELECT CONVERT(VARCHAR(10), d.PlanDate, 23) AS PlanDate, REPLACE(d.DayType, '_', '-') AS DayType, d.TerritoryId, d.AreaId
        FROM dbo.TourPlan tp
        INNER JOIN dbo.TourPlanDetails d ON d.TourPlanId = tp.TourPlanId
        WHERE tp.UserId = @UserId AND tp.PlanMonth = @PlanMonth`,

    // Pending or approved leave of a person touching a date range.
    MEMBER_LEAVE: () => `
        SELECT CONVERT(VARCHAR(10), FromDate, 23) AS FromDate, CONVERT(VARCHAR(10), ToDate, 23) AS ToDate, Status
        FROM dbo.LeaveRequests
        WHERE UserId = @UserId AND Status IN ('PENDING', 'APPROVED') AND FromDate <= @To AND ToDate >= @From`,

    // Joint work days a senior planned with this person (locked in this person's plan).
    LOCKS: () => `
        SELECT CONVERT(VARCHAR(10), j.WorkDate, 23) AS PlanDate, j.ColleagueUserId,
               COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(c.FirstName, ' ', c.LastName))), ''), c.UserName) AS ColleagueName
        FROM dbo.JointWorkDays j
        INNER JOIN Users c ON c.UserId = j.ColleagueUserId
        WHERE j.UserId = @UserId AND j.RequestedBy = j.ColleagueUserId AND j.Status = 'CONFIRMED'
          AND j.WorkDate BETWEEN @From AND @To`,

    // A senior's plan day with a team member: confirmed straight away (no acceptance in the hierarchy).
    PLAN_JOINT_DAY: () => `
        UPDATE dbo.JointWorkDays SET Status = 'CONFIRMED', RequestedBy = @ColleagueUserId, ResponseNote = NULL, RespondedOn = @Now
        WHERE UserId = @UserId AND ColleagueUserId = @ColleagueUserId AND WorkDate = @WorkDate;
        IF @@ROWCOUNT = 0
            INSERT INTO dbo.JointWorkDays (JointWorkId, UserId, ColleagueUserId, WorkDate, Status, RequestedBy, RespondedOn, CreatedOn)
            VALUES (@JointWorkId, @UserId, @ColleagueUserId, @WorkDate, 'CONFIRMED', @ColleagueUserId, @Now, @Now);`,

    // Plan joint days of a senior that are no longer in their plan (kept when visits were already made together).
    REMOVE_PLAN_JOINT_DAYS: () => `
        DELETE j FROM dbo.JointWorkDays j
        WHERE j.ColleagueUserId = @ColleagueUserId AND j.RequestedBy = @ColleagueUserId AND j.WorkDate BETWEEN @From AND @To
          AND NOT EXISTS (SELECT 1 FROM OPENJSON(@Keep) WITH (UserId UNIQUEIDENTIFIER '$.u', WorkDate DATE '$.d') k
                          WHERE k.UserId = j.UserId AND k.WorkDate = j.WorkDate)
          AND NOT EXISTS (SELECT 1 FROM dbo.Visits v INNER JOIN dbo.VisitJointWorkers w ON w.VisitId = v.VisitId AND w.UserId = j.ColleagueUserId
                          WHERE v.UserId = j.UserId AND v.VisitDate = j.WorkDate);`,

    // A senior moves a team member's planned day to another area (for joint work).
    CHANGE_MEMBER_DAY: () => `
        UPDATE d SET TerritoryId = @TerritoryId, AreaId = @AreaId, Remarks = @Remarks, ModifiedOn = @Now
        FROM dbo.TourPlanDetails d
        INNER JOIN dbo.TourPlan tp ON tp.TourPlanId = d.TourPlanId
        WHERE tp.UserId = @UserId AND d.PlanDate = @PlanDate AND d.DayType = 'working';
        IF @@ROWCOUNT = 0 THROW 50409, 'That day is not a planned working day of this team member.', 1;`,

    APPROVE_DEVIATION: () => `
        UPDATE dbo.TourPlanDeviation SET Status = 'APPROVED', ReviewedBy = @ReviewedBy, ReviewedOn = @Now, ReviewRemarks = @Remarks WHERE DeviationId = @DeviationId;`,

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

    // Owner changes a submitted or approved plan when the company wants manager approval:
    // it goes back to the manager as a fresh submission.
    RESUBMIT_OWN_PLAN: () => {
        return `
            UPDATE dbo.TourPlan
            SET StatusId = @StatusId, ModifiedOn = @Now, SubmittedOn = @Now,
                ReviewedBy = NULL, ReviewedOn = NULL, ReviewRemarks = NULL
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

    // withJoint: the JointWithUserId column exists.
    CREATE_TOUR_PLAN_DETAILS: (withJoint = false) => {
        return `
            INSERT INTO dbo.TourPlanDetails (
                TourPlanId,
                PlanDate,
                DayType,
                TerritoryId,
                AreaId,
                Remarks,
                ${withJoint ? 'JointWithUserId,' : ''}
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
                ${withJoint ? '@JointWithUserId,' : ''}
                @CreatedOn,
                @ModifiedOn
            )
        `;
    },
};
