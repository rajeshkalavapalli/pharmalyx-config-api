const express = require('express');

const router = express.Router();

const {createDivision, getDivisions} = require('../Division/divisionHandler')


router.post("/create-division",createDivision)
router.get("/get-divisions",getDivisions)


module.exports = router;