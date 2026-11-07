const { handle, actingUser } = require('../../utils/http');
const Truth = require('./TruthService');
const Journey = require('./JourneyService');

exports.getScores = handle('load the truth scores', (req) => Truth.getScores(actingUser(req), req.query));
exports.getMine = handle('load your score', (req) => Truth.getMine(actingUser(req), req.query));
exports.getJourney = handle('load the doctor journey', (req) => Journey.getJourney(actingUser(req), req.query));
exports.getBrands = handle('load the brand comparison', (req) => Journey.getBrands(actingUser(req)));
