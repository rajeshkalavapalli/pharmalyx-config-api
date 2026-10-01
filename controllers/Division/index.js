const express = require('express');

const router = express.Router();

const {createDivision, getDivisions, getDivisionById, updateDivision, deleteDivision} = require('../Division/divisionHandler')


router.post("/create-division",createDivision)
router.get("/get-divisions",getDivisions)
router.get("/get-division/:divisionId", getDivisionById)
router.put("/update-division/:divisionId", updateDivision)
router.delete("/delete-division/:divisionId", deleteDivision)



module.exports = router;