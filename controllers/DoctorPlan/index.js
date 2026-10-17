const express = require('express');

const router = express.Router();

const DoctorPlan = require('./DoctorPlanHandler');
const { requirePermission } = require('../../utils/permissions');

router.get('/plans/doctors', requirePermission('doctorplan.view'), DoctorPlan.getPlan);
router.put('/plans/doctors/item', requirePermission('doctorplan.create'), DoctorPlan.saveDoctor);
router.post('/plans/doctors/submit', requirePermission('doctorplan.create'), DoctorPlan.submitPlan);
router.get('/plans/doctors/reviews', requirePermission('doctorplan.approve'), DoctorPlan.getReviews);
router.get('/plans/doctors/:planId', requirePermission('doctorplan.view'), DoctorPlan.getPlanById);
router.post('/plans/doctors/:planId/approve', requirePermission('doctorplan.approve'), DoctorPlan.approvePlan);
router.post('/plans/doctors/:planId/return', requirePermission('doctorplan.approve'), DoctorPlan.returnPlan);

module.exports = router;
