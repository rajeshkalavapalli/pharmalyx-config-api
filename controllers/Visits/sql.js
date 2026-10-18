const displayName = (alias) =>
    `COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(${alias}.FirstName, ' ', ${alias}.LastName))), ''), ${alias}.UserName)`;

// Doctor.TerritoryId/AreaId are varchar; TRY_CONVERT keeps bad values from failing a query.
const VISIT_SELECT = `
    SELECT
        v.VisitId,
        v.UserId,
        ${displayName('u')} AS UserName,
        CONVERT(VARCHAR(10), v.VisitDate, 23) AS VisitDate,
        CONVERT(VARCHAR(5), v.StartTime, 108) AS StartTime,
        CONVERT(VARCHAR(5), v.EndTime, 108) AS EndTime,
        v.DoctorId,
        doc.DoctorName,
        doc.Speciality,
        doc.HospitalName,
        doc.Category,
        t.TerritoryName,
        a.AreaName,
        v.JointWorkUserId,
        ${displayName('ju')} AS JointWorkUserName,
        v.Feedback,
        v.Notes,
        CONVERT(VARCHAR(10), v.FollowUpDate, 23) AS FollowUpDate,
        v.LocationStatus,
        v.Latitude,
        v.Longitude,
        v.LocationAccuracy,
        v.LocationCapturedAt,
        v.PlanStatus,
        pt.TerritoryName AS PlannedTerritoryName,
        pa.AreaName AS PlannedAreaName,
        v.DeviationId,
        dv.Status AS DeviationStatus,
        v.RecordedOffline,
        v.RecordedAt,
        v.CreatedOn,
        v.DistanceFromClinicM,
        v.GeofenceStatus,
        v.GeofenceReason,
        v.IsMockLocation,
        v.CheckInAt,
        v.CheckOutAt,
        v.DwellSeconds,
        v.MotionActivity,
        v.InsideBoundary,
        v.Validity,
        v.InvalidReasons,
        v.ValidityOverride,
        v.OverrideReason,
        COALESCE(v.ValidityOverride, v.Validity) AS FinalValidity
    FROM dbo.Visits v
    INNER JOIN Users u ON u.UserId = v.UserId
    INNER JOIN dbo.Doctor doc ON doc.DoctorId = v.DoctorId
    LEFT JOIN Territory t ON t.TerritoryId = TRY_CONVERT(UNIQUEIDENTIFIER, doc.TerritoryId)
    LEFT JOIN Areas a ON a.AreaId = TRY_CONVERT(UNIQUEIDENTIFIER, doc.AreaId)
    LEFT JOIN Users ju ON ju.UserId = v.JointWorkUserId
    LEFT JOIN Territory pt ON pt.TerritoryId = v.PlannedTerritoryId
    LEFT JOIN Areas pa ON pa.AreaId = v.PlannedAreaId
    LEFT JOIN dbo.TourPlanDeviation dv ON dv.DeviationId = v.DeviationId
`;

