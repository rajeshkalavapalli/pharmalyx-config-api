module.exports = {
    GET_USER: () => {
        return `
            SELECT UserId, ManagerId
            FROM Users
            WHERE UserId = @UserId
        `;
    },

    // The acting user and their direct reports, for the "viewing" switch.
    GET_TEAM: () => {
        return `
            SELECT
                u.UserId,
                COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.FirstName, ' ', u.LastName))), ''), u.UserName) AS Name,
                u.UserName,
                sld.SystemLovDetailName AS DesignationName,
                CASE WHEN u.UserId = @ActingUserId THEN 1 ELSE 0 END AS IsSelf
            FROM Users u
            LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = u.DesignationId
            WHERE u.UserId = @ActingUserId
               OR u.ManagerId = @ActingUserId
            ORDER BY IsSelf DESC, Name
        `;
    },

    // Active doctors mapped to the user. Doctor.TerritoryId/AreaId are varchar,
    // so TRY_CONVERT keeps a bad value from failing the whole query.
    GET_MY_DOCTORS: () => {
        return `
            SELECT
                d.DoctorId,
                d.DoctorName,
                d.Qualification,
                d.Speciality,
                d.HospitalName,
                d.MobileNumber,
                d.EmailId,
                d.TerritoryId,
                t.TerritoryName,
                d.AreaId,
                a.AreaName,
                d.Category,
                d.VisitsPerMonth,
                CONVERT(VARCHAR(10), d.DateOfBirth, 23) AS DateOfBirth,
                CONVERT(VARCHAR(10), d.AnniversaryDate, 23) AS AnniversaryDate,
                m.CreatedOn AS AssignedOn,
                d.VerificationStatus,
                CONVERT(VARCHAR(10), d.VerificationDueOn, 23) AS VerificationDueOn,
                d.ClinicLatitude,
                d.ClinicLongitude,
                (SELECT TOP 1 SettingValue FROM dbo.AntiFraudSettings WHERE SettingKey = 'GEOFENCE_METERS') AS GeofenceMeters
            FROM dbo.UserDoctorMapping m
            INNER JOIN dbo.Doctor d ON d.DoctorId = m.DoctorId
            LEFT JOIN Territory t ON t.TerritoryId = TRY_CONVERT(UNIQUEIDENTIFIER, d.TerritoryId)
            LEFT JOIN Areas a ON a.AreaId = TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId)
            WHERE m.UserId = @UserId
              AND ISNULL(m.IsActive, 'Yes') <> 'No'
              AND ISNULL(d.IsActive, 'Yes') <> 'No'
            ORDER BY
                CASE d.Category WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END,
                d.DoctorName
        `;
    },
};
