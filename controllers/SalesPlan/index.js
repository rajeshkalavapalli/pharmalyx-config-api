const express = require('express');

const router = express.Router();

const SalesPlan = require('./SalesPlanHandler');
const { requirePermission } = require('../../utils/permissions');

router.get('/plans/sales', requirePermission('salesplan.view'), SalesPlan.getPlan);
router.get('/plans/sales/team', requirePermission('salesplan.view'), SalesPlan.getTeam);
router.get('/plans/sales/targets', requirePermission('salesplan.edit'), SalesPlan.getTargetForm);
router.put('/plans/sales/targets', requirePermission('salesplan.edit'), SalesPlan.saveTargets);

module.exports = router;
