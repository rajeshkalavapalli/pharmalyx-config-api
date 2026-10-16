const express = require('express');

const router = express.Router();

const Deviation = require('./DeviationHandler');

router.get('/deviations', Deviation.getDeviations);
router.get('/deviations/:deviationId', Deviation.getDeviationById);
router.post('/deviations', Deviation.createDeviation);
router.post('/deviations/:deviationId/approve', Deviation.approveDeviation);
router.post('/deviations/:deviationId/reject', Deviation.rejectDeviation);

module.exports = router;
