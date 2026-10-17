const express = require('express');

const router = express.Router();

const doctorHandler = require('./doctorHandler')
const { requireAnyPermission, requirePermission } = require('../../utils/permissions');

// Admin doctor master (Configuration → Doctors, User Doctor Mapping).
// Field users will add / change doctors through approval requests instead.
router.post('/create-doctor', requirePermission('masters.create'), doctorHandler.createDoctor);

// Admins (masters.view) see every doctor; others (My doctors · View) see their own and their team's.
router.get('/get-doctors', requireAnyPermission('masters.view', 'doctors.view'), doctorHandler.getDoctors);
router.get('/get-doctor-by-id/:doctorId', requireAnyPermission('masters.view', 'doctors.view'), doctorHandler.getDoctorById);
router.put('/update-doctor/:doctorId', requirePermission('masters.edit'), doctorHandler.updateDoctor);
router.delete('/delete-doctor/:doctorId', requirePermission('masters.delete'), doctorHandler.deleteDoctor);

module.exports = router
