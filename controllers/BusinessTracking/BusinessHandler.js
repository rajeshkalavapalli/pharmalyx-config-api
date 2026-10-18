const Business = require('./BusinessService');
const HeadOffice = require('./HeadOfficeService');
const OrderChecks = require('./orderChecks');
const { handle, actingUser } = require('../../utils/http');

// Views (MR, manager, head office): read-only
exports.getReview = handle('load the monthly review', (req) => Business.getReview(actingUser(req), req.query));
exports.getRampUp = handle('load ramp-up milestones', (req) => Business.getRampUp(actingUser(req), req.query));
exports.getCostVsBusiness = handle('load cost vs business', (req) => Business.getCostVsBusiness(actingUser(req), req.query));
exports.getIncentives = handle('load incentives', (req) => Business.getIncentives(actingUser(req), req.query));
exports.getNearExpiry = handle('load near-expiry stock', (req) => Business.getNearExpiry(actingUser(req), req.query));

// Head office
exports.listBatches = handle('load batches', (req) => HeadOffice.listBatches(req.query));
exports.createBatch = handle('add the batch', (req) => HeadOffice.createBatch(actingUser(req), req.body || {}), 201);
exports.listStockists = handle('load stockists', () => HeadOffice.listStockists());
exports.setStockistTerritories = handle('update stockist territories', (req) => HeadOffice.setStockistTerritories(actingUser(req), req.params.stockistId, req.body || {}));
exports.listDispatches = handle('load dispatches', (req) => HeadOffice.listDispatches(req.query));
exports.createDispatch = handle('record the dispatch', (req) => HeadOffice.createDispatch(actingUser(req), req.body || {}), 201);
exports.listReturns = handle('load returns', (req) => HeadOffice.listReturns(req.query));
exports.createReturn = handle('record the return', (req) => HeadOffice.createReturn(actingUser(req), req.body || {}), 201);
exports.voidDispatch = handle('void the dispatch', (req) => HeadOffice.voidRecord(actingUser(req), 'dispatches', req.params.recordId, req.body || {}));
exports.voidReturn = handle('void the return', (req) => HeadOffice.voidRecord(actingUser(req), 'returns', req.params.recordId, req.body || {}));
exports.listPeople = handle('load people', () => HeadOffice.listPeople());
exports.salaryHistory = handle('load salaries', (req) => HeadOffice.salaryHistory(req.params.userId));
exports.setJoining = handle('save the joining date', (req) => HeadOffice.setJoining(actingUser(req), req.params.userId, req.body || {}));
exports.addSalary = handle('save the salary', (req) => HeadOffice.addSalary(actingUser(req), req.params.userId, req.body || {}), 201);
exports.getConfig = handle('load milestones and slabs', () => HeadOffice.getConfig());
exports.saveMilestones = handle('save milestones', (req) => HeadOffice.saveMilestones(actingUser(req), req.body || {}));
exports.saveSlabs = handle('save incentive slabs', (req) => HeadOffice.saveSlabs(actingUser(req), req.body || {}));
exports.runChecks = handle('run the order checks', async () => ({ message: `Checks done: ${await OrderChecks.sweep()} new flag(s).` }));
