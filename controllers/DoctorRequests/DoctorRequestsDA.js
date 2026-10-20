const sql = require('./sql');
const { customQuery, runInTransaction } = require('../../utils/dbFunctions');

const first = async (promise) => (await promise)[0] || null;
const exists = async (promise) => (await promise).length > 0;
const q = (name) => (inputs = {}) => customQuery(sql[name](), inputs);

// Lookups
exports.getSettings = q('GET_SETTINGS');
exports.getUser = (UserId) => first(customQuery(sql.GET_USER(), { UserId }));
exports.getAreas = q('AREAS');
exports.getSpecialities = q('SPECIALITIES');
exports.areaInTerritory = (AreaId, TerritoryId) => exists(customQuery(sql.AREA_IN_TERRITORY(), { AreaId, TerritoryId }));
exports.isMapped = (UserId, DoctorId) => exists(customQuery(sql.IS_MAPPED(), { UserId, DoctorId }));
exports.getDoctor = (DoctorId) => first(customQuery(sql.GET_DOCTOR(), { DoctorId }));
exports.canSeeDoctor = (inputs) => exists(customQuery(sql.CAN_SEE_DOCTOR(), inputs));

// Duplicate candidates
exports.candidatesNearby = q('CANDIDATES_NEARBY');
exports.candidatesSameArea = q('CANDIDATES_SAME_AREA');
exports.candidatesPhone = q('CANDIDATES_PHONE');
exports.candidatesRegistration = q('CANDIDATES_REGISTRATION');
exports.allLiveDoctors = q('ALL_LIVE_DOCTORS');
exports.flagsForDoctor = (DoctorId) => customQuery(sql.FLAGS_FOR_DOCTOR(), { DoctorId });
exports.listFlags = q('LIST_FLAGS');
exports.getFlag = (FlagId) => first(customQuery(sql.GET_FLAG(), { FlagId }));

exports.saveScan = (names, flags) =>
    runInTransaction([
        ...names.map((inputs) => ({ sqlQuery: sql.SET_NORMALIZED_NAME(), inputs })),
        ...flags.map((inputs) => ({ sqlQuery: sql.INSERT_FLAG(), inputs })),
    ]);

exports.resolveFlag = async (inputs, audit) => {
    const [result] = await runInTransaction([{ sqlQuery: sql.RESOLVE_FLAG(), inputs }, audit]);
    return result.rowsAffected[0] || 0;
};

// Requests
exports.pendingForDoctor = (DoctorId) => first(customQuery(sql.PENDING_FOR_DOCTOR(), { DoctorId }));
exports.resubmissionOf = (RequestId, DoctorId) => first(customQuery(sql.RESUBMISSION_OF(), { RequestId, DoctorId }));
exports.getRequest = (RequestId) => first(customQuery(sql.GET_REQUEST(), { RequestId }));
exports.listRequests = q('LIST_REQUESTS');
exports.pendingForApprover = q('PENDING_FOR_APPROVER');

// New doctor + its request + signboard photo (if taken) + duplicate flags + audit, all or nothing.
exports.createDoctorRequest = ({ doctor, evidence, request, flags, audit }) =>
    runInTransaction([
        { sqlQuery: sql.CREATE_FIELD_DOCTOR(), inputs: doctor },
        ...(evidence ? [{ sqlQuery: sql.INSERT_EVIDENCE(), inputs: evidence }] : []),
        { sqlQuery: sql.INSERT_REQUEST(), inputs: request },
        ...flags.map((inputs) => ({ sqlQuery: sql.INSERT_FLAG(), inputs })),
        audit,
    ]);

// Edit / delete request (doctor unchanged until approved).
exports.createChangeRequest = ({ request, evidence, audit }) =>
    runInTransaction([
        { sqlQuery: sql.GUARD_NO_PENDING(), inputs: { DoctorId: request.DoctorId } },
        ...(evidence ? [{ sqlQuery: sql.INSERT_EVIDENCE(), inputs: evidence }] : []),
        { sqlQuery: sql.INSERT_REQUEST(), inputs: request },
        audit,
    ]);

// Rejected new doctor sent again: corrected doctor + new request (+ new photo, new flags) + audit.
exports.resubmitNewDoctor = ({ doctor, evidence, request, flags, audit }) =>
    runInTransaction([
        { sqlQuery: sql.GUARD_NO_PENDING(), inputs: { DoctorId: doctor.DoctorId } },
        { sqlQuery: sql.RESUBMIT_NEW_DOCTOR(), inputs: doctor },
        ...(evidence ? [{ sqlQuery: sql.INSERT_EVIDENCE(), inputs: evidence }] : []),
        { sqlQuery: sql.INSERT_REQUEST(), inputs: request },
        ...flags.map((inputs) => ({ sqlQuery: sql.INSERT_FLAG(), inputs })),
        audit,
    ]);

exports.cancelRequest = (inputs, retireDoctor, audit) =>
    runInTransaction([
        { sqlQuery: sql.CANCEL_REQUEST(), inputs },
        ...(retireDoctor ? [{ sqlQuery: sql.REJECT_NEW_DOCTOR(), inputs: retireDoctor }] : []),
        audit,
    ]);

// Decision + its effects in one transaction. `effects` are extra { sqlQuery, inputs } steps.
exports.decide = (decision, effects) => runInTransaction([{ sqlQuery: sql.DECIDE_REQUEST(), inputs: decision }, ...effects]);

exports.sql = sql;

// Evidence
exports.getEvidence = (EvidenceId) => first(customQuery(sql.GET_EVIDENCE(), { EvidenceId }));
