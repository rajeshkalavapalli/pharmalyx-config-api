const { SCOPE_CTE, displayName } = require('../../utils/reportScope');

// Doctors that still count for duplicate checks (not deactivated, rejected or merged).
const LIVE_DOCTOR = `ISNULL(d.IsActive, 'Yes') <> 'No' AND d.ApprovalStatus <> 'REJECTED' AND d.VerificationStatus NOT IN ('REJECTED', 'MERGED')`;

const DOCTOR_COLUMNS = `
    d.DoctorId, d.DoctorName, d.NormalizedName, d.Qualification, d.Speciality, d.HospitalName,
    d.MobileNumber, d.EmailId, d.RegistrationNumber, d.Category, d.VisitsPerMonth,
    d.TerritoryId, t.TerritoryName, d.AreaId, a.AreaName, d.CountryId, d.StateId,
    CONVERT(VARCHAR(10), d.DateOfBirth, 23) AS DateOfBirth, CONVERT(VARCHAR(10), d.AnniversaryDate, 23) AS AnniversaryDate,
    d.ClinicLatitude, d.ClinicLongitude, d.ClinicGpsAccuracy,
    d.VerificationStatus, d.ApprovalStatus, d.Source, d.IsActive,
    CONVERT(VARCHAR(10), d.VerificationDueOn, 23) AS VerificationDueOn, d.CreatedOn,
    ${displayName('cb')} AS CreatedByName,
    (SELECT TOP 1 CAST(e.EvidenceId AS VARCHAR(36)) FROM dbo.DoctorEvidence e WHERE e.DoctorId = d.DoctorId AND e.Kind = 'SIGNBOARD' ORDER BY e.CapturedAt DESC) AS SignboardId
`;

const DOCTOR_JOINS = `
    LEFT JOIN Territory t ON t.TerritoryId = TRY_CONVERT(UNIQUEIDENTIFIER, d.TerritoryId)
    LEFT JOIN Areas a ON a.AreaId = TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId)
    LEFT JOIN Users cb ON cb.UserId = d.CreatedBy
`;

