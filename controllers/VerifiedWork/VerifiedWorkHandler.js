const Work = require('./VerifiedWorkService');
const HeadOffice = require('./HeadOfficeService');
const Stp = require('./StpService');
const Explanations = require('./ExplanationService');
const VisitsDA = require('../Visits/VisitsDA');
const { handle, actingUser } = require('../../utils/http');

// MR: consent, day start, check-in, location pings, today's plan
exports.getConsent = handle('load the location consent', (req) => Work.getConsent(actingUser(req)));
exports.acceptConsent = handle('save the location consent', (req) => Work.acceptConsent(actingUser(req), req.body || {}, req.get('user-agent')));
exports.startDay = handle('start the work day', (req) => Work.startDayFromPlan(actingUser(req), req.body || {}));
exports.getToday = handle("load today's plan", (req) => Work.getToday(actingUser(req)));
exports.checkIn = handle('check in', (req) => Work.checkIn(actingUser(req), req.body || {}, VisitsDA), 201);
exports.recordPings = handle('record the location', (req) => Work.recordPings(actingUser(req), req.body || {}, String(req.body?.Source || 'WEB').toUpperCase()));
exports.getMonthPlan = handle('load the month plan', (req) => Work.getMonthPlan(actingUser(req), req.query));
exports.getCoverage = handle('load coverage', (req) => Work.getCoverage(actingUser(req), req.query));
exports.getDoctorsOf = handle('load doctors', (req) => Work.getDoctorsOf(actingUser(req), req.query));
exports.getPeople = handle('load the team', (req) => Work.getScopeUsers(actingUser(req)));

// Standard tour plan
exports.getStp = handle('load the standard tour plan', (req) => Stp.getStp(actingUser(req), req.query));
exports.saveStp = handle('save the standard tour plan', (req) => Stp.saveStp(actingUser(req), req.body || {}));
exports.submitStp = handle('send the standard tour plan', (req) => Stp.submitStp(actingUser(req), req.params.stpId));
exports.withdrawStp = handle('take the plan back', (req) => Stp.withdrawStp(actingUser(req), req.params.stpId));
exports.listSubmittedStps = handle('load plans to approve', () => Stp.listSubmitted());
exports.approveStp = handle('approve the standard tour plan', (req) => Stp.decideStp(actingUser(req), req.params.stpId, true, req.body || {}));
exports.returnStp = handle('return the standard tour plan', (req) => Stp.decideStp(actingUser(req), req.params.stpId, false, req.body || {}));
exports.generateMonth = handle('generate the tour plan', (req) => Stp.generateMonth(actingUser(req), req.body || {}));

// Review (managers view) and head office
exports.listVisits = handle('load visits', (req) => HeadOffice.listVisits(actingUser(req), req.query));
exports.overrideVisit = handle('override the visit', (req) => HeadOffice.overrideVisit(actingUser(req), req.params.visitId, req.body || {}));
exports.listFlags = handle('load red flags', (req) => HeadOffice.listFlags(actingUser(req), req.query));
exports.actOnFlag = handle('update the flag', (req) => HeadOffice.actOnFlag(actingUser(req), req.params.flagId, req.body || {}));
exports.getSettings = handle('load rule values', () => HeadOffice.getSettings());
exports.saveSettings = handle('save rule values', (req) => HeadOffice.saveSettings(actingUser(req), req.body || {}));
exports.listBoundaries = handle('load boundaries', (req) => HeadOffice.listBoundaries(actingUser(req)));
exports.draftBoundary = handle('save the boundary', (req) => HeadOffice.draftBoundary(actingUser(req), req.params.userId, req.body || {}), 201);
exports.approveBoundary = handle('approve the boundary', (req) => HeadOffice.approveBoundary(actingUser(req), req.params.boundaryId, req.body || {}));
exports.listExceptions = handle('load exceptions', (req) => HeadOffice.listExceptions(actingUser(req)));
exports.grantException = handle('grant the exception', (req) => HeadOffice.grantException(actingUser(req), req.body || {}), 201);
exports.revokeException = handle('revoke the exception', (req) => HeadOffice.revokeException(actingUser(req), req.params.exceptionId, req.body || {}));
exports.listHospitals = handle('load hospitals', () => HeadOffice.listHospitals());
exports.createHospital = handle('add the hospital', (req) => HeadOffice.saveHospital(actingUser(req), null, req.body || {}), 201);
exports.updateHospital = handle('save the hospital', (req) => HeadOffice.saveHospital(actingUser(req), req.params.hospitalId, req.body || {}));
exports.hospitalDoctors = handle('load hospital doctors', (req) => HeadOffice.hospitalDoctors(req.params.hospitalId, req.query));
exports.setHospitalDoctors = handle('update hospital doctors', (req) => HeadOffice.setHospitalDoctors(actingUser(req), req.params.hospitalId, req.body || {}));

// Visit explanations: employee explains; manager / head office decides.
exports.explainVisit = handle('send the explanation', (req) => Explanations.explain(actingUser(req), req.params.visitId, req.body || {}), 201);
exports.listExplanations = handle('load the explanations', async (req) => ({ explanations: await Explanations.listPending(actingUser(req)) }));
exports.acceptExplanation = handle('accept the explanation', (req) => Explanations.decide(actingUser(req), req.params.visitId, true, req.body || {}));
exports.rejectExplanation = handle('reject the explanation', (req) => Explanations.decide(actingUser(req), req.params.visitId, false, req.body || {}));
