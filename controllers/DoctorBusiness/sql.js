module.exports = {
    // Every assigned doctor, with this month's and last month's business (if any).
    GET_MONTH: () => {
        return `
            SELECT
                d.DoctorId,
                d.DoctorName,
                d.Speciality,
                d.HospitalName,
                d.Category,
                cur.EntryId,
                cur.ExpectedValue,
                cur.ActualValue,
                cur.Remarks,
                prev.ActualValue AS PreviousActual
            FROM dbo.UserDoctorMapping m
            INNER JOIN dbo.Doctor d ON d.DoctorId = m.DoctorId
            LEFT JOIN dbo.DoctorBusiness cur
                ON cur.UserId = m.UserId AND cur.DoctorId = d.DoctorId AND cur.BusinessMonth = @BusinessMonth
            LEFT JOIN dbo.DoctorBusiness prev
                ON prev.UserId = m.UserId AND prev.DoctorId = d.DoctorId AND prev.BusinessMonth = @PreviousMonth
            WHERE m.UserId = @UserId
              AND ISNULL(m.IsActive, 'Yes') <> 'No'
              AND ISNULL(d.IsActive, 'Yes') <> 'No'
            ORDER BY CASE d.Category WHEN 'A' THEN 0 WHEN 'B' THEN 1 WHEN 'C' THEN 2 ELSE 3 END, d.DoctorName
        `;
    },

    // Monthly totals for the trend strip.
    GET_HISTORY: () => {
        return `
            SELECT
                CONVERT(VARCHAR(10), BusinessMonth, 23) AS BusinessMonth,
                SUM(ExpectedValue) AS Expected,
                SUM(ISNULL(ActualValue, 0)) AS Actual
            FROM dbo.DoctorBusiness
            WHERE UserId = @UserId AND BusinessMonth BETWEEN @FromMonth AND @ToMonth
            GROUP BY BusinessMonth
            ORDER BY BusinessMonth
        `;
    },

    IS_DOCTOR_MAPPED: () => {
        return `
            SELECT 1 AS Found FROM dbo.UserDoctorMapping
            WHERE UserId = @UserId AND DoctorId = @DoctorId AND ISNULL(IsActive, 'Yes') <> 'No'
        `;
    },

    UPSERT: () => {
        return `
            UPDATE dbo.DoctorBusiness
            SET ExpectedValue = @ExpectedValue,
                ActualValue = @ActualValue,
                Remarks = @Remarks,
                ModifiedOn = @Now
            WHERE UserId = @UserId AND DoctorId = @DoctorId AND BusinessMonth = @BusinessMonth;

            IF @@ROWCOUNT = 0
                INSERT INTO dbo.DoctorBusiness (
                    EntryId, UserId, DoctorId, BusinessMonth, ExpectedValue, ActualValue, Remarks, CreatedOn
                )
                VALUES (
                    @EntryId, @UserId, @DoctorId, @BusinessMonth, @ExpectedValue, @ActualValue, @Remarks, @Now
                );
        `;
    },
};
