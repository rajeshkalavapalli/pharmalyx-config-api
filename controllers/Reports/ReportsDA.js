const sql = require('./sql');
const { customQuery } = require('../../utils/dbFunctions');

const first = async (promise) => (await promise)[0] || null;

exports.getCallTotals = (inputs) => first(customQuery(sql.CALL_TOTALS(), inputs));

exports.getCallsByDay = (inputs) => customQuery(sql.CALLS_BY_DAY(), inputs);

exports.getCallsByEmployee = (inputs) => customQuery(sql.CALLS_BY_EMPLOYEE(), inputs);

exports.getCallRows = (inputs) => customQuery(sql.CALL_ROWS(), inputs);

// Sections built on optional tables (orders, statements, targets, stock, expenses):
// a missing table yields null instead of failing the whole report.
exports.optional = async (promise) => {
    try {
        return await promise;
    } catch (error) {
        if (/Invalid object name/i.test(error.message)) return null;
        throw error;
    }
};

exports.getDoctorAssignments = (inputs) => customQuery(sql.DOCTOR_ASSIGNMENTS(), inputs);

exports.getMissedPlannedCalls = (inputs) => customQuery(sql.MISSED_PLANNED_CALLS(), inputs);

exports.getMissedFieldDays = (inputs) => customQuery(sql.MISSED_FIELD_DAYS(), inputs);

exports.getPobLines = (inputs) => customQuery(sql.POB_LINES(), inputs);

exports.getSecondaryLines = (inputs) => customQuery(sql.SECONDARY_LINES(), inputs);

exports.getTargets = (inputs) => customQuery(sql.TARGETS(), inputs);

exports.getCallsByMonth = (inputs) => customQuery(sql.CALLS_BY_MONTH(), inputs);

exports.getFeedbackSplit = (inputs) => customQuery(sql.FEEDBACK_SPLIT(), inputs);

exports.getEngagementTotals = (inputs) => customQuery(sql.ENGAGEMENT_TOTALS(), inputs);

exports.getExpensesByMonth = (inputs) => customQuery(sql.EXPENSES_BY_MONTH(), inputs);
