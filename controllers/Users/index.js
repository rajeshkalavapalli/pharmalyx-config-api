const express = require('express');

const router = express.Router();

const userHandler = require('./userHandler');
const { requireAnyPermission } = require('../../utils/permissions');

// Full user list (phone, email): admin screens and managers (their team only). Everyone else uses /people.
const canListUsers = requireAnyPermission('users.view', 'masters.view', 'assignments.view');

router.get('/designation', userHandler.getDesignation);
router.post('/create-user', userHandler.createUser);
router.get('/get-users', canListUsers, userHandler.getUsers);
router.get('/people', userHandler.getPeople);
router.get('/user-seats', userHandler.getSeats);
router.put('/update-user', userHandler.updateUser);
router.delete('/delete-user/:userId', userHandler.deleteUser);
router.get('/get-user/:userId', userHandler.getUserById);
router.post('/login', userHandler.login);
router.post('/login/choose', userHandler.chooseOrganisation);
router.post('/change-password', userHandler.changePassword);




module.exports = router;
