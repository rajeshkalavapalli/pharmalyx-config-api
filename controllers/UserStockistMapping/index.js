const express = require('express');

const router = express.Router();

const userStockistMappingHandler = require('./UserStockistMappingHandler')



router.post('/create-user-stockist-mapping', userStockistMappingHandler.createuserstockistmapping)

router.get('/get-user-stockist-mappings', userStockistMappingHandler.getUserStockistMappings)
router.put('/update-user-stockist-mapping', userStockistMappingHandler.updateUserStockistMapping)
router.get('/get-user-stockist-mapping-by-id/:userStockistMappingId', userStockistMappingHandler.getUserStockistMappingById)
router.get('/get-user-stockist-mapping-by-user-id/:userId', userStockistMappingHandler.getUserStockistMappingByUserId)
router.delete('/delete-user-stockist-mappings', userStockistMappingHandler.deleteUserStockistMappings)    
module.exports = router
