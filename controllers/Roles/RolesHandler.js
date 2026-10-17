const RolesService = require('./RolesService');
const { handle, actingUser } = require('../../utils/http');

exports.getRoles = handle('load roles', () => RolesService.getRoles());

exports.getRolePermissions = handle('load role permissions', (req) =>
    RolesService.getRolePermissions(req.params.roleId));

exports.saveRolePermissions = handle('save role permissions', (req) =>
    RolesService.saveRolePermissions(actingUser(req), req.params.roleId, req.body || {}));

exports.getUsers = handle('load users', () => RolesService.getUsers());

exports.assignRole = handle('change role', (req) =>
    RolesService.assignRole(actingUser(req), req.params.userId, req.body || {}));

exports.getMyPermissions = handle('load your permissions', (req) => RolesService.getMyPermissions(actingUser(req)));
