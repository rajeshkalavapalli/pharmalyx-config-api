const JointWork = require('./JointWorkService');
const { handle, actingUser } = require('../../utils/http');

exports.list = handle('load joint work', (req) => JointWork.list(actingUser(req), req.query));
exports.pending = handle('load joint work requests', (req) => JointWork.pendingCount(actingUser(req)));
exports.request = handle('ask for joint work', (req) => JointWork.request(actingUser(req), req.body || {}), 201);
exports.respond = handle('answer the joint work request', (req) => JointWork.respond(actingUser(req), req.params.jointWorkId, req.body || {}));
exports.feedback = handle('save the joint work feedback', (req) => JointWork.feedback(actingUser(req), req.params.jointWorkId, req.body || {}));
exports.cancel = handle('cancel the joint work request', (req) => JointWork.cancel(actingUser(req), req.params.jointWorkId));
