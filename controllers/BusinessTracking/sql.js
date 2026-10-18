const { displayName } = require('../../utils/reportScope');

// Territories of a user: mapped territories plus the user's own territory column.
const USER_TERRITORIES = `
    SELECT TerritoryId FROM dbo.UserTerritoryMapping WHERE UserId = @UserId
    UNION SELECT TerritoryId FROM Users WHERE UserId = @UserId AND TerritoryId IS NOT NULL
`;

// Field people of a territory (people with nobody reporting to them, not administrators).
const TERRITORY_PEOPLE = `
    SELECT x.TerritoryId, COUNT(DISTINCT x.UserId) AS People
    FROM (
        SELECT UserId, TerritoryId FROM dbo.UserTerritoryMapping
        UNION SELECT UserId, TerritoryId FROM Users WHERE TerritoryId IS NOT NULL
    ) x
    INNER JOIN Users u ON u.UserId = x.UserId AND ISNULL(u.IsActive, 1) = 1
    LEFT JOIN Roles r ON r.RoleId = u.RoleId
    WHERE ISNULL(r.RoleName, '') <> 'Administrator'
      AND NOT EXISTS (SELECT 1 FROM Users rep WHERE rep.ManagerId = u.UserId AND ISNULL(rep.IsActive, 1) = 1)
      AND x.TerritoryId IN (SELECT TRY_CONVERT(UNIQUEIDENTIFIER, value) FROM OPENJSON(@Territories))
    GROUP BY x.TerritoryId
`;

const IN_TERRITORIES = (column) => `${column} IN (SELECT TRY_CONVERT(UNIQUEIDENTIFIER, value) FROM OPENJSON(@Territories))`;

