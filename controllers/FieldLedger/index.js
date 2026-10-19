const express = require('express');

const router = express.Router();

const Ledger = require('./LedgerHandler');
const { requirePermission } = require('../../utils/permissions');

const canView = requirePermission('ledger.view'); // MR, manager, head office (scope checked in the services)
const canRecord = requirePermission('ledger.create'); // MR: deliveries and payments
const headOffice = requirePermission('ledger.approve'); // head office only

// Receipt photos arrive as the raw image body (in-app camera); 5 MB plus headroom.
const rawImage = (req, res, next) =>
    express.raw({ type: () => true, limit: '6mb' })(req, res, (error) => {
        if (!error) return next();
        return res.status(error.type === 'entity.too.large' ? 413 : 400).json({
            message: error.type === 'entity.too.large' ? 'Photo is larger than 5 MB.' : 'The photo could not be read.',
        });
    });

// MR / manager / head office views
router.get('/ledger/stock', canView, Ledger.getStock);
router.get('/ledger/chemists', canView, Ledger.listChemists);
router.get('/ledger/chemists/:pharmacyId', canView, Ledger.getChemistLedger);
router.get('/ledger/deliveries', canView, Ledger.listDeliveries);
router.get('/ledger/deliveries/:deliveryId/receipt', canView, Ledger.getDeliveryReceipt);
router.get('/ledger/payments/:entryId/receipt', canView, Ledger.getPaymentReceipt);
router.get('/ledger/reports/fill-rate', canView, Ledger.fillRate);
router.get('/ledger/reports/spend', canView, Ledger.spendVsBusiness);
router.get('/ledger/reports/focus', canView, Ledger.focus);

// MR: direct supply and payments (photo first, then the record)
router.get('/ledger/options', canRecord, Ledger.getOptions);
router.post('/ledger/photo', canRecord, rawImage, Ledger.uploadPhoto);
router.post('/ledger/deliveries', canRecord, Ledger.createDelivery);
router.post('/ledger/payments', canRecord, Ledger.createPayment);

// Head office
router.get('/ledger/holdings', headOffice, Ledger.getHoldings);
router.post('/ledger/stock/issue', headOffice, Ledger.issueStock);
router.post('/ledger/stock/return', headOffice, Ledger.returnStock);
router.post('/ledger/stock/:entryId/void', headOffice, Ledger.voidStockEntry);
router.put('/ledger/chemists/:pharmacyId/credit-limit', headOffice, Ledger.setCreditLimit);
router.post('/ledger/chemists/:pharmacyId/adjust', headOffice, Ledger.adjustDues);
router.get('/ledger/payments/with-mr', headOffice, Ledger.paymentsWithMr);
router.post('/ledger/payments/:entryId/confirm', headOffice, Ledger.confirmDeposit);
router.post('/ledger/entries/:entryId/void', headOffice, Ledger.voidLedgerEntry);
router.post('/ledger/deliveries/:deliveryId/void', headOffice, Ledger.voidDelivery);
router.get('/ledger/lookups', headOffice, Ledger.getLookups);
router.get('/ledger/schemes', headOffice, Ledger.listSchemes);
router.post('/ledger/schemes', headOffice, Ledger.createScheme);
router.post('/ledger/schemes/:schemeId/void', headOffice, Ledger.voidScheme);
router.get('/ledger/exits', headOffice, Ledger.listClearances);
router.post('/ledger/exits', headOffice, Ledger.createClearance);
router.get('/ledger/exits/:clearanceId', headOffice, Ledger.getClearance);
router.post('/ledger/exits/:clearanceId/refresh', headOffice, Ledger.refreshClearance);
router.post('/ledger/exits/:clearanceId/handover', headOffice, Ledger.handoverNow);
router.post('/ledger/exits/:clearanceId/close', headOffice, Ledger.closeClearance);
router.post('/ledger/exit-items/:itemId/close', headOffice, Ledger.closeItem);
router.post('/ledger/checks/run', headOffice, Ledger.runChecks);

module.exports = router;
