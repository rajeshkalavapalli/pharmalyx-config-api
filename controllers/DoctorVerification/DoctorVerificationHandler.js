const Service = require('./DoctorVerificationService');
const { handle, actingUser } = require('../../utils/http');

exports.getOverview = handle('load doctor verification', (req) => Service.getOverview(actingUser(req), req.query));
exports.getVerification = handle('load the proof', (req) => Service.getVerification(actingUser(req), req.params.verificationId));
exports.submit = handle('send the proof', (req) => Service.submit(actingUser(req), req.params.doctorId, req.body || {}), 201);
exports.confirmJointVisit = handle('confirm the joint visit', (req) => Service.confirmJointVisit(actingUser(req), req.params.doctorId, req.body || {}));
exports.accept = handle('accept the proof', (req) => Service.decide(actingUser(req), req.params.verificationId, true, req.body || {}));
exports.reject = handle('reject the proof', (req) => Service.decide(actingUser(req), req.params.verificationId, false, req.body || {}));
exports.extendDeadline = handle('extend the deadline', (req) => Service.extendDeadline(actingUser(req), req.params.doctorId, req.body || {}));