module.exports = {
    // ---------------------------------------------------------
    // Lookups
    // ---------------------------------------------------------

    GET_SETTINGS: () => `SELECT SettingKey, SettingValue FROM dbo.AntiFraudSettings`,

    GET_USER: () => `SELECT UserId, ${displayName('u')} AS Name, ManagerId FROM Users u WHERE UserId = @UserId`,

    AREAS: () => {
        return `
            SELECT a.AreaId, a.AreaName, t.TerritoryId, t.TerritoryName
            FROM Areas a
            INNER JOIN Territory t ON t.TerritoryId = a.TerritoryId
            ORDER BY t.TerritoryName, a.AreaName
        `;
    },

    SPECIALITIES: () => {
        return `
            SELECT DISTINCT LTRIM(RTRIM(Speciality)) AS Speciality
            FROM dbo.Doctor
            WHERE Speciality IS NOT NULL AND LTRIM(RTRIM(Speciality)) <> ''
            ORDER BY 1
        `;
    },

    AREA_IN_TERRITORY: () => `SELECT 1 AS Found FROM Areas WHERE AreaId = @AreaId AND TerritoryId = @TerritoryId`,

    IS_MAPPED: () => {
        return `
            SELECT 1 AS Found FROM dbo.UserDoctorMapping
            WHERE UserId = @UserId AND DoctorId = @DoctorId AND ISNULL(IsActive, 'Yes') <> 'No'
        `;
    },

    GET_DOCTOR: () => `SELECT ${DOCTOR_COLUMNS} FROM dbo.Doctor d ${DOCTOR_JOINS} WHERE d.DoctorId = @DoctorId`,

    // ---------------------------------------------------------
    // Duplicate candidates
    // ---------------------------------------------------------

    // Doctors with a clinic location inside the box (exact distance is computed in Node).
    CANDIDATES_NEARBY: () => {
        return `
            SELECT ${DOCTOR_COLUMNS}
            FROM dbo.Doctor d ${DOCTOR_JOINS}
            WHERE ${LIVE_DOCTOR}
              AND (@ExcludeId IS NULL OR d.DoctorId <> @ExcludeId)
              AND d.ClinicLatitude BETWEEN @MinLat AND @MaxLat
              AND d.ClinicLongitude BETWEEN @MinLng AND @MaxLng
        `;
    },

    // Doctors without a clinic location yet (older records) in the same area.
    CANDIDATES_SAME_AREA: () => {
        return `
            SELECT ${DOCTOR_COLUMNS}
            FROM dbo.Doctor d ${DOCTOR_JOINS}
            WHERE ${LIVE_DOCTOR}
              AND (@ExcludeId IS NULL OR d.DoctorId <> @ExcludeId)
              AND d.ClinicLatitude IS NULL
              AND TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId) = @AreaId
        `;
    },

    CANDIDATES_PHONE: () => {
        return `
            SELECT ${DOCTOR_COLUMNS}
            FROM dbo.Doctor d ${DOCTOR_JOINS}
            WHERE ${LIVE_DOCTOR}
              AND (@ExcludeId IS NULL OR d.DoctorId <> @ExcludeId)
              AND RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(d.MobileNumber, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), 10) = @Phone
        `;
    },

    CANDIDATES_REGISTRATION: () => {
        return `
            SELECT ${DOCTOR_COLUMNS}
            FROM dbo.Doctor d ${DOCTOR_JOINS}
            WHERE ${LIVE_DOCTOR}
              AND (@ExcludeId IS NULL OR d.DoctorId <> @ExcludeId)
              AND REPLACE(REPLACE(REPLACE(REPLACE(UPPER(d.RegistrationNumber), ' ', ''), '-', ''), '/', ''), '.', '') = @Registration
        `;
    },

    // Every live doctor, for the one-off scan of existing data.
    ALL_LIVE_DOCTORS: () => `SELECT ${DOCTOR_COLUMNS} FROM dbo.Doctor d ${DOCTOR_JOINS} WHERE ${LIVE_DOCTOR}`,

    SET_NORMALIZED_NAME: () => `UPDATE dbo.Doctor SET NormalizedName = @NormalizedName WHERE DoctorId = @DoctorId`,

    INSERT_FLAG: () => {
        return `
            IF NOT EXISTS (SELECT 1 FROM dbo.DoctorDuplicateFlags
                           WHERE ((DoctorId = @DoctorId AND MatchDoctorId = @MatchDoctorId) OR (DoctorId = @MatchDoctorId AND MatchDoctorId = @DoctorId))
                             AND Reason = @Reason)
                INSERT INTO dbo.DoctorDuplicateFlags (FlagId, DoctorId, MatchDoctorId, Reason, Score, DistanceM, Status, CreatedOn)
                VALUES (@FlagId, @DoctorId, @MatchDoctorId, @Reason, @Score, @DistanceM, 'OPEN', @Now)
        `;
    },

    // Flags on a doctor (either side), with the other doctor's details.
    FLAGS_FOR_DOCTOR: () => {
        return `
            SELECT f.FlagId, f.Reason, f.Score, f.DistanceM, f.Status, f.ResolutionNote,
                   CASE WHEN f.DoctorId = @DoctorId THEN f.MatchDoctorId ELSE f.DoctorId END AS OtherDoctorId
            FROM dbo.DoctorDuplicateFlags f
            WHERE f.DoctorId = @DoctorId OR f.MatchDoctorId = @DoctorId
        `;
    },

    RESOLVE_DOCTOR_FLAGS: () => {
        return `
            UPDATE dbo.DoctorDuplicateFlags
            SET Status = @Status, ResolvedBy = @ActorId, ResolvedOn = @Now, ResolutionNote = @Note
            WHERE (DoctorId = @DoctorId OR MatchDoctorId = @DoctorId) AND Status = 'OPEN'
        `;
    },

    // Open flags visible to the acting user: doctors created by / assigned to someone in scope.
    LIST_FLAGS: () => {
        return `
            ${SCOPE_CTE},
            Visible AS (
                SELECT d.DoctorId FROM dbo.Doctor d WHERE @ViewAll = 1 OR d.CreatedBy IN (SELECT UserId FROM Scope)
                UNION
                SELECT m.DoctorId FROM dbo.UserDoctorMapping m INNER JOIN Scope s ON s.UserId = m.UserId WHERE ISNULL(m.IsActive, 'Yes') <> 'No'
            )
            SELECT f.FlagId, f.DoctorId, f.MatchDoctorId, f.Reason, f.Score, f.DistanceM, f.Status, f.CreatedOn,
                   f.ResolutionNote, f.ResolvedOn, ${displayName('rv')} AS ResolvedByName
            FROM dbo.DoctorDuplicateFlags f
            LEFT JOIN Users rv ON rv.UserId = f.ResolvedBy
            WHERE (f.DoctorId IN (SELECT DoctorId FROM Visible) OR f.MatchDoctorId IN (SELECT DoctorId FROM Visible))
              AND (@Status IS NULL OR f.Status = @Status)
            ORDER BY f.CreatedOn DESC
        `;
    },

    GET_FLAG: () => `SELECT FlagId, DoctorId, MatchDoctorId, Reason, Status FROM dbo.DoctorDuplicateFlags WHERE FlagId = @FlagId`,

    RESOLVE_FLAG: () => {
        return `
            UPDATE dbo.DoctorDuplicateFlags
            SET Status = @Status, ResolvedBy = @ActorId, ResolvedOn = @Now, ResolutionNote = @Note
            WHERE FlagId = @FlagId AND Status = 'OPEN'
        `;
    },

    // ---------------------------------------------------------
    // Requests
    // ---------------------------------------------------------

    CREATE_FIELD_DOCTOR: () => {
        return `
            INSERT INTO dbo.Doctor (
                DoctorId, DoctorName, NormalizedName, Qualification, Speciality, HospitalName, MobileNumber, EmailId,
                RegistrationNumber, TerritoryId, AreaId, Category, VisitsPerMonth, IsActive, CreatedOn, ModifiedOn,
                VerificationStatus, ApprovalStatus, Source, CreatedBy,
                ClinicLatitude, ClinicLongitude, ClinicGpsAccuracy, ClinicGpsCapturedAt, VerificationDueOn,
                CountryId, StateId, DateOfBirth, AnniversaryDate
            )
            VALUES (
                @DoctorId, @DoctorName, @NormalizedName, @Qualification, @Speciality, @HospitalName, @MobileNumber, @EmailId,
                @RegistrationNumber, @TerritoryId, @AreaId, @Category, @VisitsPerMonth, 'Yes', @Now, @Now,
                'PROVISIONAL', 'PENDING', 'FIELD', @CreatedBy,
                @Latitude, @Longitude, @Accuracy, @Now, @VerificationDueOn,
                @CountryId, @StateId, @DateOfBirth, @AnniversaryDate
            )
        `;
    },

    INSERT_EVIDENCE: () => {
        return `
            INSERT INTO dbo.DoctorEvidence (EvidenceId, DoctorId, Kind, StorageDriver, StorageKey, ContentType, SizeBytes, Latitude, Longitude, Accuracy, CapturedAt, UploadedBy)
            VALUES (@EvidenceId, @DoctorId, @Kind, @StorageDriver, @StorageKey, @ContentType, @SizeBytes, @Latitude, @Longitude, @Accuracy, @Now, @UploadedBy)
        `;
    },

    INSERT_REQUEST: () => {
        return `
            INSERT INTO dbo.DoctorRequests (RequestId, DoctorId, RequestType, RequestedBy, Comment, CurrentData, ProposedData, FlagsSnapshot, ApproverId, Status, CreatedOn)
            VALUES (@RequestId, @DoctorId, @RequestType, @RequestedBy, @Comment, @CurrentData, @ProposedData, @FlagsSnapshot, @ApproverId, 'PENDING', @Now)
        `;
    },

    PENDING_FOR_DOCTOR: () => `SELECT TOP 1 RequestId, RequestType FROM dbo.DoctorRequests WHERE DoctorId = @DoctorId AND Status = 'PENDING'`,

    // Inside the transaction: lock the doctor's requests so two requests can't both become pending.
    GUARD_NO_PENDING: () => {
        return `
            IF EXISTS (SELECT 1 FROM dbo.DoctorRequests WITH (UPDLOCK, HOLDLOCK) WHERE DoctorId = @DoctorId AND Status = 'PENDING')
                THROW 50409, 'There is already a pending request for this doctor.', 1;
        `;
    },

    // The request that was sent again after this rejected one (linked through FlagsSnapshot.resubmitOf).
    RESUBMISSION_OF: () => {
        return `
            SELECT TOP 1 RequestId, Status
            FROM dbo.DoctorRequests
            WHERE DoctorId = @DoctorId
              AND TRY_CONVERT(UNIQUEIDENTIFIER, CASE WHEN ISJSON(FlagsSnapshot) = 1 THEN JSON_VALUE(FlagsSnapshot, '$.resubmitOf.requestId') END) = @RequestId
        `;
    },

    GET_REQUEST: () => {
        return `
            SELECT r.*, ${displayName('rq')} AS RequestedByName, rq.ManagerId AS RequesterManagerId,
                   ${displayName('ap')} AS ApproverName, ${displayName('rv')} AS ReviewedByName
            FROM dbo.DoctorRequests r
            INNER JOIN Users rq ON rq.UserId = r.RequestedBy
            LEFT JOIN Users ap ON ap.UserId = rq.ManagerId
            LEFT JOIN Users rv ON rv.UserId = r.ReviewedBy
            WHERE r.RequestId = @RequestId
        `;
    },

    // Requests raised by anyone in scope, or waiting for the acting user.
    LIST_REQUESTS: () => {
        return `
            ${SCOPE_CTE}
            SELECT TOP 500
                r.RequestId, r.DoctorId, r.RequestType, r.RequestedBy, r.Comment, r.Status, r.CreatedOn,
                rq.ManagerId AS ApproverId, r.ReviewedOn, r.ReviewRemarks, r.FlagsSnapshot,
                ${displayName('rq')} AS RequestedByName, ${displayName('ap')} AS ApproverName, ${displayName('rv')} AS ReviewedByName,
                d.DoctorName, d.Speciality, a.AreaName, d.VerificationStatus
            FROM dbo.DoctorRequests r
            INNER JOIN Users rq ON rq.UserId = r.RequestedBy
            INNER JOIN dbo.Doctor d ON d.DoctorId = r.DoctorId
            LEFT JOIN Areas a ON a.AreaId = TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId)
            LEFT JOIN Users ap ON ap.UserId = rq.ManagerId
            LEFT JOIN Users rv ON rv.UserId = r.ReviewedBy
            WHERE (r.RequestedBy IN (SELECT UserId FROM Scope) OR rq.ManagerId = @ActingUserId OR (rq.ManagerId IS NULL AND @IsAdmin = 1))
              AND (@Status IS NULL OR r.Status = @Status)
            ORDER BY CASE WHEN r.Status = 'PENDING' THEN 0 ELSE 1 END, r.CreatedOn DESC
        `;
    },

    // Approvals inbox: pending requests waiting for this user.
    PENDING_FOR_APPROVER: () => {
        return `
            SELECT r.RequestId AS Id, r.RequestType, ${displayName('rq')} AS UserName, d.DoctorName, d.Speciality, a.AreaName,
                   r.Comment, r.FlagsSnapshot, r.CreatedOn AS SubmittedOn
            FROM dbo.DoctorRequests r
            INNER JOIN Users rq ON rq.UserId = r.RequestedBy
            INNER JOIN dbo.Doctor d ON d.DoctorId = r.DoctorId
            LEFT JOIN Areas a ON a.AreaId = TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId)
            WHERE r.Status = 'PENDING' AND (rq.ManagerId = @UserId OR (rq.ManagerId IS NULL AND @IsAdmin = 1))
        `;
    },

    // Guarded status change: fails the whole transaction if the request is no longer pending.
    DECIDE_REQUEST: () => {
        return `
            UPDATE dbo.DoctorRequests
            SET Status = @Status, ReviewedBy = @ActorId, ReviewedOn = @Now, ReviewRemarks = @Remarks
            WHERE RequestId = @RequestId AND Status = 'PENDING';

            IF @@ROWCOUNT = 0 THROW 50409, 'This request was already decided.', 1;
        `;
    },

    CANCEL_REQUEST: () => {
        return `
            UPDATE dbo.DoctorRequests
            SET Status = 'CANCELLED', ReviewedBy = @ActorId, ReviewedOn = @Now, ReviewRemarks = 'Cancelled by the requester'
            WHERE RequestId = @RequestId AND Status = 'PENDING' AND RequestedBy = @ActorId;

            IF @@ROWCOUNT = 0 THROW 50409, 'This request was already decided.', 1;
        `;
    },

    APPROVE_NEW_DOCTOR: () => `UPDATE dbo.Doctor SET ApprovalStatus = 'APPROVED', ModifiedOn = @Now WHERE DoctorId = @DoctorId`,

    REJECT_NEW_DOCTOR: () => {
        return `
            UPDATE dbo.Doctor
            SET ApprovalStatus = 'REJECTED', VerificationStatus = 'REJECTED', IsActive = 'No', ModifiedOn = @Now
            WHERE DoctorId = @DoctorId
        `;
    },

    // A rejected new doctor sent again: corrected details, back to pending. Guarded against a double send.
    RESUBMIT_NEW_DOCTOR: () => {
        return `
            UPDATE dbo.Doctor
            SET DoctorName = @DoctorName, NormalizedName = @NormalizedName, Qualification = @Qualification, Speciality = @Speciality,
                HospitalName = @HospitalName, MobileNumber = @MobileNumber, EmailId = @EmailId, RegistrationNumber = @RegistrationNumber,
                TerritoryId = @TerritoryId, AreaId = @AreaId, Category = @Category, VisitsPerMonth = @VisitsPerMonth,
                CountryId = @CountryId, StateId = @StateId, DateOfBirth = @DateOfBirth, AnniversaryDate = @AnniversaryDate,
                ClinicLatitude = CASE WHEN @MoveClinic = 1 THEN @Latitude ELSE ClinicLatitude END,
                ClinicLongitude = CASE WHEN @MoveClinic = 1 THEN @Longitude ELSE ClinicLongitude END,
                ClinicGpsAccuracy = CASE WHEN @MoveClinic = 1 THEN @Accuracy ELSE ClinicGpsAccuracy END,
                ClinicGpsCapturedAt = CASE WHEN @MoveClinic = 1 THEN @Now ELSE ClinicGpsCapturedAt END,
                IsActive = 'Yes', ApprovalStatus = 'PENDING', VerificationStatus = 'PROVISIONAL',
                VerificationDueOn = @VerificationDueOn, ModifiedOn = @Now
            WHERE DoctorId = @DoctorId AND ApprovalStatus = 'REJECTED';

            IF @@ROWCOUNT = 0 THROW 50409, 'This doctor was already sent again.', 1;
        `;
    },

    MAP_DOCTOR: () => {
        return `
            IF NOT EXISTS (SELECT 1 FROM dbo.UserDoctorMapping WHERE UserId = @UserId AND DoctorId = @DoctorId AND ISNULL(IsActive, 'Yes') <> 'No')
                INSERT INTO dbo.UserDoctorMapping (UserDoctorMappingId, UserId, DoctorId, IsActive, CreatedOn, ModifiedOn)
                VALUES (@MappingId, @UserId, @DoctorId, 'Yes', @Now, @Now)
        `;
    },

    DEACTIVATE_DOCTOR: () => `UPDATE dbo.Doctor SET IsActive = 'No', ModifiedOn = @Now WHERE DoctorId = @DoctorId`,

    // ---------------------------------------------------------
    // Evidence
    // ---------------------------------------------------------

    GET_EVIDENCE: () => {
        return `
            SELECT EvidenceId, DoctorId, Kind, StorageDriver, StorageKey, ContentType, SizeBytes, Latitude, Longitude, Accuracy, CapturedAt
            FROM dbo.DoctorEvidence WHERE EvidenceId = @EvidenceId
        `;
    },

    // Can the acting user see this doctor? (admin, assigned to someone in scope, created / requested by someone in scope, or approver)
    CAN_SEE_DOCTOR: () => {
        return `
            ${SCOPE_CTE}
            SELECT TOP 1 1 AS Found
            WHERE @ViewAll = 1
               OR EXISTS (SELECT 1 FROM dbo.UserDoctorMapping m INNER JOIN Scope s ON s.UserId = m.UserId
                          WHERE m.DoctorId = @DoctorId AND ISNULL(m.IsActive, 'Yes') <> 'No')
               OR EXISTS (SELECT 1 FROM dbo.Doctor d INNER JOIN Scope s ON s.UserId = d.CreatedBy WHERE d.DoctorId = @DoctorId)
               OR EXISTS (SELECT 1 FROM dbo.DoctorRequests r
                          WHERE r.DoctorId = @DoctorId AND (r.ApproverId = @ActingUserId OR r.RequestedBy IN (SELECT UserId FROM Scope)))
        `;
    },
};
