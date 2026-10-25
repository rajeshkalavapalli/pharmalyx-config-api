const { SCOPE_CTE, displayName } = require('../../utils/reportScope');

// A visit's final result: head office override wins over the system decision.
const EFFECTIVE = `COALESCE(v.ValidityOverride, v.Validity)`;
// Counted visits: valid, or needs a look (counts unless rejected).
const COUNTED = `${EFFECTIVE} IN ('VALID', 'REVIEW')`;

module.exports = {
    EFFECTIVE,

    // ---------------------------------------------------------
    // Settings
    // ---------------------------------------------------------

    GET_SETTINGS: () => `SELECT SettingKey, SettingValue, Description FROM dbo.AntiFraudSettings ORDER BY SettingKey`,

    UPDATE_SETTING: () => {
        return `
            UPDATE dbo.AntiFraudSettings SET SettingValue = @SettingValue, ModifiedBy = @ActorId, ModifiedOn = @Now WHERE SettingKey = @SettingKey;
            IF @@ROWCOUNT = 0 THROW 50404, 'Unknown setting.', 1;
        `;
    },

    // ---------------------------------------------------------
    // People
    // ---------------------------------------------------------

    GET_USER: () => {
        return `
            SELECT u.UserId, ${displayName('u')} AS Name, u.ManagerId, r.RoleName, d.SystemLovDetailName AS DesignationName
            FROM Users u
            LEFT JOIN Roles r ON r.RoleId = u.RoleId
            LEFT JOIN SystemLovDetails d ON d.SystemLovDetailId = u.DesignationId
            WHERE u.UserId = @UserId
        `;
    },

    // Everyone the acting user may see (self + hierarchy, or all with reports.viewall).
    SCOPE_USERS: () => {
        return `
            ${SCOPE_CTE}
            SELECT u.UserId, ${displayName('u')} AS Name, ${displayName('m')} AS ManagerName, r.RoleName
            FROM Scope s
            INNER JOIN Users u ON u.UserId = s.UserId
            LEFT JOIN Users m ON m.UserId = u.ManagerId
            LEFT JOIN Roles r ON r.RoleId = u.RoleId
            WHERE ISNULL(u.IsActive, 1) = 1
            ORDER BY Name
        `;
    },

    // ---------------------------------------------------------
    // Territory: patches, boundaries, exceptions
    // ---------------------------------------------------------

    // Areas the MR works in: approved STP patches, mapped areas, and areas of their doctors.
    MY_AREAS: () => {
        return `
            WITH Approved AS (
                SELECT TOP 1 StpId FROM dbo.Stp WHERE UserId = @UserId AND Status = 'APPROVED' ORDER BY ReviewedOn DESC
            ),
            AreaIds AS (
                SELECT p.AreaId FROM dbo.StpPatches p INNER JOIN Approved a ON a.StpId = p.StpId
                UNION SELECT m.AreaId FROM dbo.UserAreaMapping m WHERE m.UserId = @UserId AND m.AreaId IS NOT NULL
                UNION SELECT TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId)
                      FROM dbo.UserDoctorMapping udm INNER JOIN dbo.Doctor d ON d.DoctorId = udm.DoctorId
                      WHERE udm.UserId = @UserId AND ISNULL(udm.IsActive, 'Yes') <> 'No' AND TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId) IS NOT NULL
            )
            SELECT a.AreaId, a.AreaName, t.TerritoryId, t.TerritoryName,
                   (SELECT p.PatchType FROM dbo.StpPatches p INNER JOIN Approved ap ON ap.StpId = p.StpId WHERE p.AreaId = a.AreaId) AS PatchType
            FROM AreaIds x
            INNER JOIN Areas a ON a.AreaId = x.AreaId
            LEFT JOIN Territory t ON t.TerritoryId = a.TerritoryId
            ORDER BY t.TerritoryName, a.AreaName
        `;
    },

    // Areas of the MR's territories (to choose STP patches from).
    TERRITORY_AREAS: () => {
        return `
            SELECT a.AreaId, a.AreaName, t.TerritoryId, t.TerritoryName
            FROM Areas a
            INNER JOIN Territory t ON t.TerritoryId = a.TerritoryId
            WHERE t.TerritoryId IN (
                SELECT TerritoryId FROM dbo.UserTerritoryMapping WHERE UserId = @UserId
                UNION SELECT TerritoryId FROM dbo.UserAreaMapping WHERE UserId = @UserId AND TerritoryId IS NOT NULL
                UNION SELECT TerritoryId FROM Users WHERE UserId = @UserId AND TerritoryId IS NOT NULL
                UNION SELECT TRY_CONVERT(UNIQUEIDENTIFIER, d.TerritoryId)
                      FROM dbo.UserDoctorMapping udm INNER JOIN dbo.Doctor d ON d.DoctorId = udm.DoctorId
                      WHERE udm.UserId = @UserId AND ISNULL(udm.IsActive, 'Yes') <> 'No'
            )
            ORDER BY t.TerritoryName, a.AreaName
        `;
    },

    // Approved boundaries of the user and everyone reporting to them (a manager's territory includes their team's).
    TEAM_BOUNDARIES: () => {
        return `
            ${SCOPE_CTE}
            SELECT b.UserId, b.Polygon
            FROM dbo.WorkBoundaries b
            INNER JOIN Scope s ON s.UserId = b.UserId
            WHERE b.Status = 'APPROVED'
        `;
    },

    // Active head-office exceptions for a user on a date.
    ACTIVE_EXCEPTIONS: () => {
        return `
            SELECT e.ExceptionId, e.ExceptionType, e.DoctorId, e.CoverUserId, cb.Polygon AS CoverPolygon
            FROM dbo.TerritoryExceptions e
            LEFT JOIN dbo.WorkBoundaries cb ON cb.UserId = e.CoverUserId AND cb.Status = 'APPROVED'
            WHERE e.UserId = @UserId AND e.RevokedOn IS NULL
              AND (e.FromDate IS NULL OR e.FromDate <= @Date) AND (e.ToDate IS NULL OR e.ToDate >= @Date)
        `;
    },

    BOUNDARY_LIST: () => {
        return `
            ${SCOPE_CTE}
            SELECT u.UserId, ${displayName('u')} AS Name, r.RoleName,
                   ab.BoundaryId AS ApprovedId, ab.Polygon AS ApprovedPolygon, ab.Source AS ApprovedSource, ab.ApprovedOn,
                   db.BoundaryId AS DraftId, db.Polygon AS DraftPolygon, db.Source AS DraftSource, db.MarginKm AS DraftMarginKm, db.CreatedOn AS DraftCreatedOn,
                   (SELECT COUNT(*) FROM dbo.UserDoctorMapping m INNER JOIN dbo.Doctor d ON d.DoctorId = m.DoctorId
                    WHERE m.UserId = u.UserId AND ISNULL(m.IsActive, 'Yes') <> 'No' AND d.ClinicLatitude IS NOT NULL) AS PinnedDoctors
            FROM Scope s
            INNER JOIN Users u ON u.UserId = s.UserId
            LEFT JOIN Roles r ON r.RoleId = u.RoleId
            OUTER APPLY (SELECT TOP 1 * FROM dbo.WorkBoundaries b WHERE b.UserId = u.UserId AND b.Status = 'APPROVED' ORDER BY b.ApprovedOn DESC) ab
            OUTER APPLY (SELECT TOP 1 * FROM dbo.WorkBoundaries b WHERE b.UserId = u.UserId AND b.Status = 'DRAFT' ORDER BY b.CreatedOn DESC) db
            WHERE ISNULL(u.IsActive, 1) = 1
            ORDER BY Name
        `;
    },

    // Pinned clinics of the MR's doctors (and hospitals they belong to), for an auto boundary.
    CLINICS_OF_USER: () => {
        return `
            SELECT COALESCE(h.Latitude, d.ClinicLatitude) AS Latitude, COALESCE(h.Longitude, d.ClinicLongitude) AS Longitude
            FROM dbo.UserDoctorMapping m
            INNER JOIN dbo.Doctor d ON d.DoctorId = m.DoctorId
            LEFT JOIN dbo.Hospitals h ON h.HospitalId = d.HospitalId AND h.IsActive = 1
            WHERE m.UserId = @UserId AND ISNULL(m.IsActive, 'Yes') <> 'No' AND ISNULL(d.IsActive, 'Yes') <> 'No'
              AND COALESCE(h.Latitude, d.ClinicLatitude) IS NOT NULL
        `;
    },

    INSERT_BOUNDARY: () => {
        return `
            UPDATE dbo.WorkBoundaries SET Status = 'RETIRED' WHERE UserId = @UserId AND Status = 'DRAFT';
            INSERT INTO dbo.WorkBoundaries (BoundaryId, UserId, Polygon, Source, MarginKm, Status, Notes, CreatedBy, CreatedOn)
            VALUES (@BoundaryId, @UserId, @Polygon, @Source, @MarginKm, 'DRAFT', @Notes, @ActorId, @Now);
        `;
    },

    GET_BOUNDARY: () => `SELECT BoundaryId, UserId, Polygon, Source, MarginKm, Status FROM dbo.WorkBoundaries WHERE BoundaryId = @BoundaryId`,

    APPROVE_BOUNDARY: () => {
        return `
            UPDATE dbo.WorkBoundaries SET Status = 'APPROVED', ApprovedBy = @ActorId, ApprovedOn = @Now
            WHERE BoundaryId = @BoundaryId AND Status = 'DRAFT';
            IF @@ROWCOUNT = 0 THROW 50409, 'This boundary was already decided.', 1;
            UPDATE dbo.WorkBoundaries SET Status = 'RETIRED' WHERE UserId = @UserId AND Status = 'APPROVED' AND BoundaryId <> @BoundaryId;
        `;
    },

    LIST_EXCEPTIONS: () => {
        return `
            ${SCOPE_CTE}
            SELECT e.ExceptionId, e.UserId, ${displayName('u')} AS UserName, e.ExceptionType, e.DoctorId, d.DoctorName,
                   e.CoverUserId, ${displayName('c')} AS CoverUserName,
                   CONVERT(VARCHAR(10), e.FromDate, 23) AS FromDate, CONVERT(VARCHAR(10), e.ToDate, 23) AS ToDate,
                   e.Reason, ${displayName('g')} AS GrantedByName, e.GrantedOn, e.RevokedOn, ${displayName('rv')} AS RevokedByName
            FROM dbo.TerritoryExceptions e
            INNER JOIN Scope s ON s.UserId = e.UserId
            INNER JOIN Users u ON u.UserId = e.UserId
            LEFT JOIN dbo.Doctor d ON d.DoctorId = e.DoctorId
            LEFT JOIN Users c ON c.UserId = e.CoverUserId
            LEFT JOIN Users g ON g.UserId = e.GrantedBy
            LEFT JOIN Users rv ON rv.UserId = e.RevokedBy
            ORDER BY CASE WHEN e.RevokedOn IS NULL THEN 0 ELSE 1 END, e.GrantedOn DESC
        `;
    },

    INSERT_EXCEPTION: () => {
        return `
            INSERT INTO dbo.TerritoryExceptions (ExceptionId, UserId, ExceptionType, DoctorId, CoverUserId, FromDate, ToDate, Reason, GrantedBy, GrantedOn)
            VALUES (@ExceptionId, @UserId, @ExceptionType, @DoctorId, @CoverUserId, @FromDate, @ToDate, @Reason, @ActorId, @Now)
        `;
    },

    GET_EXCEPTION: () => `SELECT * FROM dbo.TerritoryExceptions WHERE ExceptionId = @ExceptionId`,

    REVOKE_EXCEPTION: () => {
        return `
            UPDATE dbo.TerritoryExceptions SET RevokedBy = @ActorId, RevokedOn = @Now WHERE ExceptionId = @ExceptionId AND RevokedOn IS NULL;
            IF @@ROWCOUNT = 0 THROW 50409, 'This exception was already revoked.', 1;
        `;
    },

    // ---------------------------------------------------------
    // Hospitals
    // ---------------------------------------------------------

    LIST_HOSPITALS: () => {
        return `
            SELECT h.HospitalId, h.HospitalName, h.AreaId, a.AreaName, h.Latitude, h.Longitude, h.RadiusM, h.IsActive,
                   (SELECT COUNT(*) FROM dbo.Doctor d WHERE d.HospitalId = h.HospitalId) AS Doctors
            FROM dbo.Hospitals h
            LEFT JOIN Areas a ON a.AreaId = h.AreaId
            ORDER BY h.HospitalName
        `;
    },

    INSERT_HOSPITAL: () => {
        return `
            INSERT INTO dbo.Hospitals (HospitalId, HospitalName, AreaId, Latitude, Longitude, RadiusM, IsActive, CreatedBy, CreatedOn)
            VALUES (@HospitalId, @HospitalName, @AreaId, @Latitude, @Longitude, @RadiusM, 1, @ActorId, @Now)
        `;
    },

    UPDATE_HOSPITAL: () => {
        return `
            UPDATE dbo.Hospitals SET HospitalName = @HospitalName, AreaId = @AreaId, Latitude = @Latitude, Longitude = @Longitude,
                   RadiusM = @RadiusM, IsActive = @IsActive, ModifiedOn = @Now
            WHERE HospitalId = @HospitalId;
            IF @@ROWCOUNT = 0 THROW 50404, 'Hospital not found.', 1;
        `;
    },

    HOSPITAL_DOCTORS: () => {
        return `
            SELECT d.DoctorId, d.DoctorName, d.Speciality, d.HospitalId
            FROM dbo.Doctor d
            WHERE ISNULL(d.IsActive, 'Yes') <> 'No'
              AND (d.HospitalId = @HospitalId OR TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId) = @AreaId
                   -- or a pinned clinic within about 1 km of the hospital
                   OR EXISTS (SELECT 1 FROM dbo.Hospitals h WHERE h.HospitalId = @HospitalId
                              AND d.ClinicLatitude BETWEEN h.Latitude - 0.01 AND h.Latitude + 0.01
                              AND d.ClinicLongitude BETWEEN h.Longitude - 0.01 AND h.Longitude + 0.01))
            ORDER BY d.DoctorName
        `;
    },

    SET_DOCTOR_HOSPITAL: () => `UPDATE dbo.Doctor SET HospitalId = @HospitalId, ModifiedOn = @Now WHERE DoctorId = @DoctorId`,

    // ---------------------------------------------------------
    // Day start, consent, pings
    // ---------------------------------------------------------

    GET_WORKDAY: () => {
        return `
            SELECT w.UserId, CONVERT(VARCHAR(10), w.WorkDate, 23) AS WorkDate, w.StartedAt, w.StartSource, w.StartLatitude, w.StartLongitude,
                   w.StartInside, w.PlannedAreaId, a.AreaName AS PlannedAreaName
            FROM dbo.WorkDays w LEFT JOIN Areas a ON a.AreaId = w.PlannedAreaId
            WHERE w.UserId = @UserId AND w.WorkDate = @WorkDate
        `;
    },

    // Only the first activity of the day counts; later calls change nothing.
    START_WORKDAY: () => {
        return `
            IF NOT EXISTS (SELECT 1 FROM dbo.WorkDays WITH (UPDLOCK, HOLDLOCK) WHERE UserId = @UserId AND WorkDate = @WorkDate)
                INSERT INTO dbo.WorkDays (UserId, WorkDate, StartedAt, StartSource, StartLatitude, StartLongitude, StartAccuracy, StartInside, PlannedAreaId)
                VALUES (@UserId, @WorkDate, @Now, @StartSource, @Latitude, @Longitude, @Accuracy, @StartInside, @PlannedAreaId);
            SELECT @@ROWCOUNT AS Inserted;
        `;
    },

    PLANNED_DAY: () => {
        return `
            SELECT TOP 1 REPLACE(d.DayType, '_', '-') AS DayType, d.AreaId, a.AreaName, d.TerritoryId, d.Remarks
            FROM dbo.TourPlan p
            INNER JOIN dbo.TourPlanDetails d ON d.TourPlanId = p.TourPlanId
            LEFT JOIN Areas a ON a.AreaId = d.AreaId
            WHERE p.UserId = @UserId AND d.PlanDate = @Date
        `;
    },

    MONTH_PLAN: () => {
        return `
            SELECT CONVERT(VARCHAR(10), d.PlanDate, 23) AS PlanDate, REPLACE(d.DayType, '_', '-') AS DayType, d.AreaId, a.AreaName, d.Remarks
            FROM dbo.TourPlan p
            INNER JOIN dbo.TourPlanDetails d ON d.TourPlanId = p.TourPlanId
            LEFT JOIN Areas a ON a.AreaId = d.AreaId
            WHERE p.UserId = @UserId AND p.PlanMonth = @Month
            ORDER BY d.PlanDate
        `;
    },

    ON_LEAVE: () => {
        return `
            SELECT TOP 1 1 AS OnLeave FROM dbo.LeaveRequests
            WHERE UserId = @UserId AND Status = 'APPROVED' AND FromDate <= @Date AND ToDate >= @Date
        `;
    },

    LEAVE_DATES: () => {
        return `
            SELECT CONVERT(VARCHAR(10), FromDate, 23) AS FromDate, CONVERT(VARCHAR(10), ToDate, 23) AS ToDate
            FROM dbo.LeaveRequests
            WHERE UserId = @UserId AND Status = 'APPROVED' AND FromDate <= @MonthEnd AND ToDate >= @Month
        `;
    },

    GET_CONSENT: () => `SELECT TOP 1 ConsentVersion, AcceptedAt FROM dbo.LocationConsents WHERE UserId = @UserId AND ConsentVersion = @ConsentVersion`,

    INSERT_CONSENT: () => {
        return `
            IF NOT EXISTS (SELECT 1 FROM dbo.LocationConsents WHERE UserId = @UserId AND ConsentVersion = @ConsentVersion)
                INSERT INTO dbo.LocationConsents (UserId, ConsentVersion, AcceptedAt, UserAgent) VALUES (@UserId, @ConsentVersion, @Now, @UserAgent)
        `;
    },

    LAST_PING: () => `SELECT TOP 1 ServerAt FROM dbo.LocationPings WHERE UserId = @UserId ORDER BY PingId DESC`,

    INSERT_PING: () => {
        return `
            INSERT INTO dbo.LocationPings (UserId, PingDate, ServerAt, DeviceAt, Latitude, Longitude, Accuracy, Activity, IsMock, Source)
            VALUES (@UserId, @PingDate, @Now, @DeviceAt, @Latitude, @Longitude, @Accuracy, @Activity, @IsMock, @Source)
        `;
    },

    // Every location the server recorded for the user in a date range (for distance travelled).
    DAY_POINTS: () => {
        return `
            SELECT PingDate AS D, COALESCE(DeviceAt, ServerAt) AS At, Latitude AS Lat, Longitude AS Lng, Accuracy, IsMock
            FROM dbo.LocationPings WHERE UserId = @UserId AND PingDate BETWEEN @From AND @To
            UNION ALL
            SELECT WorkDate, StartedAt, StartLatitude, StartLongitude, StartAccuracy, 0
            FROM dbo.WorkDays WHERE UserId = @UserId AND WorkDate BETWEEN @From AND @To AND StartLatitude IS NOT NULL
            UNION ALL
            SELECT VisitDate, CheckInAt, Latitude, Longitude, LocationAccuracy, ISNULL(IsMockLocation, 0)
            FROM dbo.Visits WHERE UserId = @UserId AND VisitDate BETWEEN @From AND @To AND CheckInAt IS NOT NULL AND Latitude IS NOT NULL
            UNION ALL
            SELECT VisitDate, CheckOutAt, CheckOutLatitude, CheckOutLongitude, CheckOutAccuracy, ISNULL(IsMockLocation, 0)
            FROM dbo.Visits WHERE UserId = @UserId AND VisitDate BETWEEN @From AND @To AND CheckOutAt IS NOT NULL AND CheckOutLatitude IS NOT NULL
        `;
    },

    // ---------------------------------------------------------
    // Check-in
    // ---------------------------------------------------------

    // One open check-in per MR: starting a new one abandons the previous unfinished one.
    INSERT_CHECKIN: () => {
        return `
            UPDATE dbo.VisitCheckIns SET Status = 'ABANDONED' WHERE UserId = @UserId AND Status = 'OPEN';
            INSERT INTO dbo.VisitCheckIns (CheckInId, UserId, DoctorId, CheckInAt, Latitude, Longitude, Accuracy, IsMock, Activity, Status, CreatedOn)
            VALUES (@CheckInId, @UserId, @DoctorId, @Now, @Latitude, @Longitude, @Accuracy, @IsMock, @Activity, 'OPEN', @Now);
        `;
    },

    GET_CHECKIN: () => `SELECT * FROM dbo.VisitCheckIns WHERE CheckInId = @CheckInId`,

    USE_CHECKIN: () => {
        return `
            UPDATE dbo.VisitCheckIns SET Status = 'USED', VisitId = @VisitId WHERE CheckInId = @CheckInId AND Status = 'OPEN';
            IF @@ROWCOUNT = 0 THROW 50409, 'This check-in was already used or replaced by a newer one.', 1;
        `;
    },

    // The MR's other timed visits that day (overlap check).
    DAY_VISIT_TIMES: () => {
        return `
            SELECT VisitId, CheckInAt, CheckOutAt FROM dbo.Visits
            WHERE UserId = @UserId AND VisitDate = @Date AND CheckInAt IS NOT NULL AND CheckOutAt IS NOT NULL
        `;
    },

    DOCTOR_HOSPITAL: () => {
        return `
            SELECT h.HospitalId, h.HospitalName, h.Latitude, h.Longitude, h.RadiusM
            FROM dbo.Doctor d INNER JOIN dbo.Hospitals h ON h.HospitalId = d.HospitalId AND h.IsActive = 1
            WHERE d.DoctorId = @DoctorId
        `;
    },

    // ---------------------------------------------------------
    // Plan, timing, coverage
    // ---------------------------------------------------------

    MY_DOCTORS: () => {
        return `
            SELECT d.DoctorId, d.DoctorName, d.Speciality, d.Category, d.VisitsPerMonth, TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId) AS AreaId, a.AreaName,
                   d.HospitalName, d.VerificationStatus, d.ClinicLatitude, d.ClinicLongitude, d.HospitalId, h.HospitalName AS HospitalGroup
            FROM dbo.UserDoctorMapping m
            INNER JOIN dbo.Doctor d ON d.DoctorId = m.DoctorId
            LEFT JOIN Areas a ON a.AreaId = TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId)
            LEFT JOIN dbo.Hospitals h ON h.HospitalId = d.HospitalId
            WHERE m.UserId = @UserId AND ISNULL(m.IsActive, 'Yes') <> 'No' AND ISNULL(d.IsActive, 'Yes') <> 'No'
              AND ISNULL(d.ApprovalStatus, 'APPROVED') = 'APPROVED'
        `;
    },

    // Valid visits per doctor in a date range (and all visits, for coverage).
    VISIT_COUNTS: () => {
        return `
            SELECT v.DoctorId,
                   SUM(CASE WHEN ${COUNTED} THEN 1 ELSE 0 END) AS ValidVisits,
                   SUM(CASE WHEN ${EFFECTIVE} = 'INVALID' THEN 1 ELSE 0 END) AS NotCounted,
                   SUM(CASE WHEN ${EFFECTIVE} IS NULL THEN 1 ELSE 0 END) AS Unchecked,
                   MAX(CASE WHEN ${COUNTED} THEN CONVERT(VARCHAR(10), v.VisitDate, 23) END) AS LastValid
            FROM dbo.Visits v
            WHERE v.UserId = @UserId AND v.VisitDate BETWEEN @From AND @To
            GROUP BY v.DoctorId
        `;
    },

    // Valid check-in times per doctor (for timing suggestions).
    VALID_TIMES: () => {
        return `
            SELECT v.DoctorId, v.CheckInAt
            FROM dbo.Visits v
            WHERE v.UserId = @UserId AND v.CheckInAt IS NOT NULL AND ${COUNTED} AND v.VisitDate >= @Since
        `;
    },

    DAY_VISITS: () => {
        return `
            SELECT v.VisitId, v.DoctorId, d.DoctorName, v.CheckInAt, v.CheckOutAt, v.DwellSeconds, v.Validity, v.ValidityOverride,
                   ${EFFECTIVE} AS FinalValidity, v.InvalidReasons
            FROM dbo.Visits v INNER JOIN dbo.Doctor d ON d.DoctorId = v.DoctorId
            WHERE v.UserId = @UserId AND v.VisitDate = @Date
            ORDER BY COALESCE(v.CheckInAt, v.CreatedOn)
        `;
    },

    // ---------------------------------------------------------
    // Validity review (managers view, head office overrides)
    // ---------------------------------------------------------

    LIST_VISITS: () => {
        return `
            ${SCOPE_CTE}
            SELECT TOP 1000
                v.VisitId, CONVERT(VARCHAR(10), v.VisitDate, 23) AS VisitDate, v.UserId, ${displayName('u')} AS EmployeeName,
                v.DoctorId, d.DoctorName, a.AreaName, v.CheckInAt, v.CheckOutAt, v.DwellSeconds, v.MotionActivity,
                v.DistanceFromClinicM, v.InsideBoundary, v.IsMockLocation, v.Validity, v.InvalidReasons,
                v.ValidityOverride, v.OverrideReason, v.OverrideOn, ${displayName('ob')} AS OverrideByName, ${EFFECTIVE} AS FinalValidity
            FROM dbo.Visits v
            INNER JOIN Scope s ON s.UserId = v.UserId
            INNER JOIN Users u ON u.UserId = v.UserId
            INNER JOIN dbo.Doctor d ON d.DoctorId = v.DoctorId
            LEFT JOIN Areas a ON a.AreaId = TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId)
            LEFT JOIN Users ob ON ob.UserId = v.OverrideBy
            WHERE v.VisitDate BETWEEN @From AND @To
              AND (@UserId IS NULL OR v.UserId = @UserId)
              AND (@Validity IS NULL OR ISNULL(${EFFECTIVE}, 'UNCHECKED') = @Validity)
            ORDER BY v.VisitDate DESC, COALESCE(v.CheckInAt, v.CreatedOn) DESC
        `;
    },

    GET_VISIT: () => `SELECT VisitId, UserId, DoctorId, VisitDate, Validity, ValidityOverride, InvalidReasons FROM dbo.Visits WHERE VisitId = @VisitId`,

    OVERRIDE_VISIT: () => {
        return `
            UPDATE dbo.Visits SET ValidityOverride = @ValidityOverride, OverrideBy = @ActorId, OverrideOn = @Now, OverrideReason = @Reason, ModifiedOn = @Now
            WHERE VisitId = @VisitId;
            IF @@ROWCOUNT = 0 THROW 50404, 'Visit not found.', 1;
        `;
    },

    // Red flags for head office (day starts and visits outside the territory, fake GPS, travel jumps).
    LIST_FLAGS: () => {
        return `
            ${SCOPE_CTE}
            SELECT TOP 500 f.FlagId, f.FlagType, f.Severity, f.UserId, ${displayName('u')} AS EmployeeName, f.DoctorId, d.DoctorName,
                   f.VisitId, f.Details, f.Status, f.Note, f.CreatedOn, f.ActedOn, ${displayName('ab')} AS ActedByName
            FROM dbo.FraudFlags f
            INNER JOIN Scope s ON s.UserId = f.UserId
            INNER JOIN Users u ON u.UserId = f.UserId
            LEFT JOIN dbo.Doctor d ON d.DoctorId = f.DoctorId
            LEFT JOIN Users ab ON ab.UserId = f.ActedBy
            WHERE (@Status IS NULL OR f.Status = @Status)
            ORDER BY CASE WHEN f.Status = 'OPEN' THEN 0 ELSE 1 END, f.CreatedOn DESC
        `;
    },

    INSERT_FLAG: () => {
        return `
            INSERT INTO dbo.FraudFlags (FlagId, FlagType, Severity, UserId, DoctorId, VisitId, Details, Data, Status, CreatedOn)
            VALUES (@FlagId, @FlagType, @Severity, @UserId, @DoctorId, @VisitId, @Details, @Data, 'OPEN', @Now)
        `;
    },

    ACT_ON_FLAG: () => {
        return `
            UPDATE dbo.FraudFlags SET Status = @Status, ActedBy = @ActorId, ActedOn = @Now, Note = @Note WHERE FlagId = @FlagId;
            IF @@ROWCOUNT = 0 THROW 50404, 'Flag not found.', 1;
        `;
    },

    // Doctors assigned to more than one person (should be exactly one MR).
    SHARED_DOCTORS: () => {
        return `
            SELECT d.DoctorId, d.DoctorName, STRING_AGG(CONVERT(NVARCHAR(400), ${displayName('u')}), ', ') AS AssignedTo, COUNT(*) AS People
            FROM dbo.UserDoctorMapping m
            INNER JOIN dbo.Doctor d ON d.DoctorId = m.DoctorId
            INNER JOIN Users u ON u.UserId = m.UserId
            WHERE ISNULL(m.IsActive, 'Yes') <> 'No' AND ISNULL(d.IsActive, 'Yes') <> 'No'
            GROUP BY d.DoctorId, d.DoctorName
            HAVING COUNT(*) > 1
        `;
    },
};
