const InsightsService = require('./InsightsService');
const { handle, actingUser } = require('../../utils/http');

exports.getAlerts = handle('load alerts', (req) => InsightsService.getAlerts(actingUser(req), req.query));

exports.actOnAlert = handle('update the alert', (req) => InsightsService.actOnAlert(actingUser(req), req.body || {}));

exports.getPerformance = handle('load performance insights', (req) => InsightsService.getPerformance(actingUser(req), req.query));

exports.getFieldIntel = handle('load field intelligence', (req) => InsightsService.getFieldIntel(actingUser(req), req.query));

exports.getAnalytics = handle('load advanced analytics', (req) => InsightsService.getAnalytics(actingUser(req), req.query));

exports.getRules = handle('load insight rules', () => InsightsService.getRules());

exports.saveRule = handle('save the insight rule', (req) => InsightsService.saveRule(actingUser(req), req.params.ruleCode, req.body || {}));
