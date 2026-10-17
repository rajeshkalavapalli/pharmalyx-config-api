const displayName = (alias) =>
    `COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(${alias}.FirstName, ' ', ${alias}.LastName))), ''), ${alias}.UserName)`;

module.exports = {
    GET_ROLES: () => {
        return `
            SELECT
                r.RoleId,
                r.RoleCode,
                r.RoleName,
                r.IsActive,
                (SELECT COUNT(*) FROM Users u WHERE u.RoleId = r.RoleId AND u.IsActive = 1) AS ActiveUsers,
                (SELECT COUNT(*) FROM RolePermissions rp WHERE rp.RoleId = r.RoleId AND rp.IsAllowed = 1) AS AllowedPermissions
            FROM Roles r
            ORDER BY CASE r.RoleCode WHEN 'ADMIN' THEN 0 WHEN 'MANAGER' THEN 1 ELSE 2 END, r.RoleName
        `;
    },

    GET_ROLE: () => {
        return `SELECT RoleId, RoleCode, RoleName FROM Roles WHERE RoleId = @RoleId`;
    },

    // Every permission, with this role's switch (off when never set).
    GET_ROLE_PERMISSIONS: () => {
        return `
            SELECT
                p.PermissionCode,
                p.ModuleName,
                p.FeatureCode,
                p.FeatureName,
                p.ActionCode,
                p.PermissionName,
                p.Description,
                CAST(ISNULL(rp.IsAllowed, 0) AS BIT) AS IsAllowed
            FROM Permissions p
            LEFT JOIN RolePermissions rp ON rp.PermissionCode = p.PermissionCode AND rp.RoleId = @RoleId
            ORDER BY p.SortOrder
        `;
    },

    GET_PERMISSION_CODES: () => {
        return `SELECT PermissionCode, FeatureCode, ActionCode FROM Permissions`;
    },

    UPSERT_ROLE_PERMISSION: () => {
        return `
            UPDATE RolePermissions
            SET IsAllowed = @IsAllowed, ModifiedBy = @ModifiedBy, ModifiedOn = @ModifiedOn
            WHERE RoleId = @RoleId AND PermissionCode = @PermissionCode;

            IF @@ROWCOUNT = 0
                INSERT INTO RolePermissions (RoleId, PermissionCode, IsAllowed, ModifiedBy, ModifiedOn)
                VALUES (@RoleId, @PermissionCode, @IsAllowed, @ModifiedBy, @ModifiedOn);
        `;
    },

    GET_USERS: () => {
        return `
            SELECT
                u.UserId,
                ${displayName('u')} AS Name,
                u.UserName,
                u.EmailId,
                d.SystemLovDetailName AS DesignationName,
                u.RoleId,
                r.RoleName,
                u.IsActive
            FROM Users u
            LEFT JOIN SystemLovDetails d ON d.SystemLovDetailId = u.DesignationId
            LEFT JOIN Roles r ON r.RoleId = u.RoleId
            ORDER BY u.IsActive DESC, Name
        `;
    },

    ASSIGN_ROLE: () => {
        return `
            UPDATE Users SET RoleId = @RoleId, ModifiedOn = GETDATE() WHERE UserId = @UserId;

            IF @@ROWCOUNT = 0
                THROW 50031, 'User not found.', 1;
        `;
    },
};
