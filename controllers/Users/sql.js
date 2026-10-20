module.exports = {
    // Sign-in lookup by username or email (case-insensitive by collation).
    // Sign-in lookup by username or email. Deactivated users cannot sign in
    // (the check runs only once the Users.IsActive column exists).
    GET_LOGIN_USER: () => {
        const select = `
            SELECT TOP (1)
                u.UserId,
                u.UserName,
                COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.FirstName, ' ', u.LastName))), ''), u.UserName) AS Name,
                u.PasswordHash,
                sld.SystemLovDetailName AS DesignationName
            FROM Users u
            LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = u.DesignationId
            WHERE (u.UserName = @Login OR u.EmailId = @Login)`;

        return `
            IF COL_LENGTH('dbo.Users', 'IsActive') IS NULL
                ${select};
            ELSE
                EXEC sp_executesql N'${select.replace(/'/g, "''")} AND u.IsActive = 1', N'@Login NVARCHAR(200)', @Login = @Login;
        `;
    },

    // With organisations: every active user with this username / email, in any company,
    // with their company (sign-in runs across companies, then picks one).
    GET_LOGIN_USERS_ALL_ORGS: () => `
        SELECT
            u.UserId,
            u.UserName,
            COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.FirstName, ' ', u.LastName))), ''), u.UserName) AS Name,
            u.PasswordHash,
            sld.SystemLovDetailName AS DesignationName,
            u.OrganisationId,
            o.Name AS OrganisationName,
            o.Status AS OrganisationStatus
        FROM Users u
        INNER JOIN dbo.Organisations o ON o.OrganisationId = u.OrganisationId
        LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = u.DesignationId
        WHERE (u.UserName = @Login OR u.EmailId = @Login) AND u.IsActive = 1`,

    GET_USERS: () => {
        return `select 
        u.UserId AS userId ,
        u.UserName AS UserName, 
        u.IsActive AS IsActive,
        u.FirstName  AS FirstName,
        u.LastName AS LastName,
        u.EmailId AS EmailId,
        u.CountryCode AS CountryCode,
        u.MobileNumber AS MobileNumber,
        u.DesignationId As DesignationId, 
        u.ManagerId AS ManagerId,
        mgr.UserName AS ManagerName,
        u.CreatedOn AS CreatedOn,
        u.ModifiedOn AS ModifiedOn,
        u.divisionId AS DivisionId,
        u.territoryId AS TerritoryId,
        ISNULL((
            SELECT STRING_AGG(CONVERT(varchar(36), ust.StateId), ',')
            FROM UserStateMapping ust
            WHERE ust.UserId = u.UserId
        ), '') AS StateIds,
        ISNULL((
            SELECT TOP (1) CONVERT(varchar(36), s.CountryId)
            FROM UserStateMapping ust
            INNER JOIN State s ON s.StateId = ust.StateId
            WHERE ust.UserId = u.UserId
            ORDER BY s.StateName
        ), '') AS CountryId,
        ISNULL((
            SELECT STRING_AGG(CONVERT(varchar(36), utm.TerritoryId), ',')
            FROM UserTerritoryMapping utm
            WHERE utm.UserId = u.UserId
        ), '') AS TerritoryIds,
        
        sld.SystemLovDetailCode AS SldCode,
        sld.SystemLovDetailName AS SldName,

        d.DivisionName AS DivisionName

        FROM Users u
        LEFT JOIN SystemLovDetails sld ON u.DesignationId = sld.SystemLovDetailId
        LEFT JOIN Division d ON u.DivisionId = d.DivisionId
        LEFT JOIN Users mgr ON u.ManagerId = mgr.UserId
        `
    },

    GET_DESIGNATION: () => {
     return`
          SELECT
            sld.SystemLovDetailId AS SystemLovDetailId,
            sld.SystemLovDetailCode AS SldCode,
            sld.SystemLovDetailName AS SldName,
            sld.SystemLovId AS SystemLovId,
            sld.IsActive AS IsActive
        FROM SystemLovDetails sld
        WHERE sld.SystemLovId = '0E68E775-640D-4444-AEB9-939E1C9413C0'
        `
    },

    CREATE_USER: () => {
        return `
        INSERT INTO Users(
            UserId,
            UserName,
            FirstName,
            LastName,
            EmailId,
            CountryCode,
            MobileNumber,
            PasswordHash,
            DesignationId,
            DivisionId,
            ManagerId,
            CreatedOn,
            ModifiedOn
        )
        VALUES(
           @UserId,
           @UserName,
           @FirstName,
           @LastName,
           @EmailId,
           @CountryCode,
           @MobileNumber,
           @PasswordHash,
           @DesignationId,
           @DivisionId,
           @ManagerId,
           GETDATE(),
           GETDATE()
        )
        `
    },

    CREATE_USER_STATE_MAPPING: () => {
        return `
            INSERT INTO UserStateMapping (
                UserId,
                StateId,
                CreatedOn,
                ModifiedOn
            )
            VALUES (
                @UserId,
                @StateId,
                GETDATE(),
                GETDATE()
            )
        `;
    },

    CREATE_USER_TERRITORY_MAPPING: () => {
        return `
            INSERT INTO UserTerritoryMapping (
                UserId,
                TerritoryId,
                CreatedOn,
                ModifiedOn
            )
            VALUES (
                @UserId,
                @TerritoryId,
                GETDATE(),
                GETDATE()
            )
        `;
    },
    UPDATE_USER: () => {
        return `
        UPDATE Users
        SET
            UserName = @UserName,
            FirstName = @FirstName,
            LastName = @LastName,
            EmailId = @EmailId,
            CountryCode = @CountryCode,
            MobileNumber = @MobileNumber,
            DesignationId = @DesignationId,
            DivisionId = @DivisionId,
            ManagerId = @ManagerId,
            ModifiedOn = GETDATE()
        WHERE UserId = @UserId
        `
    },
    // 1 when @ManagerId is @UserId or reports to @UserId at any level (choosing them would make a loop).
    MANAGER_LOOP: () => `
        WITH Below AS (
            SELECT u.UserId, 0 AS Depth FROM Users u WHERE u.UserId = @UserId
            UNION ALL
            SELECT c.UserId, b.Depth + 1 FROM Users c INNER JOIN Below b ON c.ManagerId = b.UserId WHERE b.Depth < 15
        )
        SELECT CASE WHEN EXISTS (SELECT 1 FROM Below WHERE UserId = @ManagerId) THEN 1 ELSE 0 END AS Loop`,

    // Joint-work colleagues: the manager chain above, everyone below, and people sharing a territory.
    // Active people only; names and designations, never phone or email.
    GET_COLLEAGUES: () => `
        WITH Up AS (
            SELECT m.UserId, m.ManagerId, 0 AS Depth FROM Users me INNER JOIN Users m ON m.UserId = me.ManagerId WHERE me.UserId = @UserId
            UNION ALL
            SELECT m.UserId, m.ManagerId, u.Depth + 1 FROM Users m INNER JOIN Up u ON m.UserId = u.ManagerId WHERE u.Depth < 15
        ),
        Down AS (
            SELECT c.UserId, 0 AS Depth FROM Users c WHERE c.ManagerId = @UserId
            UNION ALL
            SELECT c.UserId, d.Depth + 1 FROM Users c INNER JOIN Down d ON c.ManagerId = d.UserId WHERE d.Depth < 15
        ),
        Peers AS (
            SELECT DISTINCT o.UserId FROM UserTerritoryMapping mine
            INNER JOIN UserTerritoryMapping o ON o.TerritoryId = mine.TerritoryId
            WHERE mine.UserId = @UserId
        ),
        Picked AS (SELECT UserId FROM Up UNION SELECT UserId FROM Down UNION SELECT UserId FROM Peers)
        SELECT u.UserId, COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.FirstName, ' ', u.LastName))), ''), u.UserName) AS Name,
               sld.SystemLovDetailName AS DesignationName
        FROM Picked p
        INNER JOIN Users u ON u.UserId = p.UserId
        LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = u.DesignationId
        WHERE u.UserId <> @UserId AND ISNULL(u.IsActive, 1) = 1
        ORDER BY Name`,

    GET_PASSWORD_HASH: () => `SELECT PasswordHash FROM Users WHERE UserId = @UserId`,

    UPDATE_USER_PASSWORD: () => {
        return `
        UPDATE Users
        SET PasswordHash = @PasswordHash,
            ModifiedOn = GETDATE()
        WHERE UserId = @UserId
        `
    },
    DELETE_USER_STATE_MAPPINGS: () => {
        return `
            DELETE FROM UserStateMapping
            WHERE UserId = @UserId
        `;
    },
    DELETE_USER: () => {
        return `
        DELETE FROM Users
        WHERE UserId = @UserId
        `
    }, 
    DELETE_USER_TERRITORY_MAPPINGS: () => {
        return `
            DELETE FROM UserTerritoryMapping
            WHERE UserId = @UserId
        `;
    },
    GET_USER_BY_ID: () => {
        return `
        SELECT
            UserId,
            UserName,
            FirstName,
            LastName,
            EmailId,
            CountryCode,
            MobileNumber,
            DesignationId,
            DivisionId,
            ManagerId,
            CreatedOn,
            ModifiedOn
        FROM Users
        WHERE UserId = @UserId
        `
    },
    // ---------- deleting a user ----------
    // Set-up links that go with the user (assignments, location consent).
    USER_LINK_TABLES: ['UserStateMapping', 'UserTerritoryMapping', 'UserAreaMapping', 'UserDoctorMapping', 'UserPharmacyMapping', 'UserStockistMapping', 'LocationConsents'],

    // Every other column that can name a user: their work and the work they reviewed.
    USER_HISTORY_COLUMNS: () => `
        SELECT c.TABLE_NAME AS tableName, c.COLUMN_NAME AS columnName
        FROM INFORMATION_SCHEMA.COLUMNS c
        INNER JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_NAME = c.TABLE_NAME AND t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_TYPE = 'BASE TABLE'
        WHERE c.TABLE_SCHEMA = 'dbo' AND c.DATA_TYPE = 'uniqueidentifier'
          AND (c.COLUMN_NAME IN ('UserId', 'ManagerId', 'ActorId') OR c.COLUMN_NAME LIKE '%UserId' OR c.COLUMN_NAME LIKE '%By')
          AND c.TABLE_NAME NOT IN (SELECT value FROM OPENJSON(@SkipTables))`,

    // Rows naming the user, per table (columns come from USER_HISTORY_COLUMNS, never from input).
    USER_HISTORY_COUNTS: (columns) =>
        columns
            .map(({ tableName, columnName }) => {
                const t = String(tableName).replace(/]/g, ']]');
                const c = String(columnName).replace(/]/g, ']]');
                return `SELECT '${t.replace(/'/g, "''")}' AS tableName, COUNT(*) AS n FROM dbo.[${t}] WHERE [${c}] = @UserId`;
            })
            .join(' UNION ALL '),

    DEACTIVATE_USER: () => `UPDATE Users SET IsActive = 0, ModifiedOn = GETDATE() WHERE UserId = @UserId`,

    DELETE_USER_LINKS: (tables) => tables.map((table) => `DELETE FROM dbo.${table} WHERE UserId = @UserId;`).join(' '),

    UPDATE_MANAGER_REFERENCE: () => {
        return `
        UPDATE Users
            SET ManagerId = NULL
        WHERE ManagerId = @UserId
        `;
    }
}