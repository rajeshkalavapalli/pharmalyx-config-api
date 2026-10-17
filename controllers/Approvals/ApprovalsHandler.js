const ApprovalsService = require('./ApprovalsService');
const { handle, actingUser } = require('../../utils/http');

exports.getInbox = handle('load approvals', (req) => ApprovalsService.getInbox(actingUser(req)));

exports.decide = handle('update the approval', (req) =>
    ApprovalsService.decide(actingUser(req), req.params.type, req.params.id, req.params.decision, req.body || {}));
