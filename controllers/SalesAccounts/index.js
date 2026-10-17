const express = require('express');

const router = express.Router();

const SalesAccounts = require('./SalesAccountsHandler');
const { requirePermission } = require('../../utils/permissions');

// Field views; the admin masters stay under /pharmacy and /stockist.
router.get('/sales/retailers', requirePermission('retailers.view'), SalesAccounts.getRetailers);
router.get('/sales/retailers/:accountId', requirePermission('retailers.view'), SalesAccounts.getRetailer);
router.get('/sales/stockists', requirePermission('stockists.view'), SalesAccounts.getStockists);
router.get('/sales/stockists/:accountId', requirePermission('stockists.view'), SalesAccounts.getStockist);

module.exports = router;
