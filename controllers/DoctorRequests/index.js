const express = require('express');

const router = express.Router();

const Doctors = require('./DoctorRequestsHandler');
const { requirePermission } = require('../../utils/permissions');

const canRequest = requirePermission('doctorrequests.create');
const canApprove = requirePermission('doctorrequests.approve');

// Photos arrive as the raw image body (no multipart library needed); 5 MB plus headroom.
const rawImage = (req, res, next) =>
    express.raw({ type: () => true, limit: '6mb' })(req, res, (error) => {
        if (!error) return next();
        return res.status(error.type === 'entity.too.large' ? 413 : 400).json({
            message: error.type === 'entity.too.large' ? 'Photo is larger than 5 MB.' : 'The photo could not be read.',
        });
    });

// Field flow: add a doctor, or request an edit / delete with a reason; the primary manager decides.
router.get('/doctor-requests/options', canRequest, Doctors.getOptions);
router.post('/doctor-requests/check', canRequest, Doctors.checkDuplicates);
router.post('/doctor-requests/photo', canRequest, rawImage, Doctors.uploadPhoto);
router.post('/doctor-requests', canRequest, Doctors.requestNewDoctor);
router.post('/doctor-requests/doctors/:doctorId/change', canRequest, Doctors.requestChange);
router.get('/doctor-requests', canRequest, Doctors.listRequests);
router.get('/doctor-requests/:requestId', canRequest, Doctors.getRequest);
router.post('/doctor-requests/:requestId/cancel', canRequest, Doctors.cancelRequest);
router.post('/doctor-requests/:requestId/resubmit', canRequest, Doctors.resubmit);
router.post('/doctor-requests/:requestId/approve', canApprove, Doctors.approve);
router.post('/doctor-requests/:requestId/reject', canApprove, Doctors.reject);

// Possible duplicates: list / resolve for managers, scan of all doctors for admin.
router.get('/doctor-duplicates', requirePermission('fraudflags.view'), Doctors.listFlags);
router.post('/doctor-duplicates/scan', requirePermission('masters.edit'), Doctors.scanDuplicates);
router.post('/doctor-duplicates/:flagId/resolve', canApprove, Doctors.resolveFlag);

// Evidence photos.
router.get('/doctor-evidence/:evidenceId', canRequest, Doctors.getPhoto);

module.exports = router;
