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
        u.CreatedOn AS CreatedOn,
        u.ModifiedOn AS ModifiedOn,

        sld.SystemLovDetailCode AS SldCode,
        sld.SystemLovDetailName AS SldName

        FROM Users u
        LEFT JOIN SystemLovDetails sld ON u.DesignationId = sld.SystemLovDetailId
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

    CREATE_USER: (newUser)=>{
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
            TerritoryId,
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
           @TerritoryId,
           @DivisionId,
           @ManagerId,
           GETDATE(),
           GETDATE()
        )
        `
    }
}