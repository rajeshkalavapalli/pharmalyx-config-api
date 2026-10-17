const sql = require('./sql');
const { customQuery } = require('../../utils/dbFunctions');

const first = async (promise) => (await promise)[0] || null;

// Timeline sources on optional tables return [] when the table doesn't exist yet.
const optional = async (promise) => {
    try {
        return await promise;
    } catch (error) {
        if (/Invalid object name/i.test(error.message)) return [];
        throw error;
    }
};

const q = (name) => (inputs = {}) => customQuery(sql[name](), inputs);
const o = (name) => (inputs = {}) => optional(customQuery(sql[name](), inputs));
const one = (name) => (inputs = {}) => first(customQuery(sql[name](), inputs));

// Rows changed by an UPDATE (0 when its WHERE guard no longer matched).
const affected = (name) => async (inputs = {}) => {
    const result = await customQuery(sql[name](), inputs);
    return Array.isArray(result) ? result[0] || 0 : 0;
};

exports.getUser = one('GET_USER');

// Attendance
exports.getDayLog = one('GET_DAY_LOG');
exports.checkIn = q('CHECK_IN');
exports.checkOut = affected('CHECK_OUT');
exports.getLogs = q('ATT_LOGS');
exports.getVisitDays = q('ATT_VISIT_DAYS');
exports.getDcrDays = q('ATT_DCR_DAYS');
exports.getApprovedLeaves = q('ATT_LEAVES');
exports.getOffDays = q('ATT_OFF_DAYS');

// Leave
exports.getLeaveTypes = (activeOnly) => customQuery(sql.LEAVE_TYPES(), { ActiveOnly: activeOnly ? 1 : 0 });
exports.findLeaveTypeCode = one('FIND_LEAVE_TYPE_CODE');
exports.createLeaveType = q('CREATE_LEAVE_TYPE');
exports.updateLeaveType = q('UPDATE_LEAVE_TYPE');
exports.getLeaveUsed = q('LEAVE_USED');
exports.findOverlap = one('LEAVE_OVERLAP');
exports.createLeave = q('CREATE_LEAVE');
exports.getLeave = one('GET_LEAVE');
exports.setLeaveStatus = affected('SET_LEAVE_STATUS');
exports.listLeaves = q('LEAVE_LIST');
exports.pendingLeavesForManager = o('PENDING_LEAVES_FOR_MANAGER');

// Activity
exports.actAttendance = o('ACT_ATTENDANCE');
exports.actVisits = q('ACT_VISITS');
exports.actDcrs = q('ACT_DCRS');
exports.actOrders = o('ACT_ORDERS');
exports.actRcpa = o('ACT_RCPA');
exports.actLeaves = o('ACT_LEAVES');
exports.actClaims = o('ACT_CLAIMS');
exports.actTourPlans = q('ACT_TOUR_PLANS');

// Appraisals
exports.getCycles = q('CYCLES');
exports.getCycle = one('GET_CYCLE');
exports.createCycle = q('CREATE_CYCLE');
exports.closeCycle = affected('CLOSE_CYCLE');
exports.getAppraisal = one('GET_APPRAISAL');
exports.createAppraisal = q('CREATE_APPRAISAL');
exports.saveSelf = affected('SAVE_SELF');
exports.saveManager = affected('SAVE_MANAGER');
exports.getTeamAppraisals = q('TEAM_APPRAISALS');
