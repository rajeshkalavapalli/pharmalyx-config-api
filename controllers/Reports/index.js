const express = require('express');

const router = express.Router();

const Reports = require('./ReportsHandler');
const { requirePermission } = require('../../utils/permissions');

// Filter options (employees in your hierarchy, territories, products) for any report page.
router.get('/reports/options', Reports.getOptions);

router.get('/reports/calls', requirePermission('callreport.view'), Reports.getCallReport);
router.get('/reports/coverage', requirePermission('coveragereport.view'), Reports.getCoverageReport);
router.get('/reports/missed-visits', requirePermission('missedreport.view'), Reports.getMissedReport);
router.get('/reports/pob', requirePermission('pobreport.view'), Reports.getPobReport);
router.get('/reports/sales', requirePermission('salesreport.view'), Reports.getSalesReport);
router.get('/reports/kpi', requirePermission('kpireport.view'), Reports.getKpiReport);
router.get('/reports/mis', requirePermission('misreport.view'), Reports.getMisReport);
router.get('/reports/graphical', requirePermission('graphreport.view'), Reports.getGraphReport);

module.exports = router;
