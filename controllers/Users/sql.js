module.exports = {
    GET_USERS: () => {
        return `select 
        u.UserId AS userId ,
        u.UserName AS UserName, 
        u.FirstName  AS FirstName,
        u.LastName AS LastName,
        u.EmailId AS EmailId,
        u.MobileNumber AS MobileNumber,
        u.DesignationId As DesignationId, 
        u.ManagerId AS ManagerId,
        mgr.UserName AS ManagerName,
        u.CreatedOn AS CreatedOn,
        u.ModifiedOn AS ModifiedOn,
        u.divisionId AS DivisionId,
        u.territoryId AS TerritoryId,
        
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
    }
}