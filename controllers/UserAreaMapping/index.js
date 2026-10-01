
const express = require('express');

const router = express.Router();

const userAreaMappingHandler = require('./UserAreaMappingHandler')



router.post('/create-user-area-mapping',userAreaMappingHandler.createuserareamapping )

router.get('/get-user-area-mappings', userAreaMappingHandler.getUserAreaMappings)

router.put('/update-user-area-mapping', userAreaMappingHandler.updateUserAreaMapping)

router.get('/get-user-area-mapping-by-id/:userAreaMappingId', userAreaMappingHandler.getUserAreaMappingById)

router.delete('/delete-user-area-mapping/:userId', userAreaMappingHandler.deleteUserAreaMapping)

router.put('/update-user-area-mapping-by-id/:userAreaMappingId', userAreaMappingHandler.updateUserAreaMapping)

module.exports = router