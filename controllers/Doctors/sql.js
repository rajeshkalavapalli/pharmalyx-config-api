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
                @IsActive,
                @CreatedOn,
                @ModifiedOn
            )
        `;
    },

    GET_DOCTORS: () => {
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
                d.IsActive,
                d.CreatedOn,
                d.ModifiedOn,
                a.AreaName,
                t.TerritoryName
            FROM dbo.Doctor d
            LEFT JOIN Areas a ON a.AreaId = d.AreaId
            LEFT JOIN Territory t ON t.TerritoryId = d.TerritoryId
            ORDER BY d.CreatedOn DESC
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
                IsActive = @IsActive,
                ModifiedOn = @ModifiedOn
            WHERE DoctorId = @DoctorId
        `;
    }
};
