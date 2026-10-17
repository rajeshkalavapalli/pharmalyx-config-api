const express = require('express');

const router = express.Router();

const Insights = require('./InsightsHandler');
const { requirePermission } = require('../../utils/permissions');

router.get('/insights/alerts', requirePermission('alerts.view'), Insights.getAlerts);
router.post('/insights/alerts/action', requirePermission('alerts.act'), Insights.actOnAlert);
router.get('/insights/performance', requirePermission('performanceinsights.view'), Insights.getPerformance);
router.get('/insights/field', requirePermission('fieldintel.view'), Insights.getFieldIntel);
router.get('/insights/analytics', requirePermission('analytics.view'), Insights.getAnalytics);
router.get('/insights/rules', requirePermission('insightrules.view'), Insights.getRules);
router.put('/insights/rules/:ruleCode', requirePermission('insightrules.edit'), Insights.saveRule);

module.exports = router;
