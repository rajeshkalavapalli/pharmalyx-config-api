const sql = require('./sql');
const { customQuery, runInTransaction } = require('../../utils/dbFunctions');

const first = async (promise) => (await promise)[0] || null;
const q = (name) => (inputs = {}) => customQuery(sql[name](), inputs);
const one = (name) => (inputs = {}) => first(customQuery(sql[name](), inputs));

exports.sql = sql;

// Settings
exports.getSettings = q('GET_SETTINGS');
exports.updateSettings = (rows, audit) => runInTransaction([...rows.map((inputs) => ({ sqlQuery: sql.UPDATE_SETTING(), inputs })), audit]);

// People
exports.getUser = (UserId) => first(customQuery(sql.GET_USER(), { UserId }));
exports.scopeUsers = q('SCOPE_USERS');

// Territory
exports.myAreas = (UserId) => customQuery(sql.MY_AREAS(), { UserId });
exports.territoryAreas = (UserId) => customQuery(sql.TERRITORY_AREAS(), { UserId });
exports.teamBoundaries = (ActingUserId) => customQuery(sql.TEAM_BOUNDARIES(), { ActingUserId, ViewAll: 0 });
exports.activeExceptions = (UserId, Date) => customQuery(sql.ACTIVE_EXCEPTIONS(), { UserId, Date });
exports.boundaryList = q('BOUNDARY_LIST');
exports.clinicsOfUser = (UserId) => customQuery(sql.CLINICS_OF_USER(), { UserId });
exports.insertBoundary = (inputs, audit) => runInTransaction([{ sqlQuery: sql.INSERT_BOUNDARY(), inputs }, audit]);
exports.getBoundary = (BoundaryId) => first(customQuery(sql.GET_BOUNDARY(), { BoundaryId }));
exports.approveBoundary = (inputs, audit) => runInTransaction([{ sqlQuery: sql.APPROVE_BOUNDARY(), inputs }, audit]);
exports.listExceptions = q('LIST_EXCEPTIONS');
exports.insertException = (inputs, audit) => runInTransaction([{ sqlQuery: sql.INSERT_EXCEPTION(), inputs }, audit]);
exports.getException = (ExceptionId) => first(customQuery(sql.GET_EXCEPTION(), { ExceptionId }));
exports.revokeException = (inputs, audit) => runInTransaction([{ sqlQuery: sql.REVOKE_EXCEPTION(), inputs }, audit]);

// Hospitals
exports.listHospitals = q('LIST_HOSPITALS');
exports.insertHospital = (inputs, audit) => runInTransaction([{ sqlQuery: sql.INSERT_HOSPITAL(), inputs }, audit]);
exports.updateHospital = (inputs, audit) => runInTransaction([{ sqlQuery: sql.UPDATE_HOSPITAL(), inputs }, audit]);
exports.hospitalDoctors = q('HOSPITAL_DOCTORS');
exports.setDoctorHospitals = (rows, audit) => runInTransaction([...rows.map((inputs) => ({ sqlQuery: sql.SET_DOCTOR_HOSPITAL(), inputs })), audit]);
exports.doctorHospital = (DoctorId) => first(customQuery(sql.DOCTOR_HOSPITAL(), { DoctorId }));

// Day start, consent, pings
exports.getWorkDay = (UserId, WorkDate) => first(customQuery(sql.GET_WORKDAY(), { UserId, WorkDate }));
exports.startWorkDay = async (inputs, flag) => {
    const results = await runInTransaction([{ sqlQuery: sql.START_WORKDAY(), inputs }]);
    const inserted = Number(results[0]?.recordset?.[0]?.Inserted || 0) > 0;
    if (inserted && flag) await customQuery(sql.INSERT_FLAG(), flag);
    return inserted;
};
exports.plannedDay = (UserId, Date) => first(customQuery(sql.PLANNED_DAY(), { UserId, Date }));
exports.monthPlan = (UserId, Month) => customQuery(sql.MONTH_PLAN(), { UserId, Month });
exports.onLeave = async (UserId, Date) => Boolean(await first(customQuery(sql.ON_LEAVE(), { UserId, Date })));
exports.leaveDates = (UserId, Month, MonthEnd) => customQuery(sql.LEAVE_DATES(), { UserId, Month, MonthEnd });
exports.getConsent = (UserId, ConsentVersion) => first(customQuery(sql.GET_CONSENT(), { UserId, ConsentVersion }));
exports.insertConsent = one('INSERT_CONSENT');
exports.lastPing = (UserId) => first(customQuery(sql.LAST_PING(), { UserId }));
exports.insertPings = (rows) => runInTransaction(rows.map((inputs) => ({ sqlQuery: sql.INSERT_PING(), inputs })));
exports.dayPoints = (UserId, From, To) => customQuery(sql.DAY_POINTS(), { UserId, From, To });

// Check-in
exports.insertCheckIn = (inputs) => runInTransaction([{ sqlQuery: sql.INSERT_CHECKIN(), inputs }]);
exports.getCheckIn = (CheckInId) => first(customQuery(sql.GET_CHECKIN(), { CheckInId }));
exports.useCheckInQuery = (inputs) => ({ sqlQuery: sql.USE_CHECKIN(), inputs });
exports.dayVisitTimes = (UserId, Date) => customQuery(sql.DAY_VISIT_TIMES(), { UserId, Date });
exports.flagQuery = (inputs) => ({ sqlQuery: sql.INSERT_FLAG(), inputs });

// Plan, timing, coverage
exports.myDoctors = (UserId) => customQuery(sql.MY_DOCTORS(), { UserId });
exports.visitCounts = (UserId, From, To) => customQuery(sql.VISIT_COUNTS(), { UserId, From, To });
exports.validTimes = (UserId, Since) => customQuery(sql.VALID_TIMES(), { UserId, Since });
exports.dayVisits = (UserId, Date) => customQuery(sql.DAY_VISITS(), { UserId, Date });

// Review
exports.listVisits = q('LIST_VISITS');
exports.getVisit = (VisitId) => first(customQuery(sql.GET_VISIT(), { VisitId }));
exports.overrideVisit = (inputs, audit) => runInTransaction([{ sqlQuery: sql.OVERRIDE_VISIT(), inputs }, audit]);
exports.listFlags = q('LIST_FLAGS');
exports.actOnFlag = (inputs, audit) => runInTransaction([{ sqlQuery: sql.ACT_ON_FLAG(), inputs }, audit]);
exports.sharedDoctors = q('SHARED_DOCTORS');
