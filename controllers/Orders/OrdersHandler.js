const OrdersService = require('./OrdersService');
const { handle, actingUser } = require('../../utils/http');

exports.getOrders = handle('load orders', (req) => OrdersService.getOrders(actingUser(req), req.query));

exports.getOptions = handle('load order options', (req) => OrdersService.getOptions(actingUser(req)));

exports.createOrder = handle('book order', (req) => OrdersService.createOrder(actingUser(req), req.body || {}), 201);

exports.updateStatus = handle('update order', (req) =>
    OrdersService.updateStatus(actingUser(req), req.params.orderId, req.body || {}));
