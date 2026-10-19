const Ledger = require('./LedgerService');
const HeadOffice = require('./HeadOfficeService');
const Reports = require('./ReportsService');
const Checks = require('./checks');
const { handle, actingUser } = require('../../utils/http');

// Receipt photos are sent back as images, not JSON.
const sendImage = (label, work) => async (req, res) => {
    try {
        const { buffer, contentType } = await work(req);
        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'private, max-age=300');
        return res.send(buffer);
    } catch (error) {
        if (!error.status) console.error(`Error trying to ${label}:`, error);
        return res.status(error.status || 500).json({ message: error.status ? error.message : `Failed to ${label}.` });
    }
};

// MR, manager, head office (scope checked in the services)
exports.getStock = handle('load stock in hand', (req) => Ledger.getStock(actingUser(req), req.query));
exports.getOptions = handle('load delivery options', (req) => Ledger.getOptions(actingUser(req)));
exports.uploadPhoto = handle('upload the photo', (req) => Ledger.uploadPhoto(actingUser(req), req.body), 201);
exports.createDelivery = handle('record the delivery', (req) => Ledger.createDelivery(actingUser(req), req.body || {}), 201);
exports.createPayment = handle('record the payment', (req) => Ledger.createPayment(actingUser(req), req.body || {}), 201);
exports.listChemists = handle('load chemist dues', (req) => Ledger.listChemists(actingUser(req), req.query));
exports.getChemistLedger = handle('load the chemist ledger', (req) => Ledger.getChemistLedger(actingUser(req), req.params.pharmacyId));
exports.listDeliveries = handle('load deliveries', (req) => Ledger.listDeliveries(actingUser(req), req.query));
exports.getDeliveryReceipt = sendImage('load the receipt', (req) => Ledger.getReceipt(actingUser(req), 'delivery', req.params.deliveryId));
exports.getPaymentReceipt = sendImage('load the receipt', (req) => Ledger.getReceipt(actingUser(req), 'payment', req.params.entryId));

// Reports
exports.fillRate = handle('load stockist fill rate', (req) => Reports.fillRate(actingUser(req), req.query));
exports.spendVsBusiness = handle('load spend vs business', (req) => Reports.spendVsBusiness(actingUser(req), req.query));
exports.focus = handle('load the focus report', (req) => Reports.focus(actingUser(req), req.query));

// Head office
exports.getHoldings = handle('load stock with MRs', (req) => HeadOffice.getHoldings(actingUser(req)));
exports.issueStock = handle('issue the stock', (req) => HeadOffice.issueStock(actingUser(req), req.body || {}), 201);
exports.returnStock = handle('record the return', (req) => HeadOffice.returnStock(actingUser(req), req.body || {}), 201);
exports.voidStockEntry = handle('void the entry', (req) => HeadOffice.voidStockEntry(actingUser(req), req.params.entryId, req.body || {}));
exports.setCreditLimit = handle('set the credit limit', (req) => HeadOffice.setCreditLimit(actingUser(req), req.params.pharmacyId, req.body || {}));
exports.adjustDues = handle('record the adjustment', (req) => HeadOffice.adjustDues(actingUser(req), req.params.pharmacyId, req.body || {}), 201);
exports.paymentsWithMr = handle('load payments to confirm', (req) => HeadOffice.paymentsWithMr(actingUser(req), req.query));
exports.confirmDeposit = handle('confirm the payment', (req) => HeadOffice.confirmDeposit(actingUser(req), req.params.entryId));
exports.voidLedgerEntry = handle('void the entry', (req) => HeadOffice.voidLedgerEntry(actingUser(req), req.params.entryId, req.body || {}));
exports.voidDelivery = handle('void the delivery', (req) => HeadOffice.voidDelivery(actingUser(req), req.params.deliveryId, req.body || {}));
exports.getLookups = handle('load lists', (req) => HeadOffice.getLookups(actingUser(req)));
exports.listSchemes = handle('load schemes', (req) => HeadOffice.listSchemes(actingUser(req), req.query));
exports.createScheme = handle('record the scheme', (req) => HeadOffice.createScheme(actingUser(req), req.body || {}), 201);
exports.voidScheme = handle('void the scheme', (req) => HeadOffice.voidScheme(actingUser(req), req.params.schemeId, req.body || {}));
exports.listClearances = handle('load exit clearances', (req) => HeadOffice.listClearances(actingUser(req)));
exports.getClearance = handle('load the exit clearance', (req) => HeadOffice.getClearance(actingUser(req), req.params.clearanceId));
exports.createClearance = handle('open the exit clearance', (req) => HeadOffice.createClearance(actingUser(req), req.body || {}), 201);
exports.refreshClearance = handle('refresh the exit clearance', (req) => HeadOffice.refreshClearance(actingUser(req), req.params.clearanceId));
exports.closeItem = handle('close the item', (req) => HeadOffice.closeItem(actingUser(req), req.params.itemId, req.body || {}));
exports.closeClearance = handle('close the exit clearance', (req) => HeadOffice.closeClearance(actingUser(req), req.params.clearanceId));
exports.handoverNow = handle('hand over', (req) => HeadOffice.handoverNow(actingUser(req), req.params.clearanceId));
exports.runChecks = handle('run the checks', async () => ({ message: `Checks done: ${await Checks.sweep()} new flag(s).` }));
