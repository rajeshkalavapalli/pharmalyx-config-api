const express = require('express');

const router = express.Router();

const DoctorBusiness = require('./DoctorBusinessHandler');

router.get('/doctor-business', DoctorBusiness.getMonth);
router.put('/doctor-business', DoctorBusiness.saveEntry);

module.exports = router;
