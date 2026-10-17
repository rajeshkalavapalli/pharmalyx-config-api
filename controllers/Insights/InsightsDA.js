const sql = require('./sql');
const { customQuery } = require('../../utils/dbFunctions');

// Sections on optional tables (orders, statements, targets, RCPA, insight tables) return [] if a table is missing.
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

exports.getRules = o('GET_RULES');
exports.upsertRule = q('UPSERT_RULE');
exports.deleteRule = q('DELETE_RULE');
exports.getActions = o('GET_ACTIONS');
exports.upsertAction = q('UPSERT_ACTION');
exports.deleteAction = q('DELETE_ACTION');

exports.getKeyDoctorLastVisits = q('KEY_DOCTOR_LAST_VISITS');
exports.getNegativeFeedback = q('NEGATIVE_FEEDBACK');
// The verification columns arrive with the doctor-verification schema.
exports.getOverdueVerification = o('OVERDUE_VERIFICATION');
exports.getGpsFlags = o('GPS_FLAGS');
exports.getRcpaShares = o('RCPA_SHARES');
exports.getRepStats = q('REP_STATS');
exports.getRepPob = o('REP_POB');
exports.getRepSales = o('REP_SALES');
exports.getLatestStock = o('LATEST_STOCK');
exports.getPobPending = o('POB_PENDING');
exports.getRecentVisits = q('RECENT_VISITS');
exports.getDoctorRcpaTotals = o('DOCTOR_RCPA_TOTALS');
exports.getDoctorPobTotals = o('DOCTOR_POB_TOTALS');
exports.getAssignedDoctors = q('ASSIGNED_DOCTORS');
exports.getMonthlyBusiness = q('MONTHLY_BUSINESS');
