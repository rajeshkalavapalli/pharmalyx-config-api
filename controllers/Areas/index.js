const express = require('express');

const router = express.Router();

const AreaHandler  = require('../Areas/Areahandler')

router.post('/create-Area', AreaHandler.createArea);

router.get("/get-areas-code",AreaHandler.getAreasCode); 

router.get("/get-next-area-sequence/:TerritoryId",AreaHandler.getnextAreaSequence);

router.get("/check-area-exists/:TerritoryId/:AreaName",AreaHandler.checkAreaExists);

router.get("/preview-area-code/:TerritoryId/:AreaName",AreaHandler.previewAreaCode);

router.get("/get-areas-by-territory/:TerritoryId",AreaHandler.getAreasByTerritory); 

router.put("/update-area/:AreaId", AreaHandler.updateArea);

router.delete("/delete-area/:AreaId", AreaHandler.deleteArea);

router.get("/get-areas-by-id/:AreaId", AreaHandler.getAreasById);

module.exports = router