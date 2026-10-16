const express = require('express');

const router = express.Router();

const Feedback = require('./FeedbackHandler');

router.get('/feedback', Feedback.getFeedback);

module.exports = router;
