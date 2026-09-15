const express = require('express');

const router = express.Router();

const TerritoryHandler = require('./territoryHandler')

router.post('/create-Territory', TerritoryHandler.createTerritory);

router.get("/get-territorie/:StateId",TerritoryHandler.getTerritorie);

router.get('/get-territories', TerritoryHandler.getTerritories);

module.exports = router