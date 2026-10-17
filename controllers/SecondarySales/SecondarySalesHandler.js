const SecondarySalesService = require('./SecondarySalesService');
const { handle, actingUser } = require('../../utils/http');

exports.getOverview = handle('load secondary sales', (req) => SecondarySalesService.getOverview(actingUser(req), req.query));

exports.getStatement = handle('load statement', (req) => SecondarySalesService.getStatement(actingUser(req), req.query));

exports.saveStatement = handle('save statement', (req) => SecondarySalesService.saveStatement(actingUser(req), req.body || {}));

exports.getReviews = handle('load statements to review', (req) => SecondarySalesService.getReviews(actingUser(req)));

exports.getStatementById = handle('load statement', (req) =>
    SecondarySalesService.getStatementById(actingUser(req), req.params.statementId));

exports.approveStatement = handle('approve statement', (req) =>
    SecondarySalesService.reviewStatement(actingUser(req), req.params.statementId, 'APPROVED', req.body?.Remarks));

exports.returnStatement = handle('return statement', (req) =>
    SecondarySalesService.reviewStatement(actingUser(req), req.params.statementId, 'RETURNED', req.body?.Remarks));

exports.getStock = handle('load stockist stock', (req) => SecondarySalesService.getStock(actingUser(req)));
