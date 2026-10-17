const sql = require('./sql');
const { customQuery, runInTransaction } = require('../../utils/dbFunctions');

const first = async (promise) => (await promise)[0] || null;
const exists = async (promise) => (await promise).length > 0;
const q = (name) => (inputs = {}) => customQuery(sql[name](), inputs);
const one = (name) => (inputs = {}) => first(customQuery(sql[name](), inputs));

exports.getSettings = q('GET_SETTINGS');
exports.getUser = one('GET_USER');
exports.getDoctor = one('GET_DOCTOR');
exports.isOwnDoctor = (inputs) => exists(customQuery(sql.IS_OWN_DOCTOR(), inputs));
exports.canSeeDoctor = (inputs) => exists(customQuery(sql.CAN_SEE_DOCTOR(), inputs));
exports.pendingForDoctor = one('PENDING_FOR_DOCTOR');
exports.valueClash = one('VALUE_CLASH');
exports.managerVisit = one('MANAGER_VISIT');
exports.getVerification = one('GET_VERIFICATION');
exports.provisionalDoctors = q('PROVISIONAL_DOCTORS');
exports.listVerifications = q('LIST_VERIFICATIONS');
exports.pendingForApprover = q('PENDING_FOR_APPROVER');

// Proof (+ photo) + audit, all or nothing. When `verified` is given the doctor is marked verified too.
exports.submit = ({ verification, evidence, verified, audit }) =>
    runInTransaction([
        ...(evidence ? [{ sqlQuery: sql.INSERT_EVIDENCE(), inputs: evidence }] : []),
        { sqlQuery: sql.INSERT_VERIFICATION(), inputs: verification },
        ...(verified ? [{ sqlQuery: sql.MARK_VERIFIED(), inputs: verified }] : []),
        audit,
    ]);

exports.decide = ({ decision, verified, audit }) =>
    runInTransaction([
        { sqlQuery: sql.DECIDE(), inputs: decision },
        ...(verified ? [{ sqlQuery: sql.MARK_VERIFIED(), inputs: verified }] : []),
        audit,
    ]);

exports.extend = async (inputs, audit) => {
    const [result] = await runInTransaction([{ sqlQuery: sql.EXTEND_DEADLINE(), inputs }, audit]);
    return result.rowsAffected[0] || 0;
};
