const RcpaService = require('./RcpaService');
const { handle, actingUser } = require('../../utils/http');

exports.getRcpa = handle('load RCPA', (req) => RcpaService.getRcpa(actingUser(req), req.query));

exports.getPharmacies = handle('load chemists', (req) => RcpaService.getPharmacies(actingUser(req)));

exports.createRcpa = handle('save RCPA', (req) => RcpaService.createRcpa(actingUser(req), req.body || {}));
