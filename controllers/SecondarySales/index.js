const express = require('express');

const router = express.Router();

const SecondarySales = require('./SecondarySalesHandler');
const { requirePermission } = require('../../utils/permissions');

router.get('/secondary', requirePermission('secondary.view'), SecondarySales.getOverview);
router.get('/secondary/statement', requirePermission('secondary.view'), SecondarySales.getStatement);
router.put('/secondary/statement', requirePermission('secondary.create'), SecondarySales.saveStatement);
router.get('/secondary/reviews', requirePermission('secondary.approve'), SecondarySales.getReviews);
router.get('/secondary/statements/:statementId', requirePermission('secondary.view'), SecondarySales.getStatementById);
router.post('/secondary/statements/:statementId/approve', requirePermission('secondary.approve'), SecondarySales.approveStatement);
router.post('/secondary/statements/:statementId/return', requirePermission('secondary.approve'), SecondarySales.returnStatement);

// Stockist stock position (kept apart from /stock, which is samples & gifts).
router.get('/sales/stock', requirePermission('inventory.view'), SecondarySales.getStock);

module.exports = router;
