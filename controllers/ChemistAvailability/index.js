const express = require('express');

const router = express.Router();

const Availability = require('./AvailabilityHandler');

// Is our product on the chemist's shelf? Reps record it; managers see stock-outs that lose prescriptions.
router.get('/chemists/availability', Availability.getForChemist);
router.post('/chemists/availability', Availability.record);
router.get('/chemists/availability/summary', Availability.getSummary);

module.exports = router;
