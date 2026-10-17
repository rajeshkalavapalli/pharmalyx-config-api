const { SCOPE_CTE } = require('../../utils/reportScope');

// Doctor assigned to (or added by) someone in Scope(UserId).
const IN_TEAM = `(
    EXISTS (SELECT 1 FROM dbo.UserDoctorMapping m INNER JOIN Scope s ON s.UserId = m.UserId
            WHERE m.DoctorId = d.DoctorId AND ISNULL(m.IsActive, 'Yes') <> 'No')
    OR EXISTS (SELECT 1 FROM Scope s WHERE s.UserId = d.CreatedBy)
)`;

module.exports = {
    CREATE_DOCTOR: () => {
        return `
            INSERT INTO dbo.Doctor (
                DoctorId,
                DoctorName,
                Qualification,
                Speciality,
                HospitalName,
                MobileNumber,
                EmailId,
                CountryId,
                StateId,
                TerritoryId,
                AreaId,
                Category,
                VisitsPerMonth,
                DateOfBirth,
                AnniversaryDate,
                IsActive,
                CreatedOn,
                ModifiedOn
            ) VALUES (
                @DoctorId,
                @DoctorName,
                @Qualification,
                @Speciality,
                @HospitalName,
                @MobileNumber,
                @EmailId,
                @CountryId,
                @StateId,
                @TerritoryId,
                @AreaId,
                @Category,
                @VisitsPerMonth,
                @DateOfBirth,
                @AnniversaryDate,
                @IsActive,
                @CreatedOn,
                @ModifiedOn
            )
        `;
    },

    // scoped: only doctors assigned to, or added by, the acting user or their team (needs @ActingUserId, @ViewAll).
    GET_DOCTORS: (scoped = false) => {
        return `
            ${scoped ? SCOPE_CTE : ''}
            SELECT
                d.DoctorId,
                d.DoctorName,
                d.Qualification,
                d.Speciality,
                d.HospitalName,
                d.MobileNumber,
                d.EmailId,
                d.CountryId,
                d.StateId,
                d.TerritoryId,
                d.AreaId,
                d.Category,
                d.VisitsPerMonth,
                CONVERT(VARCHAR(10), d.DateOfBirth, 23) AS DateOfBirth,
                CONVERT(VARCHAR(10), d.AnniversaryDate, 23) AS AnniversaryDate,
                d.IsActive,
                d.CreatedOn,
                d.ModifiedOn,
                a.AreaName,
                t.TerritoryName,
                d.ApprovalStatus,
                ${scoped
                    ? `CASE WHEN EXISTS (SELECT 1 FROM dbo.UserDoctorMapping me
                                         WHERE me.DoctorId = d.DoctorId AND me.UserId = @ActingUserId AND ISNULL(me.IsActive, 'Yes') <> 'No')
                            THEN 1 ELSE 0 END`
                    : '1'} AS IsMine
            FROM dbo.Doctor d
            LEFT JOIN Areas a ON a.AreaId = d.AreaId
            LEFT JOIN Territory t ON t.TerritoryId = d.TerritoryId
            ${scoped ? `WHERE ${IN_TEAM}` : ''}
            ORDER BY d.CreatedOn DESC
        `;
    },
    DOCTOR_IN_SCOPE: () => {
        return `
            ${SCOPE_CTE}
            SELECT TOP 1 1 AS Found FROM dbo.Doctor d WHERE d.DoctorId = @DoctorId AND ${IN_TEAM}
        `;
    },

    GET_DOCTOR_BY_ID: () => {
        return `
            SELECT
                d.DoctorId,
                d.DoctorName,
                d.Qualification,
                d.Speciality,
                d.HospitalName,
                d.MobileNumber,
                d.EmailId,
                d.CountryId,
                d.StateId,
                d.TerritoryId,
                d.AreaId,
                d.Category,
                d.VisitsPerMonth,
                CONVERT(VARCHAR(10), d.DateOfBirth, 23) AS DateOfBirth,
                CONVERT(VARCHAR(10), d.AnniversaryDate, 23) AS AnniversaryDate,
                d.IsActive,
                d.CreatedOn,
                d.ModifiedOn,
                a.AreaName,
                t.TerritoryName
            FROM dbo.Doctor d
            LEFT JOIN Areas a ON a.AreaId = d.AreaId
            LEFT JOIN Territory t ON t.TerritoryId = d.TerritoryId
            WHERE d.DoctorId = @DoctorId
        `;
    },
    DEACTIVATE_DOCTOR: () => {
    return `
        UPDATE dbo.Doctor
        SET
            IsActive = 'No',
            ModifiedOn = GETDATE()
        WHERE DoctorId = @DoctorId
    `;
},
    UPDATE_DOCTOR: () => {
        return `
            UPDATE dbo.Doctor
            SET
                DoctorName = @DoctorName,
                Qualification = @Qualification,
                Speciality = @Speciality,
                HospitalName = @HospitalName,
                MobileNumber = @MobileNumber,
                EmailId = @EmailId,
                CountryId = @CountryId,
                StateId = @StateId,
                TerritoryId = @TerritoryId,
                AreaId = @AreaId,
                Category = @Category,
                VisitsPerMonth = @VisitsPerMonth,
                DateOfBirth = @DateOfBirth,
                AnniversaryDate = @AnniversaryDate,
                IsActive = @IsActive,
                ModifiedOn = @ModifiedOn
            WHERE DoctorId = @DoctorId
        `;
    }
};
