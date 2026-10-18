const express = require('express');

const router = express.Router();

const Business = require('./BusinessHandler');
const { requirePermission } = require('../../utils/permissions');

const canView = requirePermission('business.view'); // MR, manager, head office (scope checked in the service)
const canEdit = requirePermission('business.edit'); // head office data entry
const canDecide = requirePermission('business.approve'); // head office: run checks

// Read-only views.
router.get('/business/review', canView, Business.getReview);
router.get('/business/ramp-up', canView, Business.getRampUp);
router.get('/business/cost', canView, Business.getCostVsBusiness);
router.get('/business/incentives', canView, Business.getIncentives);
router.get('/business/near-expiry', canView, Business.getNearExpiry);

// Head office data: batches, stockist territories, dispatch, returns (void, never delete).
router.get('/business/batches', canView, Business.listBatches);
router.post('/business/batches', canEdit, Business.createBatch);
router.get('/business/stockists', canEdit, Business.listStockists);
router.post('/business/stockists/:stockistId/territories', canEdit, Business.setStockistTerritories);
router.get('/business/dispatches', canEdit, Business.listDispatches);
router.post('/business/dispatches', canEdit, Business.createDispatch);
router.get('/business/returns', canEdit, Business.listReturns);
router.post('/business/returns', canEdit, Business.createReturn);
router.post('/business/dispatches/:recordId/void', canEdit, Business.voidDispatch);
router.post('/business/returns/:recordId/void', canEdit, Business.voidReturn);

// People costs, milestones, incentive slabs.
router.get('/business/people', canEdit, Business.listPeople);
router.get('/business/people/:userId/salaries', canEdit, Business.salaryHistory);
router.put('/business/people/:userId/joining', canEdit, Business.setJoining);
router.post('/business/people/:userId/salaries', canEdit, Business.addSalary);
router.get('/business/config', canView, Business.getConfig);
router.put('/business/milestones', canEdit, Business.saveMilestones);
router.put('/business/slabs', canEdit, Business.saveSlabs);
router.post('/business/checks/run', canDecide, Business.runChecks);

module.exports = router;
