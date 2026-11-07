const express = require('express');

const router = express.Router();

const Audits = require('./AuditsHandler');

// Joint audits. The audited rep never sees these; the auditor, their seniors and head office do.
router.get('/audits/today', Audits.getToday);
router.get('/audits', Audits.list);
router.post('/audits/cross', Audits.assignCross);
router.post('/audits/:auditId/check-in', Audits.checkIn);
router.post('/audits/:auditId/result', Audits.decide);

module.exports = router;