module.exports = {
    USER_TERRITORIES: () => `SELECT t.TerritoryId, t.TerritoryName FROM Territory t WHERE t.TerritoryId IN (${USER_TERRITORIES})`,
    TERRITORY_PEOPLE: () => TERRITORY_PEOPLE,

    // ---------------------------------------------------------
    // Batches
    // ---------------------------------------------------------

    LIST_BATCHES: () => {
        return `
            SELECT b.BatchId, b.ProductId, p.ProductName, b.BatchNumber,
                   CONVERT(VARCHAR(10), b.MfgDate, 23) AS MfgDate, CONVERT(VARCHAR(10), b.ExpiryDate, 23) AS ExpiryDate, b.CreatedOn
            FROM dbo.ProductBatches b
            INNER JOIN dbo.Products p ON p.ProductId = b.ProductId
            WHERE (@ProductId IS NULL OR b.ProductId = @ProductId)
            ORDER BY p.ProductName, b.ExpiryDate DESC
        `;
    },

    PRODUCT_EXISTS: () => `SELECT 1 AS Found FROM dbo.Products WHERE ProductId = @ProductId`,

    INSERT_BATCH: () => {
        return `
            IF EXISTS (SELECT 1 FROM dbo.ProductBatches WHERE ProductId = @ProductId AND BatchNumber = @BatchNumber)
                THROW 50409, 'This batch number already exists for the product.', 1;
            INSERT INTO dbo.ProductBatches (BatchId, ProductId, BatchNumber, MfgDate, ExpiryDate, CreatedBy, CreatedOn)
            VALUES (@BatchId, @ProductId, @BatchNumber, @MfgDate, @ExpiryDate, @ActorId, @Now);
        `;
    },

    GET_BATCH: () => `SELECT BatchId, ProductId, BatchNumber, CONVERT(VARCHAR(10), ExpiryDate, 23) AS ExpiryDate FROM dbo.ProductBatches WHERE BatchId = @BatchId`,

    // ---------------------------------------------------------
    // Stockist <-> territory
    // ---------------------------------------------------------

    STOCKIST_TERRITORIES: () => {
        return `
            SELECT s.StockistId, s.StockistName,
                   (SELECT STRING_AGG(CONVERT(VARCHAR(36), st.TerritoryId), ',') FROM dbo.StockistTerritories st WHERE st.StockistId = s.StockistId AND st.RemovedOn IS NULL) AS TerritoryIds,
                   (SELECT STRING_AGG(t.TerritoryName, ', ') FROM dbo.StockistTerritories st INNER JOIN Territory t ON t.TerritoryId = st.TerritoryId WHERE st.StockistId = s.StockistId AND st.RemovedOn IS NULL) AS TerritoryNames
            FROM dbo.Stockist s
            WHERE ISNULL(s.IsActive, 'Yes') <> 'No'
            ORDER BY s.StockistName
        `;
    },

    TERRITORIES: () => `SELECT TerritoryId, TerritoryName FROM Territory WHERE ISNULL(IsActive, 1) = 1 ORDER BY TerritoryName`,

    STOCKIST_HAS_TERRITORY: () => `SELECT 1 AS Found FROM dbo.StockistTerritories WHERE StockistId = @StockistId AND TerritoryId = @TerritoryId AND RemovedOn IS NULL`,

    ADD_STOCKIST_TERRITORY: () => {
        return `
            IF EXISTS (SELECT 1 FROM dbo.StockistTerritories WHERE StockistId = @StockistId AND TerritoryId = @TerritoryId)
                UPDATE dbo.StockistTerritories SET RemovedOn = NULL WHERE StockistId = @StockistId AND TerritoryId = @TerritoryId;
            ELSE
                INSERT INTO dbo.StockistTerritories (StockistId, TerritoryId, CreatedOn) VALUES (@StockistId, @TerritoryId, @Now);
        `;
    },

    REMOVE_STOCKIST_TERRITORY: () => `UPDATE dbo.StockistTerritories SET RemovedOn = @Now WHERE StockistId = @StockistId AND TerritoryId = @TerritoryId AND RemovedOn IS NULL`,

    // ---------------------------------------------------------
    // Dispatch and returns
    // ---------------------------------------------------------

    LIST_DISPATCHES: () => {
        return `
            SELECT TOP 500 d.DispatchId, CONVERT(VARCHAR(10), d.DispatchDate, 23) AS DispatchDate, d.StockistId, s.StockistName, d.TerritoryId, t.TerritoryName,
                   d.ProductId, p.ProductName, d.BatchId, b.BatchNumber, CONVERT(VARCHAR(10), b.ExpiryDate, 23) AS ExpiryDate,
                   d.Quantity, d.Value, d.Remarks, ${displayName('cb')} AS CreatedByName, d.CreatedOn, d.VoidedOn, d.VoidReason
            FROM dbo.PrimaryDispatches d
            INNER JOIN dbo.Stockist s ON s.StockistId = d.StockistId
            INNER JOIN Territory t ON t.TerritoryId = d.TerritoryId
            INNER JOIN dbo.Products p ON p.ProductId = d.ProductId
            INNER JOIN dbo.ProductBatches b ON b.BatchId = d.BatchId
            LEFT JOIN Users cb ON cb.UserId = d.CreatedBy
            WHERE d.DispatchDate BETWEEN @From AND @To AND (@TerritoryId IS NULL OR d.TerritoryId = @TerritoryId)
            ORDER BY d.DispatchDate DESC, d.CreatedOn DESC
        `;
    },

    INSERT_DISPATCH: () => {
        return `
            INSERT INTO dbo.PrimaryDispatches (DispatchId, StockistId, TerritoryId, ProductId, BatchId, Quantity, Value, DispatchDate, Remarks, CreatedBy, CreatedOn)
            VALUES (@RecordId, @StockistId, @TerritoryId, @ProductId, @BatchId, @Quantity, @Value, @RecordDate, @Remarks, @ActorId, @Now)
        `;
    },

    LIST_RETURNS: () => {
        return `
            SELECT TOP 500 r.ReturnId, CONVERT(VARCHAR(10), r.ReturnDate, 23) AS ReturnDate, r.StockistId, s.StockistName, r.TerritoryId, t.TerritoryName,
                   r.ProductId, p.ProductName, r.BatchId, b.BatchNumber, CONVERT(VARCHAR(10), b.ExpiryDate, 23) AS ExpiryDate,
                   r.Quantity, r.Value, r.Reason, r.Remarks, ${displayName('cb')} AS CreatedByName, r.CreatedOn, r.VoidedOn, r.VoidReason
            FROM dbo.StockReturns r
            INNER JOIN dbo.Stockist s ON s.StockistId = r.StockistId
            INNER JOIN Territory t ON t.TerritoryId = r.TerritoryId
            INNER JOIN dbo.Products p ON p.ProductId = r.ProductId
            INNER JOIN dbo.ProductBatches b ON b.BatchId = r.BatchId
            LEFT JOIN Users cb ON cb.UserId = r.CreatedBy
            WHERE r.ReturnDate BETWEEN @From AND @To AND (@TerritoryId IS NULL OR r.TerritoryId = @TerritoryId)
            ORDER BY r.ReturnDate DESC, r.CreatedOn DESC
        `;
    },

    INSERT_RETURN: () => {
        return `
            INSERT INTO dbo.StockReturns (ReturnId, StockistId, TerritoryId, ProductId, BatchId, Quantity, Value, Reason, ReturnDate, Remarks, CreatedBy, CreatedOn)
            VALUES (@RecordId, @StockistId, @TerritoryId, @ProductId, @BatchId, @Quantity, @Value, @Reason, @RecordDate, @Remarks, @ActorId, @Now)
        `;
    },

    GET_DISPATCH: () => `SELECT * FROM dbo.PrimaryDispatches WHERE DispatchId = @RecordId`,
    GET_RETURN: () => `SELECT * FROM dbo.StockReturns WHERE ReturnId = @RecordId`,

    VOID_DISPATCH: () => {
        return `
            UPDATE dbo.PrimaryDispatches SET VoidedBy = @ActorId, VoidedOn = @Now, VoidReason = @Reason WHERE DispatchId = @RecordId AND VoidedOn IS NULL;
            IF @@ROWCOUNT = 0 THROW 50409, 'This dispatch was already voided.', 1;
        `;
    },

    VOID_RETURN: () => {
        return `
            UPDATE dbo.StockReturns SET VoidedBy = @ActorId, VoidedOn = @Now, VoidReason = @Reason WHERE ReturnId = @RecordId AND VoidedOn IS NULL;
            IF @@ROWCOUNT = 0 THROW 50409, 'This return was already voided.', 1;
        `;
    },

    // Per territory per month (voided records never count).
    DISPATCH_BY_MONTH: () => {
        return `
            SELECT TerritoryId, DATEFROMPARTS(YEAR(DispatchDate), MONTH(DispatchDate), 1) AS Month, SUM(Value) AS Value
            FROM dbo.PrimaryDispatches
            WHERE VoidedOn IS NULL AND ${IN_TERRITORIES('TerritoryId')} AND DispatchDate BETWEEN @From AND @To
            GROUP BY TerritoryId, DATEFROMPARTS(YEAR(DispatchDate), MONTH(DispatchDate), 1)
        `;
    },

    RETURNS_BY_MONTH: () => {
        return `
            SELECT TerritoryId, DATEFROMPARTS(YEAR(ReturnDate), MONTH(ReturnDate), 1) AS Month, Reason, SUM(Value) AS Value, SUM(Quantity) AS Quantity
            FROM dbo.StockReturns
            WHERE VoidedOn IS NULL AND ${IN_TERRITORIES('TerritoryId')} AND ReturnDate BETWEEN @From AND @To
            GROUP BY TerritoryId, DATEFROMPARTS(YEAR(ReturnDate), MONTH(ReturnDate), 1), Reason
        `;
    },

    // Batches at the territories' stockists that expire soon (still held: dispatched minus returned).
    NEAR_EXPIRY: () => {
        return `
            SELECT b.BatchId, b.BatchNumber, p.ProductName, CONVERT(VARCHAR(10), b.ExpiryDate, 23) AS ExpiryDate,
                   d.StockistId, s.StockistName, d.TerritoryId, t.TerritoryName,
                   SUM(d.Quantity) - ISNULL((SELECT SUM(r.Quantity) FROM dbo.StockReturns r
                                             WHERE r.VoidedOn IS NULL AND r.BatchId = d.BatchId AND r.StockistId = d.StockistId AND r.TerritoryId = d.TerritoryId), 0) AS Quantity,
                   DATEDIFF(DAY, @Today, b.ExpiryDate) AS DaysLeft
            FROM dbo.PrimaryDispatches d
            INNER JOIN dbo.ProductBatches b ON b.BatchId = d.BatchId
            INNER JOIN dbo.Products p ON p.ProductId = d.ProductId
            INNER JOIN dbo.Stockist s ON s.StockistId = d.StockistId
            INNER JOIN Territory t ON t.TerritoryId = d.TerritoryId
            WHERE d.VoidedOn IS NULL AND ${IN_TERRITORIES('d.TerritoryId')}
              AND b.ExpiryDate >= DATEADD(DAY, -30, @Today) AND b.ExpiryDate <= DATEADD(DAY, @Days, @Today)
            GROUP BY b.BatchId, b.BatchNumber, p.ProductName, b.ExpiryDate, d.BatchId, d.StockistId, s.StockistName, d.TerritoryId, t.TerritoryName
            HAVING SUM(d.Quantity) - ISNULL((SELECT SUM(r.Quantity) FROM dbo.StockReturns r
                                             WHERE r.VoidedOn IS NULL AND r.BatchId = d.BatchId AND r.StockistId = d.StockistId AND r.TerritoryId = d.TerritoryId), 0) > 0
            ORDER BY b.ExpiryDate
        `;
    },

    // ---------------------------------------------------------
    // People: joining, salary, allowances
    // ---------------------------------------------------------

    PEOPLE_COSTS: () => {
        return `
            SELECT u.UserId, ${displayName('u')} AS Name, r.RoleName, ${displayName('m')} AS ManagerName,
                   CONVERT(VARCHAR(10), COALESCE(ep.JoiningDate, CAST(u.CreatedOn AS DATE)), 23) AS JoiningDate, CASE WHEN ep.UserId IS NULL THEN 0 ELSE 1 END AS JoiningSet,
                   (SELECT TOP 1 MonthlySalary FROM dbo.SalaryHistory sh WHERE sh.UserId = u.UserId AND sh.EffectiveFrom <= @Today ORDER BY sh.EffectiveFrom DESC) AS MonthlySalary
            FROM Users u
            LEFT JOIN Roles r ON r.RoleId = u.RoleId
            LEFT JOIN Users m ON m.UserId = u.ManagerId
            LEFT JOIN dbo.EmployeeProfiles ep ON ep.UserId = u.UserId
            WHERE ISNULL(u.IsActive, 1) = 1
            ORDER BY Name
        `;
    },

    PROFILE: () => {
        return `
            SELECT u.UserId, ${displayName('u')} AS Name, CONVERT(VARCHAR(10), COALESCE(ep.JoiningDate, CAST(u.CreatedOn AS DATE)), 23) AS JoiningDate,
                   CASE WHEN ep.UserId IS NULL THEN 0 ELSE 1 END AS JoiningSet
            FROM Users u LEFT JOIN dbo.EmployeeProfiles ep ON ep.UserId = u.UserId
            WHERE u.UserId = @UserId
        `;
    },

    SET_JOINING: () => {
        return `
            IF EXISTS (SELECT 1 FROM dbo.EmployeeProfiles WHERE UserId = @UserId)
                UPDATE dbo.EmployeeProfiles SET JoiningDate = @JoiningDate, ModifiedBy = @ActorId, ModifiedOn = @Now WHERE UserId = @UserId;
            ELSE
                INSERT INTO dbo.EmployeeProfiles (UserId, JoiningDate, ModifiedBy, ModifiedOn) VALUES (@UserId, @JoiningDate, @ActorId, @Now);
        `;
    },

    SALARIES: () => `SELECT CONVERT(VARCHAR(10), EffectiveFrom, 23) AS EffectiveFrom, MonthlySalary FROM dbo.SalaryHistory WHERE UserId = @UserId ORDER BY EffectiveFrom`,

    ADD_SALARY: () => {
        return `
            IF EXISTS (SELECT 1 FROM dbo.SalaryHistory WHERE UserId = @UserId AND EffectiveFrom = @EffectiveFrom)
                THROW 50409, 'A salary already starts that month. Pick the next month for a change.', 1;
            INSERT INTO dbo.SalaryHistory (SalaryId, UserId, EffectiveFrom, MonthlySalary, CreatedBy, CreatedOn)
            VALUES (@SalaryId, @UserId, @EffectiveFrom, @MonthlySalary, @ActorId, @Now);
        `;
    },

    // TA / DA from the existing claims (the verified-work allowances).
    ALLOWANCES: () => {
        return `
            SELECT CONVERT(VARCHAR(10), ClaimMonth, 23) AS Month, DaTotal + TaTotal AS Allowances
            FROM dbo.ExpenseClaims WHERE UserId = @UserId AND ClaimMonth BETWEEN @From AND @To
        `;
    },

    // ---------------------------------------------------------
    // Milestones, slabs
    // ---------------------------------------------------------

    MILESTONES: () => `SELECT MilestoneId, MonthNumber, Metric, Target, IsActive FROM dbo.RampMilestones ORDER BY MonthNumber, Metric`,

    UPSERT_MILESTONE: () => {
        return `
            IF EXISTS (SELECT 1 FROM dbo.RampMilestones WHERE MilestoneId = @MilestoneId)
                UPDATE dbo.RampMilestones SET MonthNumber = @MonthNumber, Metric = @Metric, Target = @Target, IsActive = @IsActive, ModifiedBy = @ActorId, ModifiedOn = @Now
                WHERE MilestoneId = @MilestoneId;
            ELSE
                INSERT INTO dbo.RampMilestones (MilestoneId, MonthNumber, Metric, Target, IsActive, ModifiedBy, ModifiedOn)
                VALUES (@MilestoneId, @MonthNumber, @Metric, @Target, @IsActive, @ActorId, @Now);
        `;
    },

    SLABS: () => `SELECT SlabId, FromAmount, RatePercent FROM dbo.IncentiveSlabs WHERE RetiredOn IS NULL ORDER BY FromAmount`,

    // Slabs are replaced as a set; the old set is retired (kept), not deleted.
    RETIRE_SLABS: () => `UPDATE dbo.IncentiveSlabs SET RetiredOn = @Now WHERE RetiredOn IS NULL`,
    INSERT_SLAB: () => `INSERT INTO dbo.IncentiveSlabs (SlabId, FromAmount, RatePercent, ModifiedBy, ModifiedOn) VALUES (@SlabId, @FromAmount, @RatePercent, @ActorId, @Now)`,

    // ---------------------------------------------------------
    // Monthly review facts
    // ---------------------------------------------------------

    MAPPED_COUNTS: () => {
        return `
            SELECT
                (SELECT COUNT(*) FROM dbo.UserDoctorMapping WHERE UserId = @UserId AND ISNULL(IsActive, 'Yes') <> 'No') AS Doctors,
                (SELECT COUNT(*) FROM dbo.UserPharmacyMapping WHERE UserId = @UserId AND ISNULL(IsActive, 'Yes') <> 'No') AS Chemists
        `;
    },

    VALID_VISITS: () => {
        return `
            SELECT COUNT(*) AS ValidVisits FROM dbo.Visits v
            WHERE v.UserId = @UserId AND v.VisitDate BETWEEN @From AND @To AND COALESCE(v.ValidityOverride, v.Validity) = 'VALID'
        `;
    },

    POB_SUMMARY: () => {
        return `
            SELECT COUNT(*) AS Booked, ISNULL(SUM(NetAmount), 0) AS BookedValue,
                   SUM(CASE WHEN Status = 'SUPPLIED' THEN 1 ELSE 0 END) AS Supplied,
                   ISNULL(SUM(CASE WHEN Status = 'SUPPLIED' THEN NetAmount END), 0) AS SuppliedValue,
                   SUM(CASE WHEN VerifiedOn IS NOT NULL THEN 1 ELSE 0 END) AS Verified,
                   COUNT(DISTINCT PharmacyId) AS ChemistsOrdered,
                   COUNT(DISTINCT CASE WHEN Status = 'SUPPLIED' THEN PharmacyId END) AS ChemistsSupplied
            FROM dbo.Orders
            WHERE UserId = @UserId AND OrderDate BETWEEN @From AND @To AND Status <> 'CANCELLED'
        `;
    },

    USER_FLAGS: () => {
        return `
            SELECT f.FlagId, f.FlagType, f.Severity, f.Details, f.Status, f.CreatedOn
            FROM dbo.FraudFlags f
            WHERE f.UserId = @UserId AND f.CreatedOn >= @From AND f.CreatedOn < DATEADD(DAY, 1, CAST(@To AS DATE))
              AND f.FlagType LIKE 'POB_%'
            ORDER BY f.CreatedOn DESC
        `;
    },
};
