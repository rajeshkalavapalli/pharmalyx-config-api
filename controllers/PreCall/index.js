const express = require('express');

const router = express.Router();

const PreCall = require('./PreCallHandler');

router.get('/precall', PreCall.getDay);
router.put('/precall/plan', PreCall.savePlan);
router.put('/precall/plan/order', PreCall.reorder);
router.delete('/precall/plan/:preCallId', PreCall.deletePlan);

module.exports = router;
