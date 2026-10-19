const express = require('express');

const router = express.Router();

const Imports = require('./ImportHandler');
const { requirePermission } = require('../../utils/permissions');

const canView = requirePermission('dataimport.view');
const canImport = requirePermission('dataimport.create');

// The file arrives as the raw request body (no multipart library needed).
const rawFile = (req, res, next) =>
    express.raw({ type: () => true, limit: '15mb' })(req, res, (error) => {
        if (!error) return next();
        return res.status(error.type === 'entity.too.large' ? 413 : 400).json({
            message: error.type === 'entity.too.large' ? 'The file is larger than 15 MB. Split it into smaller files.' : 'The file could not be read.',
        });
    });

// Data Import Center: bring a company's data over from its previous MR app.
router.get('/imports', canView, Imports.getCatalogue);
router.get('/imports/template/:type', canView, Imports.getTemplate);
router.post('/imports/:type/upload', canImport, rawFile, Imports.upload);
router.get('/imports/batches/:batchId', canView, Imports.getUpload);
router.post('/imports/batches/:batchId/check', canImport, Imports.check);
router.get('/imports/batches/:batchId/issues.csv', canView, Imports.getIssues);
router.post('/imports/batches/:batchId/commit', canImport, Imports.commit);
router.post('/imports/batches/:batchId/undo', canImport, Imports.undo);
router.post('/imports/batches/:batchId/cancel', canImport, Imports.cancel);
router.post('/imports/batches/:batchId/retype', canImport, Imports.retype);

module.exports = router;
