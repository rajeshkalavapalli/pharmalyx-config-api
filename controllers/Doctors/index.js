const express = require('express');

const router = express.Router();

const doctorHandler = require('./doctorHandler')

router.post('/create-doctor', doctorHandler.createDoctor);

router.get('/get-doctors', doctorHandler.getDoctors);

module.exports = router
