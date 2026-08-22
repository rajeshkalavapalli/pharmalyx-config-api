const express = require('express');

const router = express.Router();

const userHandler = require('./userHandler');

router.get('/designation', userHandler.getDesignation);


module.exports = router;
