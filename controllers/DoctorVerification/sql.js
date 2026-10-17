const { SCOPE_CTE, displayName } = require('../../utils/reportScope');

// Doctors the acting user can see: assigned to (or created by) someone in their scope.
const VISIBLE_DOCTORS = `
    VisibleDoctors AS (
        SELECT m.DoctorId FROM dbo.UserDoctorMapping m INNER JOIN Scope s ON s.UserId = m.UserId WHERE ISNULL(m.IsActive, 'Yes') <> 'No'
        UNION
        SELECT d.DoctorId FROM dbo.Doctor d INNER JOIN Scope s ON s.UserId = d.CreatedBy
        UNION
        SELECT d.DoctorId FROM dbo.Doctor d WHERE @ViewAll = 1
    )
`;

const VERIFICATION_SELECT = `
    SELECT
        v.VerificationId, v.DoctorId, v.Method, v.Value, v.EvidenceId, v.VisitId, v.Status,
        v.SubmittedBy, v.SubmittedOn, v.ReviewedBy, v.ReviewedOn, v.ReviewRemarks,
        ${displayName('sb')} AS SubmittedByName, sb.ManagerId AS ApproverId, ${displayName('ap')} AS ApproverName,
        ${displayName('rv')} AS ReviewedByName,
        d.DoctorName, d.Speciality, d.MobileNumber, d.RegistrationNumber, d.VerificationStatus,
        CONVERT(VARCHAR(10), d.VerificationDueOn, 23) AS VerificationDueOn, a.AreaName
    FROM dbo.DoctorVerifications v
    INNER JOIN dbo.Doctor d ON d.DoctorId = v.DoctorId
    INNER JOIN Users sb ON sb.UserId = v.SubmittedBy
    LEFT JOIN Users ap ON ap.UserId = sb.ManagerId
    LEFT JOIN Users rv ON rv.UserId = v.ReviewedBy
    LEFT JOIN Areas a ON a.AreaId = TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId)
`;

