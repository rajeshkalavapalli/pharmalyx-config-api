module.exports = {
    GET_ENTRIES: () => {
        return `
            SELECT
                r.RcpaId,
                CONVERT(VARCHAR(10), r.AuditDate, 23) AS AuditDate,
                r.PharmacyId,
                ph.PharmacyName,
                r.DoctorId,
                d.DoctorName,
                d.Category,
                r.Remarks,
                r.CreatedOn
            FROM dbo.RcpaEntries r
            INNER JOIN dbo.Pharmacy ph ON ph.PharmacyId = r.PharmacyId
            INNER JOIN dbo.Doctor d ON d.DoctorId = r.DoctorId
            WHERE r.UserId = @UserId
              AND r.AuditDate BETWEEN @FromDate AND @ToDate
            ORDER BY r.AuditDate DESC, r.CreatedOn DESC
        `;
    },

    GET_LINES: () => {
        return `
            SELECT
                l.LineId,
                l.RcpaId,
                l.ProductId,
                p.ProductName,
                l.OurQuantity,
                l.CompetitorBrand,
                l.CompetitorCompany,
                l.CompetitorQuantity
            FROM dbo.RcpaLines l
            INNER JOIN dbo.RcpaEntries r ON r.RcpaId = l.RcpaId
            INNER JOIN dbo.Products p ON p.ProductId = l.ProductId
            WHERE r.UserId = @UserId
              AND r.AuditDate BETWEEN @FromDate AND @ToDate
        `;
    },

    // Chemists assigned to the user.
    GET_PHARMACIES: () => {
        return `
            SELECT ph.PharmacyId, ph.PharmacyName, ph.Address, t.TerritoryName, a.AreaName
            FROM dbo.UserPharmacyMapping m
            INNER JOIN dbo.Pharmacy ph ON ph.PharmacyId = m.PharmacyId
            LEFT JOIN Territory t ON t.TerritoryId = ph.TerritoryId
            LEFT JOIN Areas a ON a.AreaId = ph.AreaId
            WHERE m.UserId = @UserId
              AND ISNULL(m.IsActive, 'Yes') <> 'No'
              AND ISNULL(ph.IsActive, 'Yes') <> 'No'
            ORDER BY ph.PharmacyName
        `;
    },

    IS_PHARMACY_MAPPED: () => {
        return `
            SELECT 1 AS Found FROM dbo.UserPharmacyMapping
            WHERE UserId = @UserId AND PharmacyId = @PharmacyId AND ISNULL(IsActive, 'Yes') <> 'No'
        `;
    },

    IS_DOCTOR_MAPPED: () => {
        return `
            SELECT 1 AS Found FROM dbo.UserDoctorMapping
            WHERE UserId = @UserId AND DoctorId = @DoctorId AND ISNULL(IsActive, 'Yes') <> 'No'
        `;
    },

    GET_ACTIVE_PRODUCT_IDS: () => {
        return `SELECT ProductId FROM dbo.Products WHERE IsActive = 1`;
    },

    CREATE_ENTRY: () => {
        return `
            INSERT INTO dbo.RcpaEntries (RcpaId, UserId, AuditDate, PharmacyId, DoctorId, Remarks, CreatedOn)
            VALUES (@RcpaId, @UserId, @AuditDate, @PharmacyId, @DoctorId, @Remarks, @CreatedOn)
        `;
    },

    CREATE_LINE: () => {
        return `
            INSERT INTO dbo.RcpaLines (LineId, RcpaId, ProductId, OurQuantity, CompetitorBrand, CompetitorCompany, CompetitorQuantity)
            VALUES (@LineId, @RcpaId, @ProductId, @OurQuantity, @CompetitorBrand, @CompetitorCompany, @CompetitorQuantity)
        `;
    },
};
