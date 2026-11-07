const { handle, actingUser } = require('../../utils/http');
const Availability = require('./AvailabilityService');

exports.getForChemist = handle('load availability', (req) => Availability.getForChemist(actingUser(req), req.query));
exports.record = handle('save availability', (req) => Availability.record(actingUser(req), req.body || {}), 201);
exports.getSummary = handle('load the availability summary', (req) => Availability.getSummary(actingUser(req), req.query));
