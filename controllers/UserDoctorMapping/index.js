const express = require('express');

const router = express.Router();

const { requireAnyPermission } = require('../../utils/permissions');

// Who works with which doctors / chemists / stockists: only admins decide (an MR must never assign themselves).
const canView = requireAnyPermission('assignments.view', 'masters.view');
const canAssign = requireAnyPermission('assignments.edit', 'masters.edit');

const userDoctorMappingHandler = require('./UserDoctorMappingHandler')



router.post('/create-user-doctor-mapping', canAssign, userDoctorMappingHandler.createuserdoctormapping)

router.get('/get-user-doctor-mappings', canView, userDoctorMappingHandler.getUserDoctorMappings)
router.put('/update-user-doctor-mapping', canAssign, userDoctorMappingHandler.updateUserDoctorMapping)
router.get('/get-user-doctor-mapping-by-id/:userId', canView, userDoctorMappingHandler.getUserDoctorMappingById)
router.get('/get-user-doctor-mapping-by-user-id/:userId', canView, userDoctorMappingHandler.getUserDoctorMappingByUserId)
router.delete('/delete-user-doctor-mappings', canAssign, userDoctorMappingHandler.deleteUserDoctorMappings)    
module.exports = router
