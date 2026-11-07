const express = require('express');

const router = express.Router();

const Tourplan  = require('./TourPlanHandler');


router.get('/tourplan/team', Tourplan.getTeamPlans);
router.get('/tourplan/history', Tourplan.getPlanHistory);
router.get('/tourplan', Tourplan.getTourPlan);
router.post('/tourplan', Tourplan.createTourPlan);
router.post('/tourplan/:tourPlanId/approve', Tourplan.approveTourPlan);
router.post('/tourplan/:tourPlanId/reject', Tourplan.rejectTourPlan);
// A senior moves a team member's planned day to another area (for joint work).
router.post('/tourplan/team/:userId/day', Tourplan.changeMemberDay);

module.exports = router;