module.exports = {
    GET_SETTINGS: () => `SELECT SettingKey, SettingValue FROM dbo.AntiFraudSettings`,

    GET_USER: () => `SELECT UserId, ManagerId FROM Users WHERE UserId = @UserId`,

    GET_DOCTOR: () => {
        return `
            SELECT d.DoctorId, d.DoctorName, d.Speciality, d.MobileNumber, d.RegistrationNumber, d.IsActive,
                   d.ApprovalStatus, d.VerificationStatus, CONVERT(VARCHAR(10), d.VerificationDueOn, 23) AS VerificationDueOn
            FROM dbo.Doctor d WHERE d.DoctorId = @DoctorId
        `;
    },

    // Assigned to the user, or added by them.
    IS_OWN_DOCTOR: () => {
        return `
            SELECT 1 AS Found WHERE EXISTS (
                SELECT 1 FROM dbo.UserDoctorMapping WHERE UserId = @UserId AND DoctorId = @DoctorId AND ISNULL(IsActive, 'Yes') <> 'No'
            ) OR EXISTS (SELECT 1 FROM dbo.Doctor WHERE DoctorId = @DoctorId AND CreatedBy = @UserId)
        `;
    },

    CAN_SEE_DOCTOR: () => {
        return `
            ${SCOPE_CTE}, ${VISIBLE_DOCTORS}
            SELECT 1 AS Found WHERE EXISTS (SELECT 1 FROM VisibleDoctors WHERE DoctorId = @DoctorId)
        `;
    },

    PENDING_FOR_DOCTOR: () => `SELECT TOP 1 VerificationId, Method FROM dbo.DoctorVerifications WHERE DoctorId = @DoctorId AND Status = 'PENDING'`,

    // Another live doctor already holding this registration / phone number.
    VALUE_CLASH: () => {
        return `
            SELECT TOP 1 d.DoctorId, d.DoctorName, a.AreaName
            FROM dbo.Doctor d
            LEFT JOIN Areas a ON a.AreaId = TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId)
            WHERE d.DoctorId <> @DoctorId
              AND ISNULL(d.IsActive, 'Yes') <> 'No' AND d.ApprovalStatus <> 'REJECTED' AND d.VerificationStatus NOT IN ('REJECTED', 'MERGED')
              AND (
                    (@Method = 'REGISTRATION_NO' AND REPLACE(REPLACE(REPLACE(REPLACE(UPPER(d.RegistrationNumber), ' ', ''), '-', ''), '/', ''), '.', '') = @Value)
                 OR (@Method = 'PHONE' AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(d.MobileNumber, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), 10) = @Value)
              )
        `;
    },

    // A visit to this doctor made by the manager, or with the manager as joint work, since @Since.
    MANAGER_VISIT: () => {
        return `
            SELECT TOP 1 v.VisitId, CONVERT(VARCHAR(10), v.VisitDate, 23) AS VisitDate, ${displayName('u')} AS VisitedBy
            FROM dbo.Visits v
            INNER JOIN Users u ON u.UserId = v.UserId
            WHERE v.DoctorId = @DoctorId AND v.VisitDate >= @Since
              AND (v.UserId = @ManagerId OR v.JointWorkUserId = @ManagerId)
            ORDER BY v.VisitDate DESC
        `;
    },

    INSERT_VERIFICATION: () => {
        return `
            INSERT INTO dbo.DoctorVerifications (VerificationId, DoctorId, Method, Value, EvidenceId, VisitId, SubmittedBy, SubmittedOn, Status, ReviewedBy, ReviewedOn, ReviewRemarks)
            VALUES (@VerificationId, @DoctorId, @Method, @Value, @EvidenceId, @VisitId, @SubmittedBy, @Now, @Status, @ReviewedBy, @ReviewedOn, @ReviewRemarks)
        `;
    },

    INSERT_EVIDENCE: () => {
        return `
            INSERT INTO dbo.DoctorEvidence (EvidenceId, DoctorId, Kind, StorageDriver, StorageKey, ContentType, SizeBytes, Latitude, Longitude, Accuracy, CapturedAt, UploadedBy)
            VALUES (@EvidenceId, @DoctorId, @Kind, @StorageDriver, @StorageKey, @ContentType, @SizeBytes, @Latitude, @Longitude, @Accuracy, @Now, @UploadedBy)
        `;
    },

    GET_VERIFICATION: () => `${VERIFICATION_SELECT} WHERE v.VerificationId = @VerificationId`,

    // Guarded decision: fails the transaction if it is no longer pending.
    DECIDE: () => {
        return `
            UPDATE dbo.DoctorVerifications
            SET Status = @Status, ReviewedBy = @ActorId, ReviewedOn = @Now, ReviewRemarks = @Remarks
            WHERE VerificationId = @VerificationId AND Status = 'PENDING';

            IF @@ROWCOUNT = 0 THROW 50409, 'This verification was already decided.', 1;
        `;
    },

    // Mark verified; fill the proven registration / phone number on the doctor when it is empty.
    MARK_VERIFIED: () => {
        return `
            UPDATE dbo.Doctor
            SET VerificationStatus = 'VERIFIED', VerifiedOn = @Now, VerifiedBy = @ActorId, VerificationMethod = @Method,
                RegistrationNumber = CASE WHEN @Method = 'REGISTRATION_NO' AND RegistrationNumber IS NULL THEN @Value ELSE RegistrationNumber END,
                MobileNumber = CASE WHEN @Method = 'PHONE' AND MobileNumber IS NULL THEN @Value ELSE MobileNumber END,
                ModifiedOn = @Now
            WHERE DoctorId = @DoctorId AND VerificationStatus = 'PROVISIONAL'
        `;
    },

    EXTEND_DEADLINE: () => {
        return `
            UPDATE dbo.Doctor SET VerificationDueOn = @DueOn, ModifiedOn = @Now
            WHERE DoctorId = @DoctorId AND VerificationStatus = 'PROVISIONAL'
        `;
    },

    // Provisional doctors in scope with their deadline and any pending proof.
    PROVISIONAL_DOCTORS: () => {
        return `
            ${SCOPE_CTE}, ${VISIBLE_DOCTORS}
            SELECT
                d.DoctorId, d.DoctorName, d.Speciality, d.Category, a.AreaName, d.Source,
                CONVERT(VARCHAR(10), d.VerificationDueOn, 23) AS VerificationDueOn,
                DATEDIFF(DAY, @Today, d.VerificationDueOn) AS DaysLeft,
                (SELECT STRING_AGG(${displayName('mu')}, ', ') FROM dbo.UserDoctorMapping m INNER JOIN Users mu ON mu.UserId = m.UserId
                 WHERE m.DoctorId = d.DoctorId AND ISNULL(m.IsActive, 'Yes') <> 'No') AS AssignedTo,
                (SELECT TOP 1 pv.Method FROM dbo.DoctorVerifications pv WHERE pv.DoctorId = d.DoctorId AND pv.Status = 'PENDING') AS PendingMethod,
                (SELECT TOP 1 rv.ReviewRemarks FROM dbo.DoctorVerifications rv WHERE rv.DoctorId = d.DoctorId AND rv.Status = 'REJECTED' ORDER BY rv.ReviewedOn DESC) AS LastRejection,
                CASE WHEN EXISTS (SELECT 1 FROM dbo.UserDoctorMapping m WHERE m.DoctorId = d.DoctorId AND m.UserId = @ActingUserId AND ISNULL(m.IsActive, 'Yes') <> 'No')
                       OR d.CreatedBy = @ActingUserId THEN 1 ELSE 0 END AS IsMine
            FROM dbo.Doctor d
            INNER JOIN VisibleDoctors vd ON vd.DoctorId = d.DoctorId
            LEFT JOIN Areas a ON a.AreaId = TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId)
            WHERE d.VerificationStatus = 'PROVISIONAL' AND d.ApprovalStatus = 'APPROVED' AND ISNULL(d.IsActive, 'Yes') <> 'No'
            ORDER BY d.VerificationDueOn, d.DoctorName
        `;
    },

    // Proofs submitted by someone in scope, or waiting for the acting user.
    LIST_VERIFICATIONS: () => {
        return `
            ${SCOPE_CTE}
            ${VERIFICATION_SELECT}
            WHERE (v.SubmittedBy IN (SELECT UserId FROM Scope) OR sb.ManagerId = @ActingUserId OR (sb.ManagerId IS NULL AND @IsAdmin = 1))
              AND (@Status IS NULL OR v.Status = @Status)
            ORDER BY CASE WHEN v.Status = 'PENDING' THEN 0 ELSE 1 END, v.SubmittedOn DESC
        `;
    },

    // Approvals inbox.
    PENDING_FOR_APPROVER: () => {
        return `
            ${VERIFICATION_SELECT}
            WHERE v.Status = 'PENDING' AND (sb.ManagerId = @UserId OR (sb.ManagerId IS NULL AND @IsAdmin = 1))
        `;
    },
};
