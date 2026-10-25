const express = require('express');

const router = express.Router();

const { requireAnyPermission, requirePermission } = require('../../utils/permissions');

// Master data (admins): anyone may not add, change or remove it.
const canView = requireAnyPermission('masters.view', 'assignments.view');
const canCreate = requirePermission('masters.create');
const canEdit = requirePermission('masters.edit');
const canDelete = requirePermission('masters.delete');

const StockistHandler  = require('./StockistHandler')

router.get('/get-stockists', canView, StockistHandler.getStockist);
router.get('/get-stockist-by-id/:stockistId', canView, StockistHandler.getStockistById);
router.post('/create-stockist', canCreate, StockistHandler.createStockist);
router.put('/update-stockist/:stockistId', canEdit, StockistHandler.updateStockist);
router.delete('/delete-stockist/:stockistId', canDelete, StockistHandler.deleteStockist);

module.exports = router;

