const sql = require('./sql');
const { customQuery, runInTransaction } = require('../../utils/dbFunctions');

exports.getRoles = () => customQuery(sql.GET_ROLES());

exports.getRole = async (RoleId) => (await customQuery(sql.GET_ROLE(), { RoleId }))[0] || null;

exports.getRolePermissions = (RoleId) => customQuery(sql.GET_ROLE_PERMISSIONS(), { RoleId });

// Catalogue keyed by code: { FeatureCode, ActionCode }.
exports.getPermissionCatalogue = async () =>
    new Map((await customQuery(sql.GET_PERMISSION_CODES())).map((row) => [row.PermissionCode, row]));

// All switches for a role are saved together or not at all.
exports.saveRolePermissions = (RoleId, changes, ModifiedBy) => {
    const ModifiedOn = new Date();

    return runInTransaction(
        changes.map((change) => ({
            sqlQuery: sql.UPSERT_ROLE_PERMISSION(),
            inputs: { RoleId, PermissionCode: change.PermissionCode, IsAllowed: change.IsAllowed, ModifiedBy, ModifiedOn },
        }))
    );
};

exports.getUsers = () => customQuery(sql.GET_USERS());

exports.assignRole = (UserId, RoleId) => runInTransaction([{ sqlQuery: sql.ASSIGN_ROLE(), inputs: { UserId, RoleId } }]);
