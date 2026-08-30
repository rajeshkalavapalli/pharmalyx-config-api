const express = require('express');

const router = express.Router();

const userHandler = require('./userHandler');

router.get('/designation', userHandler.getDesignation);
router.post('/create-user', userHandler.createUser);
router.get('/get-users',userHandler.getUsers)



module.exports = router;