module.exports = {
    GET_USER: () => {
        return `
            SELECT UserId, ManagerId
            FROM Users
            WHERE UserId = @UserId
        `;
    },

    GET_VISITS: () => {
        return `
            ${VISIT_SELECT}
            WHERE v.UserId = @UserId
              AND v.VisitDate BETWEEN @FromDate AND @ToDate
              AND (@DoctorId IS NULL OR v.DoctorId = @DoctorId)
            ORDER BY v.VisitDate DESC, v.StartTime DESC, v.CreatedOn DESC
        `;
    },

    GET_VISIT_BY_ID: () => {
        return `
            ${VISIT_SELECT}
            WHERE v.VisitId = @VisitId
        `;
    },

    GET_VISIT_OWNER: () => {
        return `
            SELECT VisitId, UserId
            FROM dbo.Visits
            WHERE VisitId = @VisitId
        `;
    },

    // The latest visit per doctor that set a follow-up, unless a later visit happened.
    GET_OPEN_FOLLOW_UPS: () => {
        return `
            SELECT
                v.VisitId,
                v.DoctorId,
                doc.DoctorName,
                doc.Category,
                doc.HospitalName,
                CONVERT(VARCHAR(10), v.VisitDate, 23) AS VisitDate,
                CONVERT(VARCHAR(10), v.FollowUpDate, 23) AS FollowUpDate,
                v.Notes
            FROM dbo.Visits v
            INNER JOIN dbo.Doctor doc ON doc.DoctorId = v.DoctorId
            WHERE v.UserId = @UserId
              AND v.FollowUpDate IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM dbo.Visits later
                  WHERE later.UserId = v.UserId
                    AND later.DoctorId = v.DoctorId
                    AND (later.VisitDate > v.VisitDate
                         OR (later.VisitDate = v.VisitDate AND later.CreatedOn > v.CreatedOn))
              )
            ORDER BY v.FollowUpDate
        `;
    },

    // Status of the day's DCR, if any. Guarded so Visits works before the DCR table exists.
    GET_DCR_STATUS: () => {
        return `
            IF OBJECT_ID('dbo.DailyCallReports', 'U') IS NULL
                SELECT CAST(NULL AS VARCHAR(20)) AS Status;
            ELSE
                SELECT Status
                FROM dbo.DailyCallReports
                WHERE UserId = @UserId
                  AND ReportDate = @ReportDate;
        `;
    },

    // The doctor must be mapped to the user.
    GET_MAPPED_DOCTOR: () => {
        return `
            SELECT
                doc.DoctorId,
                doc.DoctorName,
                TRY_CONVERT(UNIQUEIDENTIFIER, doc.TerritoryId) AS TerritoryId,
                TRY_CONVERT(UNIQUEIDENTIFIER, doc.AreaId) AS AreaId,
                doc.ClinicLatitude,
                doc.ClinicLongitude
            FROM dbo.UserDoctorMapping m
            INNER JOIN dbo.Doctor doc ON doc.DoctorId = m.DoctorId
            WHERE m.UserId = @UserId
              AND m.DoctorId = @DoctorId
              AND ISNULL(m.IsActive, 'Yes') <> 'No'
              AND ISNULL(doc.IsActive, 'Yes') <> 'No'
        `;
    },

    // The tour plan entry for that day, whatever the plan's approval status.
    GET_PLANNED_FOR_DATE: () => {
        return `
            SELECT TOP (1)
                REPLACE(d.DayType, '_', '-') AS DayType,
                d.TerritoryId,
                d.AreaId
            FROM dbo.TourPlan tp
            INNER JOIN dbo.TourPlanDetails d ON d.TourPlanId = tp.TourPlanId
            WHERE tp.UserId = @UserId
              AND tp.PlanMonth = @PlanMonth
              AND d.PlanDate = @PlanDate
        `;
    },

    // Reuse an existing deviation for the same day and location instead of duplicating it.
    FIND_DEVIATION: () => {
        return `
            SELECT TOP (1) DeviationId
            FROM dbo.TourPlanDeviation
            WHERE UserId = @UserId
              AND DeviationDate = @DeviationDate
              AND ActualTerritoryId = @ActualTerritoryId
              AND ((@ActualAreaId IS NULL AND ActualAreaId IS NULL) OR ActualAreaId = @ActualAreaId)
        `;
    },

    CREATE_VISIT: () => {
        return `
            INSERT INTO dbo.Visits (
                VisitId,
                UserId,
                DoctorId,
                VisitDate,
                StartTime,
                EndTime,
                JointWorkUserId,
                Feedback,
                Notes,
                FollowUpDate,
                LocationStatus,
                Latitude,
                Longitude,
                LocationAccuracy,
                LocationCapturedAt,
                PlannedTerritoryId,
                PlannedAreaId,
                PlanStatus,
                DeviationId,
                RecordedOffline,
                RecordedAt,
                CreatedOn,
                ModifiedOn,
                DistanceFromClinicM,
                GeofenceStatus,
                GeofenceReason,
                IsMockLocation,
                CheckInId,
                CheckInAt,
                CheckOutAt,
                CheckOutLatitude,
                CheckOutLongitude,
                CheckOutAccuracy,
                DwellSeconds,
                MotionActivity,
                InsideBoundary,
                HospitalId,
                Validity,
                InvalidReasons
            )
            VALUES (
                @VisitId,
                @UserId,
                @DoctorId,
                @VisitDate,
                @StartTime,
                @EndTime,
                @JointWorkUserId,
                @Feedback,
                @Notes,
                @FollowUpDate,
                @LocationStatus,
                @Latitude,
                @Longitude,
                @LocationAccuracy,
                @LocationCapturedAt,
                @PlannedTerritoryId,
                @PlannedAreaId,
                @PlanStatus,
                @DeviationId,
                @RecordedOffline,
                @RecordedAt,
                @CreatedOn,
                NULL,
                @DistanceFromClinicM,
                @GeofenceStatus,
                @GeofenceReason,
                @IsMockLocation,
                @CheckInId,
                @CheckInAt,
                @CheckOutAt,
                @CheckOutLatitude,
                @CheckOutLongitude,
                @CheckOutAccuracy,
                @DwellSeconds,
                @MotionActivity,
                @InsideBoundary,
                @HospitalId,
                @Validity,
                @InvalidReasons
            )
        `;
    },
};
