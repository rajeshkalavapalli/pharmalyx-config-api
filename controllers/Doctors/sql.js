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
};
