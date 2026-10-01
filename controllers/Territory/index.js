const express = require('express');

const router = express.Router();

const TerritoryHandler = require('./territoryHandler')

router.post('/create-Territory', TerritoryHandler.createTerritory);

router.get("/get-territorie/:StateId",TerritoryHandler.getTerritorie);

router.get('/get-territories', TerritoryHandler.getTerritories);

router.put('/update-territory/:TerritoryId', TerritoryHandler.updateTerritory);
router.delete('/delete-territory/:TerritoryId', TerritoryHandler.deleteTerritory);
router.get('/get-territory-by-id/:TerritoryId', TerritoryHandler.getTerritoryById);
module.exports = router