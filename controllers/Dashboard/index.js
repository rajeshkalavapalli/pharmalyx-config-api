const express = require('express');

const router = express.Router();

const Dashboard = require('./DashboardHandler');

router.get('/dashboard', Dashboard.getDashboard);
router.get('/dashboard/modules/:section', Dashboard.getModule);

module.exports = router;
