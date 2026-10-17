const express = require('express');

const router = express.Router();

const Verification = require('./DoctorVerificationHandler');
const { requirePermission } = require('../../utils/permissions');

const canSubmit = requirePermission('doctorverify.create');
const canReview = requirePermission('doctorrequests.approve');

// Provisional -> Verified: MRs send proof, the primary manager accepts / rejects;
// managers verify directly after a joint visit; admin can extend a deadline with a reason.
router.get('/doctor-verification', canSubmit, Verification.getOverview);
router.get('/doctor-verification/:verificationId', canSubmit, Verification.getVerification);
router.post('/doctor-verification/doctors/:doctorId', canSubmit, Verification.submit);
router.post('/doctor-verification/doctors/:doctorId/joint-visit', canReview, Verification.confirmJointVisit);
router.post('/doctor-verification/doctors/:doctorId/extend', requirePermission('masters.edit'), Verification.extendDeadline);
router.post('/doctor-verification/:verificationId/accept', canReview, Verification.accept);
router.post('/doctor-verification/:verificationId/reject', canReview, Verification.reject);

module.exports = router;
