const express = require('express');

const router = express.Router();

const Spend = require('./SpendHandler');
const { requirePermission } = require('../../utils/permissions');

const canView = requirePermission('spend.view'); // MR, manager, head office (scope checked in the service)
const canRequest = requirePermission('spend.create'); // MR
const canRecommend = requirePermission('spend.edit'); // manager: recommend only
const headOffice = requirePermission('spend.approve'); // head office: types, approval, payment

// Supporting documents arrive as the raw file body (PDF or photo); 10 MB plus headroom.
const rawFile = (req, res, next) =>
    express.raw({ type: () => true, limit: '11mb' })(req, res, (error) => {
        if (!error) return next();
        return res.status(error.type === 'entity.too.large' ? 413 : 400).json({
            message: error.type === 'entity.too.large' ? 'File is larger than 10 MB.' : 'The file could not be read.',
        });
    });

router.get('/spend/config', canView, Spend.getConfig);
router.get('/spend/requests', canView, Spend.listRequests);
router.get('/spend/reports', canView, Spend.getReports);
router.get('/spend/requests/:requestId/document', canView, Spend.getDocument);

router.post('/spend/requests', canRequest, Spend.createRequest);
router.post('/spend/requests/:requestId/recommend', canRecommend, Spend.recommend);

router.post('/spend/requests/:requestId/decide', headOffice, Spend.decide);
router.post('/spend/documents', headOffice, rawFile, Spend.uploadDocument);
router.post('/spend/requests/:requestId/disburse', headOffice, Spend.disburse);
router.post('/spend/types', headOffice, Spend.createType);
router.put('/spend/types/:typeId', headOffice, Spend.updateType);

module.exports = router;
