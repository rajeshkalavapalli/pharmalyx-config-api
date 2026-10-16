const FeedbackService = require('./FeedbackService');
const { handle, actingUser } = require('../../utils/http');

exports.getFeedback = handle('load feedback', (req) => FeedbackService.getFeedback(actingUser(req), req.query));
