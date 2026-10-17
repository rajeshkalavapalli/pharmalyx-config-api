const SalesAccountsService = require('./SalesAccountsService');
const { handle, actingUser } = require('../../utils/http');

exports.getRetailers = handle('load retailers', (req) => SalesAccountsService.getAccounts('retailer', actingUser(req), req.query));

exports.getRetailer = handle('load retailer', (req) =>
    SalesAccountsService.getAccount('retailer', actingUser(req), req.params.accountId, req.query));

exports.getStockists = handle('load stockists', (req) => SalesAccountsService.getAccounts('stockist', actingUser(req), req.query));

exports.getStockist = handle('load stockist', (req) =>
    SalesAccountsService.getAccount('stockist', actingUser(req), req.params.accountId, req.query));
