const express = require('express');

const router = express.Router();

const { requireAnyPermission } = require('../../utils/permissions');

// Who works with which doctors / chemists / stockists: only admins decide (an MR must never assign themselves).
const canView = requireAnyPermission('assignments.view', 'masters.view');
const canAssign = requireAnyPermission('assignments.edit', 'masters.edit');

const userPharmacyMappingHandler = require('./UserPharmacyMappingHandler')



router.post('/create-user-pharmacy-mapping', canAssign, userPharmacyMappingHandler.createuserpharmacymapping)

router.get('/get-user-pharmacy-mappings', canView, userPharmacyMappingHandler.getUserPharmacyMappings)
router.put('/update-user-pharmacy-mapping', canAssign, userPharmacyMappingHandler.updateUserPharmacyMapping)
router.get('/get-user-pharmacy-mapping-by-id/:userId', canView, userPharmacyMappingHandler.getUserPharmacyMappingById)
router.get('/get-user-pharmacy-mapping-by-user-id/:userId', canView, userPharmacyMappingHandler.getUserPharmacyMappingByUserId)
router.delete('/delete-user-pharmacy-mappings', canAssign, userPharmacyMappingHandler.deleteUserPharmacyMappings)    
module.exports = router
