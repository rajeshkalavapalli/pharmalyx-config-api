const express = require('express');

const router = express.Router();

const Expenses = require('./ExpensesHandler');
const { requirePermission } = require('../../utils/permissions');

// MR
router.get('/expenses', requirePermission('expenses.view'), Expenses.getMyClaim);
router.put('/expenses/days', requirePermission('expenses.create'), Expenses.saveDays);
router.post('/expenses/items', requirePermission('expenses.create'), Expenses.addItem);
router.delete('/expenses/items/:itemId', requirePermission('expenses.create'), Expenses.deleteItem);
router.post('/expenses/submit', requirePermission('expenses.create'), Expenses.submit);

// Manager
router.get('/expenses/reviews', requirePermission('expenses.approve'), Expenses.getReviews);
router.post('/expenses/claims/:claimId/manager-approve', requirePermission('expenses.approve'), Expenses.managerApprove);

// Manager or finance (who may return is decided by the claim's status in the service)
router.get('/expenses/claims/:claimId', Expenses.getClaimById);
router.post('/expenses/claims/:claimId/return', Expenses.returnClaim);

// Finance
router.get('/expenses/finance', requirePermission('expensefinance.view'), Expenses.getFinance);
router.post('/expenses/claims/:claimId/final-approve', requirePermission('expensefinance.approve'), Expenses.finalApprove);
router.post('/expenses/claims/:claimId/mark-paid', requirePermission('expensefinance.approve'), Expenses.markPaid);

// Rate card
router.get('/expenses/rates', requirePermission('expenserates.view'), Expenses.getRates);
router.put('/expenses/rates/:designationId', requirePermission('expenserates.edit'), Expenses.saveRate);

module.exports = router;
