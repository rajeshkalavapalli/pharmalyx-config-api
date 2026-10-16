const express = require('express');

const router = express.Router();

const Dcr = require('./DcrHandler');

router.get('/dcr/month', Dcr.getMonth);
router.get('/dcr/day', Dcr.getDay);
router.get('/dcr/reviews', Dcr.getPendingReviews);
router.post('/dcr', Dcr.submitDcr);
router.post('/dcr/:dcrId/approve', Dcr.approveDcr);
router.post('/dcr/:dcrId/return', Dcr.returnDcr);

module.exports = router;
