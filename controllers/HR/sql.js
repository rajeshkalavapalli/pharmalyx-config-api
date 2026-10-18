const { SCOPE_CTE, displayName } = require('../../utils/reportScope');

const IN_SCOPE = (column) => `(@UserId IS NULL OR ${column} = @UserId)`;
const TIME = (column) => `CONVERT(VARCHAR(5), ${column}, 108)`;

module.exports = {
    GET_USER: () => {
        return `
            SELECT u.UserId, ${displayName('u')} AS Name, u.ManagerId, ${displayName('m')} AS ManagerName
            FROM Users u
            LEFT JOIN Users m ON m.UserId = u.ManagerId
            WHERE u.UserId = @UserId
        `;
    },

    // ---------------------------------------------------------
    // Attendance
    // ---------------------------------------------------------

    GET_DAY_LOG: () => {
        return `
            SELECT AttendanceId, CheckInAt, CheckInLocation, CheckOutAt, CheckOutLocation, Remarks
            FROM dbo.AttendanceLogs
            WHERE UserId = @UserId AND AttendanceDate = @Day
        `;
    },

    CHECK_IN: () => {
        return `
            INSERT INTO dbo.AttendanceLogs (AttendanceId, UserId, AttendanceDate, CheckInAt, CheckInLatitude, CheckInLongitude, CheckInAccuracy, CheckInLocation, Remarks, CreatedOn)
            VALUES (@AttendanceId, @UserId, @Day, @Now, @Latitude, @Longitude, @Accuracy, @LocationStatus, @Remarks, @Now)
        `;
    },

    CHECK_OUT: () => {
        return `
            UPDATE dbo.AttendanceLogs
            SET CheckOutAt = @Now, CheckOutLatitude = @Latitude, CheckOutLongitude = @Longitude,
                CheckOutAccuracy = @Accuracy, CheckOutLocation = @LocationStatus,
                Remarks = COALESCE(@Remarks, Remarks)
            WHERE UserId = @UserId AND AttendanceDate = @Day AND CheckOutAt IS NULL
        `;
    },

    ATT_LOGS: () => {
        return `
            ${SCOPE_CTE}
            SELECT a.UserId, CONVERT(VARCHAR(10), a.AttendanceDate, 23) AS Day,
                   ${TIME('a.CheckInAt')} AS CheckIn, ${TIME('a.CheckOutAt')} AS CheckOut,
                   a.CheckInLocation, a.CheckOutLocation,
                   DATEDIFF(MINUTE, a.CheckInAt, a.CheckOutAt) AS Minutes
            FROM Scope s
            INNER JOIN dbo.AttendanceLogs a ON a.UserId = s.UserId
            WHERE a.AttendanceDate BETWEEN @FromDate AND @ToDate AND ${IN_SCOPE('a.UserId')}
        `;
    },

    ATT_VISIT_DAYS: () => {
        return `
            ${SCOPE_CTE}
            SELECT v.UserId, CONVERT(VARCHAR(10), v.VisitDate, 23) AS Day, COUNT(*) AS Visits
            FROM Scope s
            INNER JOIN dbo.Visits v ON v.UserId = s.UserId
            WHERE v.VisitDate BETWEEN @FromDate AND @ToDate AND ${IN_SCOPE('v.UserId')}
            GROUP BY v.UserId, v.VisitDate
        `;
    },

    ATT_DCR_DAYS: () => {
        return `
            ${SCOPE_CTE}
            SELECT r.UserId, CONVERT(VARCHAR(10), r.ReportDate, 23) AS Day
            FROM Scope s
            INNER JOIN dbo.DailyCallReports r ON r.UserId = s.UserId
            WHERE r.ReportDate BETWEEN @FromDate AND @ToDate AND ${IN_SCOPE('r.UserId')}
        `;
    },

    ATT_LEAVES: () => {
        return `
            ${SCOPE_CTE}
            SELECT l.UserId, CONVERT(VARCHAR(10), l.FromDate, 23) AS FromDate, CONVERT(VARCHAR(10), l.ToDate, 23) AS ToDate,
                   l.HalfDay, t.Code AS LeaveCode, t.Name AS LeaveName
            FROM Scope s
            INNER JOIN dbo.LeaveRequests l ON l.UserId = s.UserId
            INNER JOIN dbo.LeaveTypes t ON t.LeaveTypeId = l.LeaveTypeId
            WHERE l.Status = 'APPROVED' AND l.FromDate <= @ToDate AND l.ToDate >= @FromDate AND ${IN_SCOPE('l.UserId')}
        `;
    },

    ATT_OFF_DAYS: () => {
        return `
            ${SCOPE_CTE}
            SELECT tp.UserId, CONVERT(VARCHAR(10), d.PlanDate, 23) AS Day
            FROM Scope s
            INNER JOIN dbo.TourPlan tp ON tp.UserId = s.UserId
            INNER JOIN dbo.TourPlanDetails d ON d.TourPlanId = tp.TourPlanId
            WHERE REPLACE(d.DayType, '_', '-') = 'non-working' AND d.PlanDate BETWEEN @FromDate AND @ToDate AND ${IN_SCOPE('tp.UserId')}
        `;
    },

    // ---------------------------------------------------------
    // Leave
    // ---------------------------------------------------------

    LEAVE_TYPES: () => {
        return `
            SELECT LeaveTypeId, Code, Name, AnnualQuota, CAST(AllowHalfDay AS BIT) AS AllowHalfDay,
                   CAST(IsPaid AS BIT) AS IsPaid, CAST(IsActive AS BIT) AS IsActive, SortOrder
            FROM dbo.LeaveTypes
            WHERE (@ActiveOnly = 0 OR IsActive = 1)
            ORDER BY SortOrder, Name
        `;
    },

    FIND_LEAVE_TYPE_CODE: () => `SELECT LeaveTypeId FROM dbo.LeaveTypes WHERE Code = @Code AND (@LeaveTypeId IS NULL OR LeaveTypeId <> @LeaveTypeId)`,

    CREATE_LEAVE_TYPE: () => {
        return `
            INSERT INTO dbo.LeaveTypes (LeaveTypeId, Code, Name, AnnualQuota, AllowHalfDay, IsPaid, IsActive, SortOrder, ModifiedBy, ModifiedOn)
            VALUES (@LeaveTypeId, @Code, @Name, @AnnualQuota, @AllowHalfDay, @IsPaid, @IsActive,
                    (SELECT ISNULL(MAX(SortOrder), 0) + 1 FROM dbo.LeaveTypes), @ModifiedBy, @Now)
        `;
    },

    UPDATE_LEAVE_TYPE: () => {
        return `
            UPDATE dbo.LeaveTypes
            SET Code = @Code, Name = @Name, AnnualQuota = @AnnualQuota, AllowHalfDay = @AllowHalfDay,
                IsPaid = @IsPaid, IsActive = @IsActive, ModifiedBy = @ModifiedBy, ModifiedOn = @Now
            WHERE LeaveTypeId = @LeaveTypeId
        `;
    },

    // Days per type in a calendar year, by status (pending days are reserved against the balance).
    LEAVE_USED: () => {
        return `
            SELECT LeaveTypeId,
                   SUM(CASE WHEN Status = 'APPROVED' THEN Days ELSE 0 END) AS Approved,
                   SUM(CASE WHEN Status = 'PENDING' THEN Days ELSE 0 END) AS Pending
            FROM dbo.LeaveRequests
            WHERE UserId = @UserId AND YEAR(FromDate) = @Year AND Status IN ('APPROVED', 'PENDING')
            GROUP BY LeaveTypeId
        `;
    },

    LEAVE_OVERLAP: () => {
        return `
            SELECT TOP 1 CONVERT(VARCHAR(10), FromDate, 23) AS FromDate, CONVERT(VARCHAR(10), ToDate, 23) AS ToDate, Status
            FROM dbo.LeaveRequests
            WHERE UserId = @UserId AND Status IN ('PENDING', 'APPROVED') AND FromDate <= @ToDate AND ToDate >= @FromDate
        `;
    },

    CREATE_LEAVE: () => {
        return `
            INSERT INTO dbo.LeaveRequests (LeaveId, UserId, LeaveTypeId, FromDate, ToDate, HalfDay, Days, Reason, Status, SubmittedOn)
            VALUES (@LeaveId, @UserId, @LeaveTypeId, @FromDate, @ToDate, @HalfDay, @Days, @Reason, 'PENDING', @Now)
        `;
    },

    GET_LEAVE: () => {
        return `
            SELECT l.LeaveId, l.UserId, u.ManagerId, ${displayName('u')} AS UserName, l.Status, l.Days,
                   CONVERT(VARCHAR(10), l.FromDate, 23) AS FromDate, CONVERT(VARCHAR(10), l.ToDate, 23) AS ToDate, t.Name AS LeaveName
            FROM dbo.LeaveRequests l
            INNER JOIN Users u ON u.UserId = l.UserId
            INNER JOIN dbo.LeaveTypes t ON t.LeaveTypeId = l.LeaveTypeId
            WHERE l.LeaveId = @LeaveId
        `;
    },

    // Guarded status change: returns rows affected (0 when the status moved on meanwhile).
    SET_LEAVE_STATUS: () => {
        return `
            UPDATE dbo.LeaveRequests
            SET Status = @Status, ReviewedBy = @ReviewedBy, ReviewedOn = @Now, ReviewRemarks = @Remarks
            WHERE LeaveId = @LeaveId AND Status = @FromStatus
        `;
    },

    LEAVE_LIST: () => {
        return `
            ${SCOPE_CTE}
            SELECT
                l.LeaveId, l.UserId, ${displayName('u')} AS UserName, u.ManagerId,
                t.Code AS LeaveCode, t.Name AS LeaveName,
                CONVERT(VARCHAR(10), l.FromDate, 23) AS FromDate, CONVERT(VARCHAR(10), l.ToDate, 23) AS ToDate,
                CAST(l.HalfDay AS BIT) AS HalfDay, l.Days, l.Reason, l.Status, l.SubmittedOn,
                ${displayName('rv')} AS ReviewedByName, l.ReviewedOn, l.ReviewRemarks
            FROM Scope s
            INNER JOIN dbo.LeaveRequests l ON l.UserId = s.UserId
            INNER JOIN Users u ON u.UserId = l.UserId
            INNER JOIN dbo.LeaveTypes t ON t.LeaveTypeId = l.LeaveTypeId
            LEFT JOIN Users rv ON rv.UserId = l.ReviewedBy
            WHERE YEAR(l.FromDate) = @Year AND ${IN_SCOPE('l.UserId')}
            ORDER BY l.FromDate DESC
        `;
    },

    // For the Approvals inbox: direct reports' pending leave.
    PENDING_LEAVES_FOR_MANAGER: () => {
        return `
            SELECT l.LeaveId AS Id, ${displayName('u')} AS UserName, t.Name AS LeaveName,
                   CONVERT(VARCHAR(10), l.FromDate, 23) AS FromDate, CONVERT(VARCHAR(10), l.ToDate, 23) AS ToDate,
                   l.Days, l.Reason, l.SubmittedOn
            FROM dbo.LeaveRequests l
            INNER JOIN Users u ON u.UserId = l.UserId
            INNER JOIN dbo.LeaveTypes t ON t.LeaveTypeId = l.LeaveTypeId
            WHERE u.ManagerId = @UserId AND l.Status = 'PENDING'
        `;
    },

    // ---------------------------------------------------------
    // Activity timeline (one user, date range)
    // ---------------------------------------------------------

    ACT_ATTENDANCE: () => {
        return `
            SELECT CheckInAt, CheckInLocation, CheckOutAt, CheckOutLocation
            FROM dbo.AttendanceLogs WHERE UserId = @UserId AND AttendanceDate BETWEEN @FromDate AND @ToDate
        `;
    },

    ACT_VISITS: () => {
        return `
            SELECT CONVERT(VARCHAR(10), v.VisitDate, 23) AS Day, ${TIME('v.StartTime')} AS StartTime, ${TIME('v.EndTime')} AS EndTime,
                   v.CreatedOn, d.DoctorName, d.Category, v.Feedback, v.LocationStatus, v.PlanStatus
            FROM dbo.Visits v
            INNER JOIN dbo.Doctor d ON d.DoctorId = v.DoctorId
            WHERE v.UserId = @UserId AND v.VisitDate BETWEEN @FromDate AND @ToDate
        `;
    },

    ACT_DCRS: () => {
        return `
            SELECT CONVERT(VARCHAR(10), ReportDate, 23) AS Day, SubmittedOn, Status, VisitCount, DistanceKm
            FROM dbo.DailyCallReports
            WHERE UserId = @UserId AND SubmittedOn >= @FromDate AND SubmittedOn < DATEADD(DAY, 1, CAST(@ToDate AS DATE))
        `;
    },

    ACT_ORDERS: () => {
        return `
            SELECT o.CreatedOn, o.OrderNumber, o.NetAmount, o.Status, COALESCE(dd.DoctorName, ph.PharmacyName) AS CustomerName, o.CustomerType
            FROM dbo.Orders o
            LEFT JOIN dbo.Doctor dd ON dd.DoctorId = o.DoctorId
            LEFT JOIN dbo.Pharmacy ph ON ph.PharmacyId = o.PharmacyId
            WHERE o.UserId = @UserId AND o.CreatedOn >= @FromDate AND o.CreatedOn < DATEADD(DAY, 1, CAST(@ToDate AS DATE))
        `;
    },

    ACT_RCPA: () => {
        return `
            SELECT r.CreatedOn, ph.PharmacyName, d.DoctorName
            FROM dbo.RcpaEntries r
            INNER JOIN dbo.Pharmacy ph ON ph.PharmacyId = r.PharmacyId
            INNER JOIN dbo.Doctor d ON d.DoctorId = r.DoctorId
            WHERE r.UserId = @UserId AND r.CreatedOn >= @FromDate AND r.CreatedOn < DATEADD(DAY, 1, CAST(@ToDate AS DATE))
        `;
    },

    ACT_LEAVES: () => {
        return `
            SELECT l.SubmittedOn, l.ReviewedOn, l.Status, l.Days, t.Name AS LeaveName,
                   CONVERT(VARCHAR(10), l.FromDate, 23) AS FromDate, CONVERT(VARCHAR(10), l.ToDate, 23) AS ToDate
            FROM dbo.LeaveRequests l
            INNER JOIN dbo.LeaveTypes t ON t.LeaveTypeId = l.LeaveTypeId
            WHERE l.UserId = @UserId AND l.SubmittedOn >= @FromDate AND l.SubmittedOn < DATEADD(DAY, 1, CAST(@ToDate AS DATE))
        `;
    },

    ACT_CLAIMS: () => {
        return `
            SELECT SubmittedOn, CONVERT(VARCHAR(7), ClaimMonth, 23) AS ClaimMonth, ClaimedAmount, Status
            FROM dbo.ExpenseClaims
            WHERE UserId = @UserId AND SubmittedOn >= @FromDate AND SubmittedOn < DATEADD(DAY, 1, CAST(@ToDate AS DATE))
        `;
    },

    ACT_TOUR_PLANS: () => {
        return `
            SELECT SubmittedOn, CONVERT(VARCHAR(7), PlanMonth, 23) AS PlanMonth
            FROM dbo.TourPlan
            WHERE UserId = @UserId AND SubmittedOn >= @FromDate AND SubmittedOn < DATEADD(DAY, 1, CAST(@ToDate AS DATE))
        `;
    },

    // ---------------------------------------------------------
    // Appraisals
    // ---------------------------------------------------------

    CYCLES: () => {
        return `
            SELECT c.CycleId, c.Name, CONVERT(VARCHAR(10), c.PeriodFrom, 23) AS PeriodFrom, CONVERT(VARCHAR(10), c.PeriodTo, 23) AS PeriodTo,
                   c.KpiWeight, c.Status, c.CreatedOn, c.ClosedOn,
                   (SELECT COUNT(*) FROM dbo.Appraisals a WHERE a.CycleId = c.CycleId AND a.Status = 'COMPLETED') AS Completed
            FROM dbo.AppraisalCycles c
            ORDER BY c.PeriodFrom DESC
        `;
    },

    GET_CYCLE: () => {
        return `
            SELECT CycleId, Name, CONVERT(VARCHAR(10), PeriodFrom, 23) AS PeriodFrom, CONVERT(VARCHAR(10), PeriodTo, 23) AS PeriodTo, KpiWeight, Status
            FROM dbo.AppraisalCycles WHERE CycleId = @CycleId
        `;
    },

    CREATE_CYCLE: () => {
        return `
            INSERT INTO dbo.AppraisalCycles (CycleId, Name, PeriodFrom, PeriodTo, KpiWeight, Status, CreatedBy, CreatedOn)
            VALUES (@CycleId, @Name, @PeriodFrom, @PeriodTo, @KpiWeight, 'OPEN', @CreatedBy, @Now)
        `;
    },

    CLOSE_CYCLE: () => `UPDATE dbo.AppraisalCycles SET Status = 'CLOSED', ClosedOn = @Now WHERE CycleId = @CycleId AND Status = 'OPEN'`,

    GET_APPRAISAL: () => {
        return `
            SELECT a.*, ${displayName('u')} AS UserName, u.ManagerId AS CurrentManagerId, ${displayName('m')} AS ManagerName
            FROM dbo.Appraisals a
            INNER JOIN Users u ON u.UserId = a.UserId
            LEFT JOIN Users m ON m.UserId = u.ManagerId
            WHERE a.CycleId = @CycleId AND a.UserId = @UserId
        `;
    },

    CREATE_APPRAISAL: () => {
        return `
            IF NOT EXISTS (SELECT 1 FROM dbo.Appraisals WHERE CycleId = @CycleId AND UserId = @UserId)
                INSERT INTO dbo.Appraisals (AppraisalId, CycleId, UserId, Status, ManagerId, CreatedOn, ModifiedOn)
                VALUES (@AppraisalId, @CycleId, @UserId, 'PENDING_SELF', @ManagerId, @Now, @Now)
        `;
    },

    SAVE_SELF: () => {
        return `
            UPDATE dbo.Appraisals
            SET SelfRating = @Rating, SelfComments = @Comments, SelfSubmittedOn = @Now, Status = 'PENDING_MANAGER', ModifiedOn = @Now
            WHERE CycleId = @CycleId AND UserId = @UserId AND Status IN ('PENDING_SELF', 'PENDING_MANAGER')
        `;
    },

    SAVE_MANAGER: () => {
        return `
            UPDATE dbo.Appraisals
            SET ManagerId = @ManagerId, ManagerRating = @Rating, ManagerComments = @Comments, ManagerSubmittedOn = @Now,
                KpiScore = @KpiScore, FinalScore = @FinalScore, Status = 'COMPLETED', ModifiedOn = @Now
            WHERE CycleId = @CycleId AND UserId = @UserId AND Status = @FromStatus
        `;
    },

    // Everyone in scope with their appraisal for the cycle (if started).
    TEAM_APPRAISALS: () => {
        return `
            ${SCOPE_CTE}
            SELECT u.UserId, ${displayName('u')} AS UserName, sld.SystemLovDetailName AS DesignationName, u.ManagerId,
                   ${displayName('m')} AS ManagerName,
                   a.Status, a.SelfRating, a.ManagerRating, a.KpiScore, a.FinalScore, a.SelfSubmittedOn, a.ManagerSubmittedOn
            FROM Scope s
            INNER JOIN Users u ON u.UserId = s.UserId
            LEFT JOIN Users m ON m.UserId = u.ManagerId
            LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = u.DesignationId
            LEFT JOIN dbo.Appraisals a ON a.UserId = u.UserId AND a.CycleId = @CycleId
            WHERE ISNULL(u.IsActive, 1) = 1
            ORDER BY CASE WHEN u.UserId = @ActingUserId THEN 0 ELSE 1 END, UserName
        `;
    },
};
