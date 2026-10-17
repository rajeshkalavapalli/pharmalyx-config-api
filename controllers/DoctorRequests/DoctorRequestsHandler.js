const Service = require('./DoctorRequestsService');
const { handle, actingUser } = require('../../utils/http');

exports.getOptions = handle('load doctor form options', () => Service.getOptions());
exports.checkDuplicates = handle('check for duplicates', (req) => Service.checkDuplicates(actingUser(req), req.body || {}));
exports.uploadPhoto = handle('upload the photo', (req) => Service.uploadPhoto(actingUser(req), req.body), 201);

exports.requestNewDoctor = handle('send the new doctor', (req) => Service.requestNewDoctor(actingUser(req), req.body || {}), 201);
exports.requestChange = handle('send the change request', (req) => Service.requestChange(actingUser(req), req.params.doctorId, req.body || {}), 201);
exports.listRequests = handle('load doctor requests', (req) => Service.listRequests(actingUser(req), req.query));
exports.getRequest = handle('load the request', (req) => Service.getRequest(actingUser(req), req.params.requestId));
exports.resubmit = handle('send the request again', (req) => Service.resubmit(actingUser(req), req.params.requestId, req.body || {}), 201);
exports.cancelRequest = handle('cancel the request', (req) => Service.cancelRequest(actingUser(req), req.params.requestId));
exports.approve = handle('approve the request', (req) => Service.decide(actingUser(req), req.params.requestId, true, req.body || {}));
exports.reject = handle('reject the request', (req) => Service.decide(actingUser(req), req.params.requestId, false, req.body || {}));

exports.listFlags = handle('load duplicate flags', (req) => Service.listFlags(actingUser(req), req.query));
exports.resolveFlag = handle('resolve the flag', (req) => Service.resolveFlag(actingUser(req), req.params.flagId, req.body || {}));
exports.scanDuplicates = handle('scan for duplicates', (req) => Service.scanDuplicates(actingUser(req)));

// Photo bytes (not JSON). Only people who may see the doctor get them.
exports.getPhoto = async (req, res) => {
    try {
        const photo = await Service.getPhoto(actingUser(req), req.params.evidenceId);
        res.set('Content-Type', photo.contentType);
        res.set('Cache-Control', 'private, max-age=300');
        res.set('X-Content-Type-Options', 'nosniff');
        return res.send(photo.buffer);
    } catch (error) {
        if (!error.status) console.error('Error trying to load the photo:', error);
        return res.status(error.status || 500).json({ message: error.status ? error.message : 'Failed to load the photo.' });
    }
};
