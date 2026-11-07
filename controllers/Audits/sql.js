const { displayName } = require('../../utils/reportScope');

// Joint audits: a senior (or, for a cross-audit, another manager / head office) checks that a rep's doctors are real
// by visiting a few of them, picked by the system and shown only to the auditor. Doctors are never asked anything.
module.exports = {
    // Confirmed joint days today where the acting user works with someone below them.
    JOINT_TODAY: () => `
        SELECT CASE WHEN j.UserId = @ActingUserId THEN j.ColleagueUserId ELSE j.UserId END AS RepId
        FROM dbo.JointWorkDays j
        WHERE j.WorkDate = @Today AND j.Status = 'CONFIRMED' AND (j.UserId = @ActingUserId OR j.ColleagueUserId = @ActingUserId)`,

    EXISTING_FOR_DAY: () => `SELECT AuditId FROM dbo.JointAudits WHERE UserId = @RepId AND AuditorId = @ActingUserId AND AuditDate = @Today`,

    // The rep's doctors with what makes each one worth checking. Doctors audited for this rep in the last 60 days are left out.
    CANDIDATES: () => `
        SELECT d.DoctorId, d.DoctorName, d.VerificationStatus, d.CreatedOn,
               (SELECT COUNT(*) FROM dbo.Visits v WHERE v.UserId = @RepId AND v.DoctorId = d.DoctorId AND v.VisitDate >= DATEADD(DAY, -90, @Today)) AS Visits90,
               (SELECT ISNULL(SUM(l.OurQuantity), 0) FROM dbo.RcpaEntries r INNER JOIN dbo.RcpaLines l ON l.RcpaId = r.RcpaId
                 WHERE r.DoctorId = d.DoctorId AND r.AuditDate >= DATEADD(DAY, -90, @Today)) AS RxUnits,
               (SELECT COUNT(*) FROM dbo.Visits v WHERE v.UserId = @RepId AND v.DoctorId = d.DoctorId AND v.VisitDate >= DATEADD(DAY, -30, @Today)
                   AND v.DwellSeconds IS NOT NULL AND v.DwellSeconds < 300) AS ShortVisits
        FROM dbo.UserDoctorMapping m
        INNER JOIN dbo.Doctor d ON d.DoctorId = m.DoctorId
        WHERE m.UserId = @RepId AND ISNULL(m.IsActive, 'Yes') <> 'No' AND ISNULL(d.IsActive, 'Yes') <> 'No'
          AND NOT EXISTS (SELECT 1 FROM dbo.JointAudits a WHERE a.UserId = @RepId AND a.DoctorId = d.DoctorId AND a.AuditDate >= DATEADD(DAY, -60, @Today))`,

    INSERT_AUDIT: () => `
        INSERT INTO dbo.JointAudits (AuditId, UserId, AuditorId, DoctorId, AuditDate, Kind, Reason, Status, AssignedBy, CreatedOn)
        VALUES (@AuditId, @UserId, @AuditorId, @DoctorId, @AuditDate, @Kind, @Reason, 'ASSIGNED', @AssignedBy, @Now)`,

    LIST: () => `
        SELECT a.AuditId, a.UserId, ${displayName('u')} AS RepName, a.AuditorId, ${displayName('au')} AS AuditorName,
               a.DoctorId, d.DoctorName, d.HospitalName, ar.AreaName, d.ClinicLatitude, d.ClinicLongitude,
               CONVERT(VARCHAR(10), a.AuditDate, 23) AS AuditDate, a.Kind, a.Reason, a.Status, a.CheckInAt, a.DistanceM,
               a.RepMatched, a.VerifiedBy, a.Notes, a.DecidedOn
        FROM dbo.JointAudits a
        INNER JOIN Users u ON u.UserId = a.UserId
        INNER JOIN Users au ON au.UserId = a.AuditorId
        INNER JOIN dbo.Doctor d ON d.DoctorId = a.DoctorId
        LEFT JOIN Areas ar ON ar.AreaId = d.AreaId`,

    GET: () => `SELECT a.*, d.ClinicLatitude, d.ClinicLongitude, d.DoctorName FROM dbo.JointAudits a INNER JOIN dbo.Doctor d ON d.DoctorId = a.DoctorId WHERE a.AuditId = @AuditId`,

    // Did the rep also check in at this doctor around the auditor's check-in? (joint visit really together)
    REP_NEAR: () => `
        SELECT TOP 1 1 AS Found FROM dbo.VisitCheckIns c
        WHERE c.UserId = @RepId AND c.DoctorId = @DoctorId AND c.CheckInAt BETWEEN DATEADD(MINUTE, -60, @At) AND DATEADD(MINUTE, 60, @At)`,

    CHECK_IN: () => `
        UPDATE dbo.JointAudits
        SET CheckInAt = @Now, Latitude = @Latitude, Longitude = @Longitude, Accuracy = @Accuracy, DistanceM = @DistanceM, VerifiedBy = @VerifiedBy, ModifiedOn = @Now
        WHERE AuditId = @AuditId AND AuditorId = @ActingUserId AND Status = 'ASSIGNED'`,

    DECIDE: () => `
        UPDATE dbo.JointAudits
        SET Status = @Status, RepMatched = @RepMatched, Notes = @Notes, DecidedOn = @Now, ModifiedOn = @Now
        WHERE AuditId = @AuditId AND AuditorId = @ActingUserId AND Status = 'ASSIGNED'`,

    // A rep's audit results this month and overall (for the Truth Score).
    SUMMARY_FOR: () => `
        SELECT a.UserId,
               SUM(CASE WHEN a.Status = 'PASSED' THEN 1 ELSE 0 END) AS Passed,
               SUM(CASE WHEN a.Status IN ('DOCTOR_NOT_FOUND', 'CLINIC_NOT_FOUND', 'NOT_RECOGNISED') THEN 1 ELSE 0 END) AS Failed,
               SUM(CASE WHEN a.Status = 'ASSIGNED' AND a.AuditDate < @Today THEN 1 ELSE 0 END) AS Skipped
        FROM dbo.JointAudits a
        WHERE a.AuditDate >= @From
        GROUP BY a.UserId`,
};
