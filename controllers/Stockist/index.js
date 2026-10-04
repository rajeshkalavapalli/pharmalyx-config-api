const express = require('express');

const router = express.Router();

const StockistHandler  = require('./StockistHandler')

router.get('/get-stockists', StockistHandler.getStockist);
router.get('/get-stockist-by-id/:stockistId', StockistHandler.getStockistById);
router.post('/create-stockist', StockistHandler.createStockist);
router.put('/update-stockist/:stockistId', StockistHandler.updateStockist);
router.delete('/delete-stockist/:stockistId', StockistHandler.deleteStockist);

module.exports = router;

