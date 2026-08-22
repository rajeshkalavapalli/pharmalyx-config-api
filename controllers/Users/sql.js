module.exports = {
    GET_USER_DETAILS_BY_USERID: (userid) => {
        return `select 
        u.UserId AS userId ,
        u.UserName AS UserName, 
        u.FirstName  AS FirstName,
        u.LastName AS LastName,
        u.EmailId AS EmailId,
        u.MobileNumber AS MobileNumber,
        u.PasswordHash AS PasswordHash, 
        u.DesignationId As DesignationId, 
        u.ManagerId AS ManagerId,
        u.CreatedOn AS CreatedOn,
        u.ModifiedOn AS ModifiedOn,

        sld.SystemLovDetailsCode AS SldCode,
        sld.SystemLovDetailsName AS SldName

        FROM Users u
        LEFT JOIN SystemLovDetails sld ON u.DesignationId = sld.DesignationId
        WHERE u.userId=${'userid'}
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
    }
}