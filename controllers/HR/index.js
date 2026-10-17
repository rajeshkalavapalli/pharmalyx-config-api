const express = require('express');

const router = express.Router();

const HR = require('./HRHandler');
const { requirePermission } = require('../../utils/permissions');

// Attendance
router.get('/attendance/today', requirePermission('attendance.view'), HR.getToday);
router.post('/attendance/check-in', requirePermission('attendance.create'), HR.checkIn);
router.post('/attendance/check-out', requirePermission('attendance.create'), HR.checkOut);
router.get('/attendance/month', requirePermission('attendance.view'), HR.getMonth);

// Leave
router.get('/leave', requirePermission('leave.view'), HR.getLeave);
router.get('/leave/types', requirePermission('leave.view'), HR.getLeaveTypes);
router.post('/leave', requirePermission('leave.create'), HR.applyLeave);
router.post('/leave/:leaveId/cancel', requirePermission('leave.create'), HR.cancelLeave);
router.post('/leave/:leaveId/approve', requirePermission('leave.approve'), HR.approveLeave);
router.post('/leave/:leaveId/reject', requirePermission('leave.approve'), HR.rejectLeave);
router.post('/leave/types', requirePermission('hrsettings.edit'), HR.createLeaveType);
router.put('/leave/types/:leaveTypeId', requirePermission('hrsettings.edit'), HR.updateLeaveType);

// Activity
router.get('/activity', requirePermission('activity.view'), HR.getActivity);

// Appraisals
router.get('/appraisals/cycles', requirePermission('appraisal.view'), HR.getCycles);
router.post('/appraisals/cycles', requirePermission('hrsettings.edit'), HR.createCycle);
router.post('/appraisals/cycles/:cycleId/close', requirePermission('hrsettings.edit'), HR.closeCycle);
router.get('/appraisals/cycles/:cycleId', requirePermission('appraisal.view'), HR.getCycle);
router.get('/appraisals/cycles/:cycleId/review', requirePermission('appraisal.view'), HR.getAppraisal);
router.put('/appraisals/cycles/:cycleId/self', requirePermission('appraisal.edit'), HR.saveSelf);
router.put('/appraisals/cycles/:cycleId/manager/:userId', requirePermission('appraisal.edit'), HR.saveManager);

module.exports = router;
