
const express = require('express');

const router = express.Router();

const userAreaMappingHandler = require('./UserAreaMappingHandler')



router.post('/create-user-area-mapping',userAreaMappingHandler.createuserareamapping )

router.get('/get-user-area-mappings', userAreaMappingHandler.getUserAreaMappings)


module.exports = router