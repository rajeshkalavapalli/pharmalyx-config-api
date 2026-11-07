const { handle, actingUser } = require('../../utils/http');
const Audits = require('./AuditsService');

exports.getToday = handle("load today's audits", (req) => Audits.getToday(actingUser(req)));
exports.list = handle('load audits', (req) => Audits.list(actingUser(req), req.query));
exports.assignCross = handle('assign the cross-audit', (req) => Audits.assignCross(actingUser(req), req.body || {}), 201);
exports.checkIn = handle('check in for the audit', (req) => Audits.checkIn(actingUser(req), req.params.auditId, req.body || {}));
exports.decide = handle('save the audit result', (req) => Audits.decide(actingUser(req), req.params.auditId, req.body || {}));
