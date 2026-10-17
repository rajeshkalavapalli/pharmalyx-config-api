const USER_NAME = (alias) => `COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(${alias}.FirstName, ' ', ${alias}.LastName))), ''), ${alias}.UserName)`;

const PLAN_COLUMNS = `
    dp.PlanId,
    dp.UserId,
    ${USER_NAME('u')} AS UserName,
    u.ManagerId,
    CONVERT(VARCHAR(10), dp.PlanMonth, 23) AS PlanMonth,
    dp.Status,
    dp.ReviewRemarks,
    dp.SubmittedOn,
    dp.ReviewedOn
`;

module.exports = {
    GET_PLAN: () => {
        return `
            SELECT ${PLAN_COLUMNS}
            FROM dbo.DoctorPlans dp
            INNER JOIN Users u ON u.UserId = dp.UserId
            WHERE dp.UserId = @UserId AND dp.PlanMonth = @Month
        `;
    },

    GET_PLAN_BY_ID: () => {
        return `
            SELECT ${PLAN_COLUMNS}
            FROM dbo.DoctorPlans dp
            INNER JOIN Users u ON u.UserId = dp.UserId
            WHERE dp.PlanId = @PlanId
        `;
    },

    GET_PLAN_DOCTORS: () => {
        return `
            SELECT pd.PlanDoctorId, pd.DoctorId, pd.PlannedVisits, pd.Support
            FROM dbo.DoctorPlanDoctors pd
            WHERE pd.PlanId = @PlanId
        `;
    },

    GET_PLAN_PRODUCTS: () => {
        return `
            SELECT pd.DoctorId, pp.ProductId, p.ProductName, pp.PlannedUnits
            FROM dbo.DoctorPlanProducts pp
            INNER JOIN dbo.DoctorPlanDoctors pd ON pd.PlanDoctorId = pp.PlanDoctorId
            INNER JOIN dbo.Products p ON p.ProductId = pp.ProductId
            WHERE pd.PlanId = @PlanId
        `;
    },

    GET_MY_DOCTORS: () => {
        return `
            SELECT d.DoctorId, d.DoctorName, d.Speciality, d.Category, d.VisitsPerMonth, a.AreaName
            FROM dbo.UserDoctorMapping m
            INNER JOIN dbo.Doctor d ON d.DoctorId = m.DoctorId
            LEFT JOIN Areas a ON a.AreaId = TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId)
            WHERE m.UserId = @UserId
              AND ISNULL(m.IsActive, 'Yes') <> 'No'
              AND ISNULL(d.IsActive, 'Yes') <> 'No'
            ORDER BY CASE d.Category WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END, d.DoctorName
        `;
    },

    IS_DOCTOR_MAPPED: () => {
        return `
            SELECT 1 AS Found FROM dbo.UserDoctorMapping
            WHERE UserId = @UserId AND DoctorId = @DoctorId AND ISNULL(IsActive, 'Yes') <> 'No'
        `;
    },

    GET_ORDERABLE_PRODUCTS: () => {
        return `SELECT ProductId, ProductName FROM dbo.Products WHERE IsActive = 1 ORDER BY ProductName`;
    },

    // ---------- Actuals for the month ----------

    GET_ACTUAL_VISITS: () => {
        return `
            SELECT v.DoctorId, COUNT(*) AS Visits
            FROM dbo.Visits v
            WHERE v.UserId = @UserId AND v.VisitDate BETWEEN @Month AND @MonthEnd
            GROUP BY v.DoctorId
        `;
    },

    // Rx units found at chemists (RCPA) for our products, per doctor.
    GET_RX_UNITS: () => {
        return `
            SELECT r.DoctorId, l.ProductId, p.ProductName, SUM(l.OurQuantity) AS Units
            FROM dbo.RcpaLines l
            INNER JOIN dbo.RcpaEntries r ON r.RcpaId = l.RcpaId
            INNER JOIN dbo.Products p ON p.ProductId = l.ProductId
            WHERE r.UserId = @UserId AND r.AuditDate BETWEEN @Month AND @MonthEnd
            GROUP BY r.DoctorId, l.ProductId, p.ProductName
        `;
    },

    GET_POB_UNITS: () => {
        return `
            SELECT o.DoctorId, l.ProductId, p.ProductName, SUM(l.Quantity) AS Units
            FROM dbo.OrderLines l
            INNER JOIN dbo.Orders o ON o.OrderId = l.OrderId
            INNER JOIN dbo.Products p ON p.ProductId = l.ProductId
            WHERE o.UserId = @UserId AND o.CustomerType = 'DOCTOR' AND o.Status <> 'CANCELLED'
              AND o.OrderDate BETWEEN @Month AND @MonthEnd
            GROUP BY o.DoctorId, l.ProductId, p.ProductName
        `;
    },

    // ---------- Writes ----------

    CREATE_PLAN: () => {
        return `
            INSERT INTO dbo.DoctorPlans (PlanId, UserId, PlanMonth, Status, CreatedOn, ModifiedOn)
            VALUES (@PlanId, @UserId, @Month, 'DRAFT', @Now, @Now)
        `;
    },

    // First statement of an item save: the plan must still be the MR's editable draft.
    LOCK_CHECK: () => {
        return `
            IF NOT EXISTS (SELECT 1 FROM dbo.DoctorPlans WHERE PlanId = @PlanId AND UserId = @UserId AND Status IN ('DRAFT', 'RETURNED'))
                THROW 50001, 'PLAN_LOCKED', 1;

            UPDATE dbo.DoctorPlans SET ModifiedOn = @Now WHERE PlanId = @PlanId;
        `;
    },

    DELETE_DOCTOR: () => {
        return `
            DELETE pp FROM dbo.DoctorPlanProducts pp
            INNER JOIN dbo.DoctorPlanDoctors pd ON pd.PlanDoctorId = pp.PlanDoctorId
            WHERE pd.PlanId = @PlanId AND pd.DoctorId = @DoctorId;

            DELETE FROM dbo.DoctorPlanDoctors WHERE PlanId = @PlanId AND DoctorId = @DoctorId;
        `;
    },

    INSERT_DOCTOR: () => {
        return `
            INSERT INTO dbo.DoctorPlanDoctors (PlanDoctorId, PlanId, DoctorId, PlannedVisits, Support, ModifiedOn)
            VALUES (@PlanDoctorId, @PlanId, @DoctorId, @PlannedVisits, @Support, @Now)
        `;
    },

    INSERT_PRODUCT: () => {
        return `
            INSERT INTO dbo.DoctorPlanProducts (PlanDoctorId, ProductId, PlannedUnits)
            VALUES (@PlanDoctorId, @ProductId, @PlannedUnits)
        `;
    },

    SUBMIT_PLAN: () => {
        return `
            UPDATE dbo.DoctorPlans
            SET Status = 'SUBMITTED', SubmittedOn = @Now, ModifiedOn = @Now
            WHERE PlanId = @PlanId AND UserId = @UserId AND Status IN ('DRAFT', 'RETURNED')
              AND EXISTS (SELECT 1 FROM dbo.DoctorPlanDoctors pd WHERE pd.PlanId = @PlanId)
        `;
    },

    REVIEW_PLAN: () => {
        return `
            UPDATE dbo.DoctorPlans
            SET Status = @Status, ReviewRemarks = @ReviewRemarks, ReviewedBy = @ReviewedBy, ReviewedOn = @Now, ModifiedOn = @Now
            WHERE PlanId = @PlanId AND Status = 'SUBMITTED'
        `;
    },

    GET_REVIEWS: () => {
        return `
            SELECT ${PLAN_COLUMNS},
                   (SELECT COUNT(*) FROM dbo.DoctorPlanDoctors pd WHERE pd.PlanId = dp.PlanId) AS Doctors,
                   (SELECT ISNULL(SUM(pd.PlannedVisits), 0) FROM dbo.DoctorPlanDoctors pd WHERE pd.PlanId = dp.PlanId) AS PlannedVisits,
                   (SELECT ISNULL(SUM(pp.PlannedUnits), 0) FROM dbo.DoctorPlanProducts pp
                    INNER JOIN dbo.DoctorPlanDoctors pd ON pd.PlanDoctorId = pp.PlanDoctorId WHERE pd.PlanId = dp.PlanId) AS PlannedUnits
            FROM dbo.DoctorPlans dp
            INNER JOIN Users u ON u.UserId = dp.UserId
            WHERE u.ManagerId = @UserId AND dp.Status = 'SUBMITTED'
            ORDER BY dp.SubmittedOn
        `;
    },

    HAS_TEAM: () => `SELECT TOP 1 1 AS Found FROM Users WHERE ManagerId = @UserId`,
};
