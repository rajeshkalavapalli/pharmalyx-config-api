const express = require('express');

const router = express.Router();

const userPharmacyMappingHandler = require('./UserPharmacyMappingHandler')



router.post('/create-user-pharmacy-mapping', userPharmacyMappingHandler.createuserpharmacymapping)

router.get('/get-user-pharmacy-mappings', userPharmacyMappingHandler.getUserPharmacyMappings)
router.put('/update-user-pharmacy-mapping', userPharmacyMappingHandler.updateUserPharmacyMapping)
router.get('/get-user-pharmacy-mapping-by-id/:userId', userPharmacyMappingHandler.getUserPharmacyMappingById)
router.get('/get-user-pharmacy-mapping-by-user-id/:userId', userPharmacyMappingHandler.getUserPharmacyMappingByUserId)
router.delete('/delete-user-pharmacy-mappings', userPharmacyMappingHandler.deleteUserPharmacyMappings)    
module.exports = router
