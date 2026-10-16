const express = require('express');

const router = express.Router();

const Visits = require('./VisitsHandler');

router.get('/visits', Visits.getVisits);
router.get('/visits/follow-ups', Visits.getFollowUps);
router.get('/visits/:visitId', Visits.getVisitById);
router.post('/visits', Visits.createVisit);

module.exports = router;
