const express = require('express');

const router = express.Router();

const userDoctorMappingHandler = require('./UserDoctorMappingHandler')



router.post('/create-user-doctor-mapping', userDoctorMappingHandler.createuserdoctormapping)

router.get('/get-user-doctor-mappings', userDoctorMappingHandler.getUserDoctorMappings)
router.put('/update-user-doctor-mapping', userDoctorMappingHandler.updateUserDoctorMapping)
router.get('/get-user-doctor-mapping-by-id/:userId', userDoctorMappingHandler.getUserDoctorMappingById)
router.get('/get-user-doctor-mapping-by-user-id/:userId', userDoctorMappingHandler.getUserDoctorMappingByUserId)

module.exports = router
