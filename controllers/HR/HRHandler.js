const AttendanceService = require('./AttendanceService');
const LeaveService = require('./LeaveService');
const ActivityService = require('./ActivityService');
const AppraisalService = require('./AppraisalService');
const { handle, actingUser } = require('../../utils/http');

// Attendance
exports.getToday = handle('load today\'s attendance', (req) => AttendanceService.getToday(actingUser(req)));
exports.checkIn = handle('check in', (req) => AttendanceService.checkIn(actingUser(req), req.body || {}));
exports.checkOut = handle('check out', (req) => AttendanceService.checkOut(actingUser(req), req.body || {}));
exports.getMonth = handle('load attendance', (req) => AttendanceService.getMonth(actingUser(req), req.query));

// Leave
exports.getLeave = handle('load leave', (req) => LeaveService.getLeave(actingUser(req), req.query));
exports.getLeaveTypes = handle('load leave types', () => LeaveService.getTypes());
exports.applyLeave = handle('apply for leave', (req) => LeaveService.apply(actingUser(req), req.body || {}));
exports.cancelLeave = handle('cancel leave', (req) => LeaveService.cancel(actingUser(req), req.params.leaveId));
exports.approveLeave = handle('approve leave', (req) => LeaveService.review(actingUser(req), req.params.leaveId, true, req.body?.Remarks));
exports.rejectLeave = handle('reject leave', (req) => LeaveService.review(actingUser(req), req.params.leaveId, false, req.body?.Remarks));
exports.createLeaveType = handle('save the leave type', (req) => LeaveService.saveType(actingUser(req), null, req.body || {}));
exports.updateLeaveType = handle('save the leave type', (req) => LeaveService.saveType(actingUser(req), req.params.leaveTypeId, req.body || {}));

// Activity
exports.getActivity = handle('load activity', (req) => ActivityService.getActivity(actingUser(req), req.query));

// Appraisals
exports.getCycles = handle('load appraisal cycles', () => AppraisalService.getCycles());
exports.getCycle = handle('load the appraisal cycle', (req) => AppraisalService.getCycle(actingUser(req), req.params.cycleId));
exports.getAppraisal = handle('load the appraisal', (req) => AppraisalService.getAppraisal(actingUser(req), req.params.cycleId, req.query.userId));
exports.saveSelf = handle('save the self-review', (req) => AppraisalService.saveSelf(actingUser(req), req.params.cycleId, req.body || {}));
exports.saveManager = handle('save the manager review', (req) => AppraisalService.saveManager(actingUser(req), req.params.cycleId, req.params.userId, req.body || {}));
exports.createCycle = handle('open the appraisal cycle', (req) => AppraisalService.createCycle(actingUser(req), req.body || {}));
exports.closeCycle = handle('close the appraisal cycle', (req) => AppraisalService.closeCycle(actingUser(req), req.params.cycleId));
