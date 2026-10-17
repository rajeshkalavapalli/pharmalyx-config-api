const express = require('express');

const router = express.Router();

const Roles = require('./RolesHandler');
const { requirePermission } = require('../../utils/permissions');

const canView = requirePermission('roles.view');
const canEdit = requirePermission('roles.edit');

// Any signed-in user can read their own permissions.
router.get('/me/permissions', Roles.getMyPermissions);

router.get('/roles', canView, Roles.getRoles);
router.get('/roles/users', canView, Roles.getUsers);
router.get('/roles/:roleId/permissions', canView, Roles.getRolePermissions);
router.put('/roles/:roleId/permissions', canEdit, Roles.saveRolePermissions);
router.put('/roles/users/:userId', canEdit, Roles.assignRole);

module.exports = router;
