const express = require('express');

const router = express.Router();

const Truth = require('./TruthHandler');

// Field Truth Score: team view for managers / head office, and each person's own score.
router.get('/truth/scores', Truth.getScores);
router.get('/truth/me', Truth.getMine);

module.exports = router;
