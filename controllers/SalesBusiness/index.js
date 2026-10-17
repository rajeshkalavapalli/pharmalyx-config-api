const express = require('express');

const router = express.Router();

const SalesBusiness = require('./SalesBusinessHandler');
const { requirePermission } = require('../../utils/permissions');

router.get('/sales/business', requirePermission('salesbusiness.view'), SalesBusiness.getBusiness);

module.exports = router;
