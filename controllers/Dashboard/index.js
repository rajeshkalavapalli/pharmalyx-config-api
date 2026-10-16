const express = require('express');

const router = express.Router();

const Dashboard = require('./DashboardHandler');

router.get('/dashboard', Dashboard.getDashboard);

module.exports = router;
