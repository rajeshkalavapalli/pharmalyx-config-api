const express = require('express');

const router = express.Router();

const Work = require('./VerifiedWorkHandler');
const { requirePermission } = require('../../utils/permissions');

const canView = requirePermission('verifiedwork.view'); // managers: view only
const canEdit = requirePermission('verifiedwork.edit'); // head office: rules, boundaries, hospitals
const canDecide = requirePermission('verifiedwork.approve'); // head office: approve boundaries, exceptions, overrides

// MR's day: consent (once), automatic day start, live check-in, work-hour location, plan.
router.get('/work/consent', Work.getConsent);
router.post('/work/consent', Work.acceptConsent);
router.post('/work/day/start', Work.startDay);
router.get('/work/today', Work.getToday);
router.post('/work/check-in', Work.checkIn);
router.post('/work/pings', Work.recordPings);
router.get('/work/plan', Work.getMonthPlan);
router.get('/work/people', Work.getPeople);
router.get('/work/doctors', canView, Work.getDoctorsOf);
router.get('/work/coverage', canView, Work.getCoverage);

// Standard tour plan: MR + manager prepare, head office approves; the month plan is generated from it.
router.get('/stp', requirePermission('stp.view'), Work.getStp);
router.put('/stp', requirePermission('stp.create'), Work.saveStp);
router.post('/stp/generate', requirePermission('stp.create'), Work.generateMonth);
router.get('/stp/submitted', requirePermission('stp.approve'), Work.listSubmittedStps);
router.post('/stp/:stpId/submit', requirePermission('stp.create'), Work.submitStp);
router.post('/stp/:stpId/withdraw', requirePermission('stp.create'), Work.withdrawStp);
router.post('/stp/:stpId/approve', requirePermission('stp.approve'), Work.approveStp);
router.post('/stp/:stpId/return', requirePermission('stp.approve'), Work.returnStp);

// Valid / not counted visits: managers view, head office overrides (with a reason, audited).
router.get('/work/visits', canView, Work.listVisits);
router.post('/work/visits/:visitId/override', canDecide, Work.overrideVisit);
router.get('/work/flags', canView, Work.listFlags);
router.post('/work/flags/:flagId', canDecide, Work.actOnFlag);

// Head office set-up.
router.get('/work/settings', canView, Work.getSettings);
router.put('/work/settings', canEdit, Work.saveSettings);
router.get('/work/boundaries', canView, Work.listBoundaries);
router.post('/work/boundaries/users/:userId', canEdit, Work.draftBoundary);
router.post('/work/boundaries/:boundaryId/approve', canDecide, Work.approveBoundary);
router.get('/work/exceptions', canView, Work.listExceptions);
router.post('/work/exceptions', canDecide, Work.grantException);
router.post('/work/exceptions/:exceptionId/revoke', canDecide, Work.revokeException);
router.get('/work/hospitals', canView, Work.listHospitals);
router.post('/work/hospitals', canEdit, Work.createHospital);
router.put('/work/hospitals/:hospitalId', canEdit, Work.updateHospital);
router.get('/work/hospitals/:hospitalId/doctors', canView, Work.hospitalDoctors);
router.post('/work/hospitals/:hospitalId/doctors', canEdit, Work.setHospitalDoctors);

module.exports = router;
