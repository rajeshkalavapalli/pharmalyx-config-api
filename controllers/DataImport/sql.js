// Data Import queries. Bulk writes take a JSON array (@Rows) and read it with OPENJSON,
// so thousands of rows go in one statement instead of one round trip each.
const DESIGNATION_LOV = '0E68E775-640D-4444-AEB9-939E1C9413C0';

module.exports = {
    // ---------- lookups ----------
    LIST_STATES: () => `SELECT StateId AS id, StateName AS name, StateCode AS code, CountryId FROM dbo.state WHERE ISNULL(IsActive, 1) = 1`,
    LIST_DIVISIONS: () => `SELECT DivisionId AS id, DivisionName AS name FROM dbo.Division WHERE IsActive = 1`,
    LIST_DESIGNATIONS: () => `
        SELECT SystemLovDetailId AS id, SystemLovDetailName AS name, SystemLovDetailCode AS code
        FROM dbo.SystemLovDetails WHERE SystemLovId = '${DESIGNATION_LOV}' AND ISNULL(IsActive, 1) = 1`,
    LIST_ROLES: () => `SELECT RoleId AS id, RoleName AS name, RoleCode AS code FROM dbo.Roles WHERE IsActive = 1`,
    LIST_TERRITORIES: () => `
        SELECT t.TerritoryId AS id, t.TerritoryName AS name, t.StateId, s.CountryId
        FROM dbo.Territory t LEFT JOIN dbo.state s ON s.StateId = t.StateId`,
    LIST_AREAS: () => `
        SELECT a.AreaId AS id, a.AreaName AS name, a.AreaCode AS code, a.TerritoryId, t.TerritoryName
        FROM dbo.Areas a LEFT JOIN dbo.Territory t ON t.TerritoryId = a.TerritoryId`,
    LIST_USERS: () => `
        SELECT UserId AS id, UserName, EmailId, LTRIM(CONCAT(FirstName, ' ', LastName)) AS fullName, ManagerId
        FROM dbo.Users`,
    LIST_DOCTORS: () => `
        SELECT DoctorId AS id, DoctorName AS name, NormalizedName, Speciality, MobileNumber, RegistrationNumber, TerritoryId
        FROM dbo.Doctor WHERE ISNULL(IsActive, 'Yes') <> 'No' AND MergedIntoDoctorId IS NULL`,
    LIST_PHARMACIES: () => `SELECT PharmacyId AS id, PharmacyName AS name, GSTIN, DrugLicenceNumber, ContactNumber, AreaId FROM dbo.Pharmacy`,
    LIST_STOCKISTS: () => `SELECT StockistId AS id, StockistName AS name, GSTIN, DrugLicenceNumber, ContactNumber, AreaId FROM dbo.Stockist`,
    // Stock & sales statements.
    LIST_PRODUCTS: () => `SELECT ProductId AS id, ProductName AS name, UnitPrice, IsSample FROM dbo.Products`,
    LIST_STATEMENTS: () => `SELECT StockistId, CONVERT(VARCHAR(10), StatementMonth, 23) AS StatementMonth, Status FROM dbo.SecondaryStatements`,
    // The MR a stockist is assigned to (owns its statements); the earliest active assignment.
    LIST_STOCKIST_OWNERS: () => `
        SELECT m.StockistId, m.UserId
        FROM dbo.UserStockistMapping m
        WHERE ISNULL(m.IsActive, 'Yes') <> 'No'
          AND m.CreatedOn = (SELECT MIN(x.CreatedOn) FROM dbo.UserStockistMapping x WHERE x.StockistId = m.StockistId AND ISNULL(x.IsActive, 'Yes') <> 'No')`,
    // Optional columns added by later database scripts.
    FEATURES: () => `SELECT CASE WHEN COL_LENGTH('dbo.Doctor', 'ClinicAddress') IS NULL THEN 0 ELSE 1 END AS clinicAddress`,
    LIST_LINKS: () => `SELECT LegacyCode, EntityId FROM dbo.ImportLinks WHERE EntityType = @EntityType`,

    // ---------- batches ----------
    INSERT_BATCH: () => `
        INSERT INTO dbo.ImportBatches (BatchId, EntityType, SourceSystem, FileName, Status, TotalRows, Headers, ColumnMap, ValueMap, Options, CreatedBy, CreatedOn)
        VALUES (@BatchId, @EntityType, @SourceSystem, @FileName, 'UPLOADED', @TotalRows, @Headers, @ColumnMap, '{}', @Options, @CreatedBy, @Now)`,
    INSERT_ROWS: () => `
        INSERT INTO dbo.ImportRows (BatchId, RowNumber, RawData, Status)
        SELECT @BatchId, j.RowNumber, j.RawData, 'NEW'
        FROM OPENJSON(@Rows) WITH (RowNumber INT, RawData NVARCHAR(MAX) AS JSON) j`,
    GET_BATCH: () => `
        SELECT b.*, LTRIM(CONCAT(u.FirstName, ' ', u.LastName)) AS CreatedByName
        FROM dbo.ImportBatches b LEFT JOIN dbo.Users u ON u.UserId = b.CreatedBy
        WHERE b.BatchId = @BatchId`,
    LIST_BATCHES: () => `
        SELECT TOP 100 b.BatchId, b.EntityType, b.SourceSystem, b.FileName, b.Status, b.TotalRows, b.Summary,
               b.CreatedOn, b.ImportedOn, b.UndoneOn, LTRIM(CONCAT(u.FirstName, ' ', u.LastName)) AS CreatedByName
        FROM dbo.ImportBatches b LEFT JOIN dbo.Users u ON u.UserId = b.CreatedBy
        WHERE b.Status <> 'CANCELLED'
        ORDER BY b.CreatedOn DESC`,
    // Column matching used last time for the same previous app.
    LAST_COLUMN_MAP: () => `
        SELECT TOP 1 ColumnMap, ValueMap FROM dbo.ImportBatches
        WHERE EntityType = @EntityType AND SourceSystem = @SourceSystem AND Status IN ('CHECKED', 'IMPORTED', 'UNDONE')
        ORDER BY CreatedOn DESC`,
    LIST_ROWS: () => `SELECT RowNumber, RawData, Status, Messages, Decision, MatchEntityId, Action, EntityId FROM dbo.ImportRows WHERE BatchId = @BatchId ORDER BY RowNumber`,
    SAVE_MAPS: () => `UPDATE dbo.ImportBatches SET ColumnMap = @ColumnMap, ValueMap = @ValueMap, Options = @Options, SourceSystem = @SourceSystem WHERE BatchId = @BatchId`,
    SAVE_CHECK: () => `
        UPDATE r SET r.Status = j.Status, r.Messages = j.Messages, r.MatchEntityId = j.MatchEntityId
        FROM dbo.ImportRows r
        INNER JOIN OPENJSON(@Rows) WITH (RowNumber INT, Status VARCHAR(10), Messages NVARCHAR(MAX) AS JSON, MatchEntityId UNIQUEIDENTIFIER) j
            ON j.RowNumber = r.RowNumber
        WHERE r.BatchId = @BatchId`,
    SAVE_DECISIONS: () => `
        UPDATE r SET r.Decision = j.Decision
        FROM dbo.ImportRows r
        INNER JOIN OPENJSON(@Rows) WITH (RowNumber INT, Decision VARCHAR(10)) j ON j.RowNumber = r.RowNumber
        WHERE r.BatchId = @BatchId`,
    MARK_CHECKED: () => `UPDATE dbo.ImportBatches SET Status = 'CHECKED', Summary = @Summary, CheckedOn = @Now WHERE BatchId = @BatchId AND Status IN ('UPLOADED', 'CHECKED')`,
    RETYPE_BATCH: () => `
        UPDATE dbo.ImportBatches SET EntityType = @EntityType, ColumnMap = @ColumnMap, ValueMap = '{}', Options = @Options, Status = 'UPLOADED', Summary = NULL
        WHERE BatchId = @BatchId AND Status IN ('UPLOADED', 'CHECKED');
        UPDATE dbo.ImportRows SET Status = 'NEW', Messages = NULL, Decision = NULL, MatchEntityId = NULL WHERE BatchId = @BatchId;`,
    CANCEL_BATCH: () => `UPDATE dbo.ImportBatches SET Status = 'CANCELLED' WHERE BatchId = @BatchId AND Status IN ('UPLOADED', 'CHECKED')`,

    // ---------- import ----------
    // Claims the batch so two clicks can't import it twice.
    CLAIM_BATCH: () => `
        UPDATE dbo.ImportBatches SET Status = 'IMPORTED', ImportedBy = @ActorId, ImportedOn = @Now, Summary = @Summary
        WHERE BatchId = @BatchId AND Status = 'CHECKED';
        IF @@ROWCOUNT = 0 THROW 50409, 'This import has already run or was changed. Refresh and check it again.', 1;`,
    SAVE_RESULTS: () => `
        UPDATE r SET r.Status = j.Status, r.Action = j.Action, r.EntityId = j.EntityId, r.PreviousData = j.PreviousData
        FROM dbo.ImportRows r
        INNER JOIN OPENJSON(@Rows) WITH (RowNumber INT, Status VARCHAR(10), Action VARCHAR(10), EntityId UNIQUEIDENTIFIER, PreviousData NVARCHAR(MAX) AS JSON) j
            ON j.RowNumber = r.RowNumber
        WHERE r.BatchId = @BatchId`,
    INSERT_LINKS: () => `
        INSERT INTO dbo.ImportLinks (EntityType, LegacyCode, EntityId, BatchId, CreatedOn)
        SELECT @EntityType, j.LegacyCode, j.EntityId, @BatchId, @Now
        FROM OPENJSON(@Rows) WITH (LegacyCode NVARCHAR(100), EntityId UNIQUEIDENTIFIER) j
        WHERE NOT EXISTS (SELECT 1 FROM dbo.ImportLinks l WHERE l.EntityType = @EntityType AND l.LegacyCode = j.LegacyCode)`,

    // A later import of the same type that is still in place (undo the newest first).
    LATER_IMPORT: () => `
        SELECT TOP 1 b.FileName FROM dbo.ImportBatches b
        WHERE b.EntityType = @EntityType AND b.Status = 'IMPORTED' AND b.ImportedOn > @ImportedOn AND b.BatchId <> @BatchId`,
    // Every column that could point at the records being removed.
    REFERENCE_COLUMNS: () => `
        SELECT c.TABLE_NAME AS tableName, c.COLUMN_NAME AS columnName
        FROM INFORMATION_SCHEMA.COLUMNS c
        INNER JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_TYPE = 'BASE TABLE'
        WHERE c.TABLE_SCHEMA = 'dbo'
          AND (c.COLUMN_NAME IN (SELECT value FROM OPENJSON(@Columns))
               OR (@IncludeActors = 1 AND c.DATA_TYPE = 'uniqueidentifier'
                   AND (c.COLUMN_NAME LIKE '%By' OR c.COLUMN_NAME LIKE '%UserId' OR c.COLUMN_NAME = 'ActorId')))
          AND c.TABLE_NAME NOT IN (SELECT value FROM OPENJSON(@SkipTables))`,
    MARK_UNDONE: () => `
        UPDATE dbo.ImportRows SET Status = 'UNDONE' WHERE BatchId = @BatchId AND Action IN ('CREATED', 'UPDATED');
        DELETE FROM dbo.ImportLinks WHERE BatchId = @BatchId;
        UPDATE dbo.ImportBatches SET Status = 'UNDONE', UndoneBy = @ActorId, UndoneOn = @Now WHERE BatchId = @BatchId;`,
};
