const StockService = require('./StockService');
const { handle, actingUser } = require('../../utils/http');

exports.getBalances = handle('load stock', (req) =>
    StockService.getBalances(actingUser(req), req.query));

exports.getLedger = handle('load stock history', (req) =>
    StockService.getLedger(actingUser(req), req.query));

exports.issueStock = handle('issue stock', (req) =>
    StockService.issueStock(actingUser(req), req.body || {}));

exports.returnStock = handle('return stock', (req) =>
    StockService.returnStock(actingUser(req), req.body || {}));

exports.getReconciliation = handle('load the stock reconciliation', (req) =>
    StockService.getReconciliation(actingUser(req), req.query));

exports.recordCount = handle('save the stock count', (req) =>
    StockService.recordCount(actingUser(req), req.body || {}), 201);
