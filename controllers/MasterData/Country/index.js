const express = require('express');

const router = express.Router();

const countriesHandler = require('./countryHandler')

router.get('/getcountries', countriesHandler.getCountries);

router.get('/get-States/:CountryId', countriesHandler.getStates);


module.exports = router