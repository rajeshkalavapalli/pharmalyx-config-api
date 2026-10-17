const ExpensesService = require('./ExpensesService');
const { handle, actingUser } = require('../../utils/http');

exports.getMyClaim = handle('load expense claim', (req) => ExpensesService.getMyClaim(actingUser(req), req.query));

exports.saveDays = handle('save daily allowances', (req) => ExpensesService.saveDays(actingUser(req), req.body || {}));

exports.addItem = handle('add expense', (req) => ExpensesService.addItem(actingUser(req), req.body || {}), 201);

exports.deleteItem = handle('remove expense', (req) => ExpensesService.deleteItem(actingUser(req), req.params.itemId, req.query));

exports.submit = handle('submit claim', (req) => ExpensesService.submit(actingUser(req), req.body || {}));

exports.getClaimById = handle('load claim', (req) => ExpensesService.getClaimById(actingUser(req), req.params.claimId));

exports.getReviews = handle('load claims to review', (req) => ExpensesService.getReviews(actingUser(req)));

exports.managerApprove = handle('approve claim', (req) => ExpensesService.managerApprove(actingUser(req), req.params.claimId, req.body || {}));

exports.returnClaim = handle('return claim', (req) => ExpensesService.returnClaim(actingUser(req), req.params.claimId, req.body || {}));

exports.getFinance = handle('load claims for payment', (req) => ExpensesService.getFinance(actingUser(req), req.query));

exports.finalApprove = handle('approve claim for payment', (req) => ExpensesService.finalApprove(actingUser(req), req.params.claimId, req.body || {}));

exports.markPaid = handle('mark claim paid', (req) => ExpensesService.markPaid(actingUser(req), req.params.claimId, req.body || {}));

exports.getRates = handle('load rate card', () => ExpensesService.getRates());

exports.saveRate = handle('save rate card', (req) => ExpensesService.saveRate(actingUser(req), req.params.designationId, req.body || {}));
