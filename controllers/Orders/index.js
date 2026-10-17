const express = require('express');

const router = express.Router();

const Orders = require('./OrdersHandler');
const { requirePermission } = require('../../utils/permissions');

router.get('/orders', requirePermission('orders.view'), Orders.getOrders);
router.get('/orders/options', requirePermission('orders.create'), Orders.getOptions);
router.post('/orders', requirePermission('orders.create'), Orders.createOrder);
router.post('/orders/:orderId/status', requirePermission('orders.edit'), Orders.updateStatus);

module.exports = router;
