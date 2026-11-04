const express = require('express');

const router = express.Router();

const JointWork = require('./JointWorkHandler');

// Every signed-in person: the service checks who is the field person and who is the colleague.
router.get('/joint-work', JointWork.list);
router.get('/joint-work/pending', JointWork.pending);
router.post('/joint-work', JointWork.request);
router.post('/joint-work/:jointWorkId/respond', JointWork.respond);
router.post('/joint-work/:jointWorkId/feedback', JointWork.feedback);
router.delete('/joint-work/:jointWorkId', JointWork.cancel);

module.exports = router;
