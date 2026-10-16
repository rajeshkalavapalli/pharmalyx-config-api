const express = require('express');

const router = express.Router();

const MyDoctors = require('./MyDoctorsHandler');

router.get('/my-doctors', MyDoctors.getMyDoctors);
router.get('/my-doctors/team', MyDoctors.getTeam);

module.exports = router;
