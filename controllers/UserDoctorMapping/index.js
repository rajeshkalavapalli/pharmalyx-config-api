const express = require('express');

const router = express.Router();

const userDoctorMappingHandler = require('./UserDoctorMappingHandler')



router.post('/create-user-doctor-mapping', userDoctorMappingHandler.createuserdoctormapping)

router.get('/get-user-doctor-mappings', userDoctorMappingHandler.getUserDoctorMappings)


module.exports = router
