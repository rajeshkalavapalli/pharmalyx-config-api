const express = require('express');

const router = express.Router();

const { requireAnyPermission } = require('../../utils/permissions');

// Who works with which doctors / chemists / stockists: only admins decide (an MR must never assign themselves).
const canView = requireAnyPermission('assignments.view', 'masters.view');
const canAssign = requireAnyPermission('assignments.edit', 'masters.edit');

const userStockistMappingHandler = require('./UserStockistMappingHandler')



router.post('/create-user-stockist-mapping', canAssign, userStockistMappingHandler.createuserstockistmapping)

router.get('/get-user-stockist-mappings', canView, userStockistMappingHandler.getUserStockistMappings)
router.put('/update-user-stockist-mapping', canAssign, userStockistMappingHandler.updateUserStockistMapping)
router.get('/get-user-stockist-mapping-by-id/:userStockistMappingId', canView, userStockistMappingHandler.getUserStockistMappingById)
router.get('/get-user-stockist-mapping-by-user-id/:userId', canView, userStockistMappingHandler.getUserStockistMappingByUserId)
router.delete('/delete-user-stockist-mappings', canAssign, userStockistMappingHandler.deleteUserStockistMappings)    
module.exports = router
