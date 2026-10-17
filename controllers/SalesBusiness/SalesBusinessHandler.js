const SalesBusinessService = require('./SalesBusinessService');
const { handle, actingUser } = require('../../utils/http');

exports.getBusiness = handle('load business summary', (req) => SalesBusinessService.getBusiness(actingUser(req), req.query));
