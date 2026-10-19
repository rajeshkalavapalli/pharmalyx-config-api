const Spend = require('./SpendService');
const { handle, actingUser } = require('../../utils/http');

const sendFile = (label, work) => async (req, res) => {
    try {
        const { buffer, contentType } = await work(req);
        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'private, max-age=300');
        return res.send(buffer);
    } catch (error) {
        if (!error.status) console.error(`Error trying to ${label}:`, error);
        return res.status(error.status || 500).json({ message: error.status ? error.message : `Failed to ${label}.` });
    }
};

exports.getConfig = handle('load doctor spend settings', (req) => Spend.getConfig(actingUser(req)));
exports.listRequests = handle('load spend requests', (req) => Spend.listRequests(actingUser(req), req.query));
exports.getReports = handle('load spend reports', (req) => Spend.getReports(actingUser(req)));
exports.createRequest = handle('send the request', (req) => Spend.createRequest(actingUser(req), req.body || {}), 201);
exports.recommend = handle('save the recommendation', (req) => Spend.recommend(actingUser(req), req.params.requestId, req.body || {}));
exports.decide = handle('save the decision', (req) => Spend.decide(actingUser(req), req.params.requestId, req.body || {}));
exports.uploadDocument = handle('upload the document', (req) => Spend.uploadDocument(actingUser(req), req.body), 201);
exports.disburse = handle('record the payment', (req) => Spend.disburse(actingUser(req), req.params.requestId, req.body || {}));
exports.getDocument = sendFile('load the document', (req) => Spend.getDocument(actingUser(req), req.params.requestId));
exports.createType = handle('save the activity type', (req) => Spend.saveType(actingUser(req), null, req.body || {}), 201);
exports.updateType = handle('save the activity type', (req) => Spend.saveType(actingUser(req), req.params.typeId, req.body || {}));
