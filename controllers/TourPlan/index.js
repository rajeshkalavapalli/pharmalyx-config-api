const express = require('express');

const router = express.Router();

const Tourplan  = require('./TourPlanHandler');


router.get('/tourplan', Tourplan.getTourPlan);
router.post('/tourplan', Tourplan.createTourPlan);
router.post('/tourplan/:tourPlanId/approve', Tourplan.approveTourPlan);
router.post('/tourplan/:tourPlanId/reject', Tourplan.rejectTourPlan);

module.exports = router;