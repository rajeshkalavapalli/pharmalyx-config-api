// Counts rows that are not deactivated (IsActive may be 'Yes'/'No' text or a bit).
const active = (table) => `
    (SELECT COUNT(*) FROM ${table}
     WHERE ISNULL(CONVERT(VARCHAR(10), IsActive), 'Yes') NOT IN ('No', '0', 'false'))`;

const activeDoctor = `ISNULL(CONVERT(VARCHAR(10), d.IsActive), 'Yes') NOT IN ('No', '0', 'false')`;

module.exports = {
    // One round trip for every count on the Configuration page.
    GET_SUMMARY: () => {
        return `
            SELECT
                ${active('Division')} AS Divisions,
                ${active('Territory')} AS Territories,
                ${active('Areas')} AS Areas,
                (SELECT COUNT(*) FROM Users) AS Users,
                ${active('dbo.Doctor')} AS Doctors,
                ${active('Pharmacy')} AS Pharmacies,
                ${active('Stockist')} AS Stockists,

                (SELECT COUNT(DISTINCT UserId) FROM UserAreaMapping) AS UsersWithAreas,
                (SELECT COUNT(DISTINCT UserId) FROM UserDoctorMapping
                 WHERE ISNULL(IsActive, 'Yes') <> 'No') AS UsersWithDoctors,
                (SELECT COUNT(DISTINCT UserId) FROM UserPharmacyMapping
                 WHERE ISNULL(IsActive, 'Yes') <> 'No') AS UsersWithPharmacies,
                (SELECT COUNT(DISTINCT UserId) FROM UserStockistMapping
                 WHERE ISNULL(IsActive, 'Yes') <> 'No') AS UsersWithStockists,

                -- Setup checks
                (SELECT COUNT(*) FROM Users WHERE ManagerId IS NULL) AS UsersWithoutManager,
                (SELECT COUNT(*) FROM Users u
                 WHERE NOT EXISTS (SELECT 1 FROM UserAreaMapping m WHERE m.UserId = u.UserId)) AS UsersWithoutArea,
                (SELECT COUNT(*) FROM dbo.Doctor d
                 WHERE ${activeDoctor}
                   AND NOT EXISTS (SELECT 1 FROM UserDoctorMapping m
                                   WHERE m.DoctorId = d.DoctorId AND ISNULL(m.IsActive, 'Yes') <> 'No')) AS DoctorsUnassigned,
                (SELECT COUNT(*) FROM dbo.Doctor d
                 WHERE ${activeDoctor} AND d.Category IS NULL) AS DoctorsWithoutCategory
        `;
    },
};
