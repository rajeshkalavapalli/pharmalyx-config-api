const { displayName } = require('../../utils/reportScope');

// One joint-work row with both people's names, and how many of the field person's visits that day
// had the colleague on them.
const ROW = `
    SELECT j.JointWorkId, j.UserId, ${displayName('u')} AS UserName, du.SystemLovDetailName AS UserDesignation,
           j.ColleagueUserId, ${displayName('c')} AS ColleagueName, dc.SystemLovDetailName AS ColleagueDesignation,
           CONVERT(VARCHAR(10), j.WorkDate, 23) AS WorkDate, j.Status, j.RequestedBy, j.ResponseNote, j.RespondedOn,
           j.Rating, j.CoachingNotes, j.FeedbackOn, j.CreatedOn,
           (SELECT COUNT(*) FROM dbo.Visits v
              INNER JOIN dbo.VisitJointWorkers w ON w.VisitId = v.VisitId AND w.UserId = j.ColleagueUserId
              WHERE v.UserId = j.UserId AND v.VisitDate = j.WorkDate) AS JointCalls
    FROM dbo.JointWorkDays j
    INNER JOIN Users u ON u.UserId = j.UserId
    INNER JOIN Users c ON c.UserId = j.ColleagueUserId
    LEFT JOIN SystemLovDetails du ON du.SystemLovDetailId = u.DesignationId
    LEFT JOIN SystemLovDetails dc ON dc.SystemLovDetailId = c.DesignationId`;

module.exports = {
    // Rows where I am the field person or the colleague, between two dates.
    MINE: () => `${ROW}
        WHERE (j.UserId = @UserId OR j.ColleagueUserId = @UserId) AND j.WorkDate BETWEEN @From AND @To
        ORDER BY j.WorkDate, ColleagueName`,

    BY_ID: () => `${ROW} WHERE j.JointWorkId = @JointWorkId`,

    PENDING_FOR: () => `SELECT COUNT(*) AS n FROM dbo.JointWorkDays WHERE ColleagueUserId = @UserId AND Status = 'PENDING' AND WorkDate >= @Today`,

    // Colleagues joining the field person on a date (declined ones are left out).
    DAY_COLLEAGUES: () => `
        SELECT ColleagueUserId FROM dbo.JointWorkDays
        WHERE UserId = @UserId AND WorkDate = @WorkDate AND Status <> 'DECLINED'`,

    // Ask a colleague (again, if they had declined); an existing request or confirmation is kept.
    REQUEST: () => `
        UPDATE dbo.JointWorkDays SET Status = 'PENDING', RequestedBy = @RequestedBy, ResponseNote = NULL, RespondedOn = NULL
        WHERE UserId = @UserId AND ColleagueUserId = @ColleagueUserId AND WorkDate = @WorkDate AND Status = 'DECLINED';
        IF NOT EXISTS (SELECT 1 FROM dbo.JointWorkDays WHERE UserId = @UserId AND ColleagueUserId = @ColleagueUserId AND WorkDate = @WorkDate)
            INSERT INTO dbo.JointWorkDays (JointWorkId, UserId, ColleagueUserId, WorkDate, Status, RequestedBy, CreatedOn)
            VALUES (@JointWorkId, @UserId, @ColleagueUserId, @WorkDate, 'PENDING', @RequestedBy, @Now);`,

    RESPOND: () => `
        UPDATE dbo.JointWorkDays SET Status = @Status, ResponseNote = @Note, RespondedOn = @Now
        WHERE JointWorkId = @JointWorkId AND ColleagueUserId = @ColleagueUserId;
        IF @@ROWCOUNT = 0 THROW 50404, 'Joint work request not found.', 1;`,

    FEEDBACK: () => `
        UPDATE dbo.JointWorkDays SET Rating = @Rating, CoachingNotes = @Notes, FeedbackOn = @Now
        WHERE JointWorkId = @JointWorkId AND ColleagueUserId = @ColleagueUserId AND Status = 'CONFIRMED';
        IF @@ROWCOUNT = 0 THROW 50409, 'Feedback can be given only on a confirmed joint work day.', 1;`,

    CANCEL: () => `
        DELETE j FROM dbo.JointWorkDays j
        WHERE j.JointWorkId = @JointWorkId AND j.UserId = @UserId
          AND NOT EXISTS (SELECT 1 FROM dbo.Visits v INNER JOIN dbo.VisitJointWorkers w ON w.VisitId = v.VisitId AND w.UserId = j.ColleagueUserId
                          WHERE v.UserId = j.UserId AND v.VisitDate = j.WorkDate);
        IF @@ROWCOUNT = 0 THROW 50409, 'This joint work day already has visits, or it is not yours to cancel.', 1;`,

    // Confirmed joint work days of a person (either side) in a date range: leave touching them.
    LEAVE_CLASHES: () => `${ROW}
        WHERE (j.UserId = @UserId OR j.ColleagueUserId = @UserId) AND j.Status = 'CONFIRMED' AND j.WorkDate BETWEEN @From AND @To
        ORDER BY j.WorkDate`,

    CANCEL_FOR_LEAVE: () => `
        UPDATE dbo.JointWorkDays SET Status = 'DECLINED', ResponseNote = @Note, RespondedOn = @Now
        WHERE (UserId = @UserId OR ColleagueUserId = @UserId) AND Status <> 'DECLINED' AND WorkDate BETWEEN @From AND @To;`,

    // For the alerts: plan days of mine (as the senior) cancelled by leave, and days seniors planned with me soon.
    REPLAN_FOR: () => `${ROW}
        WHERE j.ColleagueUserId = @UserId AND j.RequestedBy = j.ColleagueUserId AND j.Status = 'DECLINED' AND j.WorkDate >= @Today
        ORDER BY j.WorkDate`,
    UPCOMING_FOR: () => `${ROW}
        WHERE j.UserId = @UserId AND j.RequestedBy = j.ColleagueUserId AND j.Status = 'CONFIRMED' AND j.WorkDate BETWEEN @Today AND @Until
        ORDER BY j.WorkDate`,

    // Today's joint work of a person, either side, with the field person's planned area.
    TODAY: () => `
        SELECT j.JointWorkId, j.UserId, ${displayName('u')} AS UserName, j.ColleagueUserId, ${displayName('c')} AS ColleagueName, j.Status,
               t.TerritoryName, a.AreaName
        FROM dbo.JointWorkDays j
        INNER JOIN Users u ON u.UserId = j.UserId
        INNER JOIN Users c ON c.UserId = j.ColleagueUserId
        OUTER APPLY (
            SELECT TOP 1 d.TerritoryId, d.AreaId FROM dbo.TourPlan tp
            INNER JOIN dbo.TourPlanDetails d ON d.TourPlanId = tp.TourPlanId
            WHERE tp.UserId = j.UserId AND d.PlanDate = j.WorkDate AND d.DayType = 'working'
        ) p
        LEFT JOIN Territory t ON t.TerritoryId = p.TerritoryId
        LEFT JOIN Areas a ON a.AreaId = p.AreaId
        WHERE (j.UserId = @UserId OR j.ColleagueUserId = @UserId) AND j.WorkDate = @Today AND j.Status <> 'DECLINED'`,

    ADD_VISIT_WORKER: () => `
        IF NOT EXISTS (SELECT 1 FROM dbo.VisitJointWorkers WHERE VisitId = @VisitId AND UserId = @UserId)
            INSERT INTO dbo.VisitJointWorkers (VisitId, UserId) VALUES (@VisitId, @UserId);`,
};
