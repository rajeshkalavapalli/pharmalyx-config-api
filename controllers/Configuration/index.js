const express = require('express');

const router = express.Router();

const Configuration = require('./ConfigurationHandler');

router.get('/configuration/summary', Configuration.getSummary);

module.exports = router;
