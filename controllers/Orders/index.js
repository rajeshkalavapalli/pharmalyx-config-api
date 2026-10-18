const express = require('express');

const router = express.Router();

const Orders = require('./OrdersHandler');
const { requirePermission } = require('../../utils/permissions');

// Slip photos arrive as the raw image body (in-app camera); 5 MB plus headroom.
const rawImage = (req, res, next) =>
    express.raw({ type: () => true, limit: '6mb' })(req, res, (error) => {
        if (!error) return next();
        return res.status(error.type === 'entity.too.large' ? 413 : 400).json({
            message: error.type === 'entity.too.large' ? 'Photo is larger than 5 MB.' : 'The photo could not be read.',
        });
    });

router.get('/orders', requirePermission('orders.view'), Orders.getOrders);
router.get('/orders/options', requirePermission('orders.create'), Orders.getOptions);
router.post('/orders/slip', requirePermission('orders.create'), rawImage, Orders.uploadSlip);
router.post('/orders', requirePermission('orders.create'), Orders.createOrder);
router.get('/orders/:orderId/slip', requirePermission('orders.view'), Orders.getSlip);
router.post('/orders/:orderId/status', requirePermission('orders.edit'), Orders.updateStatus);

module.exports = router;
