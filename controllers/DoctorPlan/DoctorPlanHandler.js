const DoctorPlanService = require('./DoctorPlanService');
const { handle, actingUser } = require('../../utils/http');

exports.getPlan = handle('load doctor plan', (req) => DoctorPlanService.getPlan(actingUser(req), req.query));

exports.saveDoctor = handle('save doctor plan', (req) => DoctorPlanService.saveDoctor(actingUser(req), req.body || {}));

exports.submitPlan = handle('submit doctor plan', (req) => DoctorPlanService.submitPlan(actingUser(req), req.body || {}));

exports.getReviews = handle('load plans to review', (req) => DoctorPlanService.getReviews(actingUser(req)));

exports.getPlanById = handle('load doctor plan', (req) => DoctorPlanService.getPlanById(actingUser(req), req.params.planId));

exports.approvePlan = handle('approve doctor plan', (req) =>
    DoctorPlanService.reviewPlan(actingUser(req), req.params.planId, 'APPROVED', req.body?.Remarks));

exports.returnPlan = handle('return doctor plan', (req) =>
    DoctorPlanService.reviewPlan(actingUser(req), req.params.planId, 'RETURNED', req.body?.Remarks));
