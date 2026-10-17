const sql = require('./sql');
const { customQuery } = require('../../utils/dbFunctions');

// Types on optional tables (statements, plans, claims) return [] if the table doesn't exist yet.
const optional = async (promise) => {
    try {
        return await promise;
    } catch (error) {
        if (/Invalid object name/i.test(error.message)) return [];
        throw error;
    }
};

const pending = (name) => (UserId) => optional(customQuery(sql[name](), { UserId }));

exports.getTourPlans = pending('TOUR_PLANS');
exports.getDeviations = pending('DEVIATIONS');
exports.getDcrs = pending('DCRS');
exports.getStatements = pending('STATEMENTS');
exports.getDoctorPlans = pending('DOCTOR_PLANS');
exports.getClaimsForManager = pending('CLAIMS_MANAGER');
exports.getClaimsForFinance = pending('CLAIMS_FINANCE');
