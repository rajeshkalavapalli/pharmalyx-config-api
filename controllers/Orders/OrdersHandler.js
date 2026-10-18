const OrdersService = require('./OrdersService');
const { handle, actingUser } = require('../../utils/http');

exports.getOrders = handle('load orders', (req) => OrdersService.getOrders(actingUser(req), req.query));

exports.getOptions = handle('load order options', (req) => OrdersService.getOptions(actingUser(req)));

exports.createOrder = handle('book order', (req) => OrdersService.createOrder(actingUser(req), req.body || {}), 201);

exports.updateStatus = handle('update order', (req) =>
    OrdersService.updateStatus(actingUser(req), req.params.orderId, req.body || {}));

exports.uploadSlip = handle('upload the slip photo', (req) => OrdersService.uploadSlip(actingUser(req), req.body), 201);

exports.getSlip = async (req, res) => {
    try {
        const slip = await OrdersService.getSlip(actingUser(req), req.params.orderId);
        res.set('Content-Type', slip.contentType);
        res.set('Cache-Control', 'private, max-age=300');
        res.set('X-Content-Type-Options', 'nosniff');
        return res.send(slip.buffer);
    } catch (error) {
        if (!error.status) console.error('Error trying to load the slip:', error);
        return res.status(error.status || 500).json({ message: error.status ? error.message : 'Failed to load the slip.' });
    }
};
