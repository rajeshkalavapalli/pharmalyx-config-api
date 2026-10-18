const express = require('express');

const router = express.Router();

const Stock = require('./StockHandler');

router.get('/stock/balances', Stock.getBalances);
router.get('/stock/ledger', Stock.getLedger);
router.post('/stock/issue', Stock.issueStock);
router.post('/stock/return', Stock.returnStock);

// Expected in hand vs physical counts (manager of the MR or head office records counts).
router.get('/stock/reconciliation', Stock.getReconciliation);
router.post('/stock/counts', Stock.recordCount);

module.exports = router;
