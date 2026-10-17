const SalesPlanService = require('./SalesPlanService');
const { handle, actingUser } = require('../../utils/http');

exports.getPlan = handle('load sales plan', (req) => SalesPlanService.getPlan(actingUser(req), req.query));

exports.getTeam = handle('load team sales plan', (req) => SalesPlanService.getTeam(actingUser(req), req.query));

exports.getTargetForm = handle('load targets', (req) => SalesPlanService.getTargetForm(actingUser(req), req.query));

exports.saveTargets = handle('save targets', (req) => SalesPlanService.saveTargets(actingUser(req), req.body || {}));
