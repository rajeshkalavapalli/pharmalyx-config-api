const express = require('express');

const router = express.Router();

const Stock = require('./StockHandler');

router.get('/stock/balances', Stock.getBalances);
router.get('/stock/ledger', Stock.getLedger);
router.post('/stock/issue', Stock.issueStock);
router.post('/stock/return', Stock.returnStock);

module.exports = router;
