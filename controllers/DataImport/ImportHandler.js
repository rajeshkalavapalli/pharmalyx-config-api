const { handle, actingUser } = require('../../utils/http');
const Import = require('./ImportService');

const sendFile = (res, { fileName, buffer, text }, contentType) => {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName.replace(/[^\w.-]+/g, '_')}"`);
    return res.send(buffer ?? text);
};

// Errors as JSON, like `handle`, for the two download routes.
const download = (label, work, contentType) => async (req, res) => {
    try {
        return sendFile(res, await work(req), contentType);
    } catch (error) {
        if (!error.status) console.error(`Error trying to ${label}:`, error);
        return res.status(error.status || 500).json({ message: error.status ? error.message : `Failed to ${label}.`, error: error.message });
    }
};

const fileName = (req) => {
    try {
        return decodeURIComponent(req.get('x-file-name') || '');
    } catch {
        return req.get('x-file-name') || '';
    }
};

exports.getCatalogue = handle('load imports', () => Import.getCatalogue());

exports.getTemplate = download(
    'build the template',
    (req) => Import.buildTemplate(String(req.params.type || '').toUpperCase()),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
);

exports.upload = handle(
    'upload the file',
    (req) =>
        Import.upload(actingUser(req), String(req.params.type || '').toUpperCase(), {
            fileName: fileName(req),
            sourceSystem: req.query.source,
            buffer: Buffer.isBuffer(req.body) ? req.body : null,
        }),
    201
);

exports.getUpload = handle('load the import', (req) => Import.getUpload(req.params.batchId));
exports.check = handle('check the file', (req) => Import.check(actingUser(req), req.params.batchId, req.body || {}));
exports.getIssues = download('download the rows to fix', (req) => Import.issuesCsv(req.params.batchId), 'text/csv; charset=utf-8');
exports.commit = handle('import the data', (req) => Import.commit(actingUser(req), req.params.batchId));
exports.undo = handle('undo the import', (req) => Import.undo(actingUser(req), req.params.batchId));
exports.retype = handle('change the import type', (req) => Import.retype(actingUser(req), req.params.batchId, String(req.body?.type || '').toUpperCase()));
exports.cancel = handle('cancel the import', (req) => Import.cancel(req.params.batchId));
