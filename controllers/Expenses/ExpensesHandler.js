const ExpensesService = require('./ExpensesService');
const DayReviews = require('./DayReviewService');
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

// Daily statement, day reviews (employee -> manager -> head office), policy, day report.
exports.getStatement = handle('load the daily statement', (req) => ExpensesService.getStatement(actingUser(req), req.query));
exports.sendDayReason = handle('send your reason', (req) => DayReviews.sendReason(actingUser(req), req.params.reviewId, req.body || {}));
exports.managerQueue = handle('load days to review', async (req) => ({ reviews: await DayReviews.managerQueue(actingUser(req)) }));
exports.managerApproveDay = handle('approve the day', (req) => DayReviews.managerDecide(actingUser(req), req.params.reviewId, true, req.body || {}));
exports.managerRejectDay = handle('reject the day', (req) => DayReviews.managerDecide(actingUser(req), req.params.reviewId, false, req.body || {}));
exports.adminQueue = handle('load days for the final decision', async (req) => ({ reviews: await DayReviews.adminQueue(actingUser(req)) }));
exports.adminApproveDay = handle('mark the day payable', (req) => DayReviews.adminDecide(actingUser(req), req.params.reviewId, true, req.body || {}));
exports.adminRejectDay = handle('mark the day not payable', (req) => DayReviews.adminDecide(actingUser(req), req.params.reviewId, false, req.body || {}));
exports.managerRejections = handle('load manager rejections', async () => ({ reviews: await DayReviews.managerRejections() }));
exports.dayReport = handle('generate the day report', (req) => DayReviews.dayReport(actingUser(req), req.params.reviewId));
exports.verifyDayReport = handle('verify the day report', (req) => DayReviews.verifyReport(actingUser(req), req.params.reviewId, req.body?.Code));
exports.getPolicy = handle('load the policy', (req) => DayReviews.getPolicy(actingUser(req)));
exports.acceptPolicy = handle('accept the policy', (req) => DayReviews.acceptPolicy(actingUser(req), req.get('user-agent')));
exports.approvedWithoutDa = handle('load approved days', async () => ({ reviews: await DayReviews.approvedWithoutDa() }));
exports.grantDaLater = handle('grant DA', (req) => DayReviews.grantDaLater(actingUser(req), req.params.reviewId, req.body || {}));
