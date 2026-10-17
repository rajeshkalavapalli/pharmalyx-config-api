const express = require('express');

const router = express.Router();

const Approvals = require('./ApprovalsHandler');

// One inbox for everything waiting on the signed-in user. Each type keeps its own permission
// and approver rules (checked in the service and in the module it delegates to).
router.get('/approvals', Approvals.getInbox);
router.post('/approvals/:type/:id/:decision', Approvals.decide);

module.exports = router;
