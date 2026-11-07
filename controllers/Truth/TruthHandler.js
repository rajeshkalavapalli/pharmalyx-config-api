const { handle, actingUser } = require('../../utils/http');
const Truth = require('./TruthService');

exports.getScores = handle('load the truth scores', (req) => Truth.getScores(actingUser(req), req.query));
exports.getMine = handle('load your score', (req) => Truth.getMine(actingUser(req), req.query));
