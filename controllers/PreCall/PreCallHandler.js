const PreCallService = require('./PreCallService');
const { handle, actingUser } = require('../../utils/http');

exports.getDay = handle('load pre-call plan', (req) => PreCallService.getDay(actingUser(req), req.query));

exports.savePlan = handle('save call plan', (req) => PreCallService.savePlan(actingUser(req), req.body || {}));

exports.deletePlan = handle('remove planned call', (req) => PreCallService.deletePlan(actingUser(req), req.params.preCallId));

exports.reorder = handle('reorder call plan', (req) => PreCallService.reorder(actingUser(req), req.body || {}));
