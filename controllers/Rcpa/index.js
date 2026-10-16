const express = require('express');

const router = express.Router();

const Rcpa = require('./RcpaHandler');

router.get('/rcpa', Rcpa.getRcpa);
router.get('/rcpa/pharmacies', Rcpa.getPharmacies);
router.post('/rcpa', Rcpa.createRcpa);

module.exports = router;
