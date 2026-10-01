const express = require('express');

const router = express.Router();

const doctorHandler = require('./doctorHandler')

router.post('/create-doctor', doctorHandler.createDoctor);

router.get('/get-doctors', doctorHandler.getDoctors);
router.get('/get-doctor-by-id/:doctorId', doctorHandler.getDoctorById);
router.put('/update-doctor/:doctorId', doctorHandler.updateDoctor);
router.delete('/delete-doctor/:doctorId', doctorHandler.deleteDoctor);

module.exports = router
