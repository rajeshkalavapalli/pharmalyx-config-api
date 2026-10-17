const { customQuery } = require('./dbFunctions');

// Permission codes the user's role has switched on. Inactive users have none.
const getPermissions = async (userId) => {
    const rows = await customQuery(
        `SELECT rp.PermissionCode
         FROM Users u
         INNER JOIN Roles r ON r.RoleId = u.RoleId AND r.IsActive = 1
         INNER JOIN RolePermissions rp ON rp.RoleId = u.RoleId AND rp.IsAllowed = 1
         WHERE u.UserId = @UserId AND u.IsActive = 1`,
        { UserId: userId }
    );

    return new Set(rows.map((row) => row.PermissionCode));
};

// Route guard: runs after `authenticate`, so req.user is the verified user.
const requirePermission = (code) => async (req, res, next) => {
    try {
        const permissions = await getPermissions(req.user?.userId);

        if (!permissions.has(code)) {
            return res.status(403).json({ message: "You don't have permission to do this." });
        }

        return next();
    } catch (error) {
        console.error('Error checking permission:', error);
        return res.status(500).json({ message: 'Failed to check permissions.', error: error.message });
    }
};

module.exports = { getPermissions, requirePermission };
