const RolesDA = require('./RolesDA');

const { fail, isGuid, requireActingUser, sameId } = require('../../utils/access');
const { getPermissions } = require('../../utils/permissions');

// Administrators always keep this screen, so nobody can lock everyone out.
const LOCKED_FOR_ADMIN = ['roles.view', 'roles.edit'];

const number = (value) => Number(value) || 0;

exports.getRoles = async () => {
    const roles = await RolesDA.getRoles();

    return {
        roles: roles.map((role) => ({
            ...role,
            ActiveUsers: number(role.ActiveUsers),
            AllowedPermissions: number(role.AllowedPermissions),
        })),
    };
};

exports.getRolePermissions = async (roleId) => {
    if (!isGuid(roleId)) throw fail(400, 'Role is invalid.');

    const role = await RolesDA.getRole(roleId);

    if (!role) throw fail(404, 'Role not found.');

    return { role, permissions: await RolesDA.getRolePermissions(roleId) };
};

exports.saveRolePermissions = async (actingUserId, roleId, payload) => {
    requireActingUser(actingUserId);

    if (!isGuid(roleId)) throw fail(400, 'Role is invalid.');

    const role = await RolesDA.getRole(roleId);

    if (!role) throw fail(404, 'Role not found.');

    const changes = Array.isArray(payload.permissions) ? payload.permissions : [];

    if (changes.length === 0) throw fail(400, 'No permission changes to save.');

    const [catalogue, current] = await Promise.all([
        RolesDA.getPermissionCatalogue(),
        RolesDA.getRolePermissions(roleId),
    ]);
    const seen = new Set();

    const normalized = changes.map((change) => {
        const code = String(change?.PermissionCode || '');

        if (!catalogue.has(code)) throw fail(400, `Unknown permission: ${code || '(empty)'}.`);
        if (seen.has(code)) throw fail(400, `Permission listed twice: ${code}.`);
        seen.add(code);

        return { PermissionCode: code, IsAllowed: change.IsAllowed === true };
    });

    if (role.RoleCode === 'ADMIN' && normalized.some((c) => LOCKED_FOR_ADMIN.includes(c.PermissionCode) && !c.IsAllowed)) {
        throw fail(400, 'The Administrator role must keep access to Roles & permissions.');
    }

    // Resulting state after the changes: any action on a feature needs View on that feature.
    const finalState = new Map(current.map((row) => [row.PermissionCode, Boolean(row.IsAllowed)]));
    normalized.forEach((change) => finalState.set(change.PermissionCode, change.IsAllowed));

    for (const [code, allowed] of finalState) {
        const entry = catalogue.get(code);

        if (!allowed || !entry || entry.ActionCode === 'view') continue;

        const viewCode = `${entry.FeatureCode}.view`;

        if (catalogue.has(viewCode) && !finalState.get(viewCode)) {
            const feature = current.find((row) => row.FeatureCode === entry.FeatureCode)?.FeatureName || entry.FeatureCode;
            throw fail(400, `Turn on View for ${feature} before allowing other actions.`);
        }
    }

    await RolesDA.saveRolePermissions(roleId, normalized, actingUserId);

    return { message: `${role.RoleName} permissions saved.` };
};

exports.getUsers = async () => ({ users: await RolesDA.getUsers() });

exports.assignRole = async (actingUserId, userId, payload) => {
    requireActingUser(actingUserId);

    if (!isGuid(userId)) throw fail(400, 'User is invalid.');
    if (!isGuid(payload.RoleId)) throw fail(400, 'Choose a role.');

    const role = await RolesDA.getRole(payload.RoleId);

    if (!role) throw fail(404, 'Role not found.');

    // Changing your own role could remove your access to this screen.
    if (sameId(userId, actingUserId)) {
        throw fail(400, 'You cannot change your own role. Ask another administrator.');
    }

    try {
        await RolesDA.assignRole(userId, payload.RoleId);
    } catch (error) {
        if (error.number === 50031) throw fail(404, error.message);
        throw error;
    }

    return { message: `Role changed to ${role.RoleName}.` };
};

// The signed-in user's permission codes (used by the UI to show or hide actions).
exports.getMyPermissions = async (actingUserId) => {
    requireActingUser(actingUserId);
    return { permissions: [...(await getPermissions(actingUserId))] };
};
