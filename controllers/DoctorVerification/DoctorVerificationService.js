const DA = require('./DoctorVerificationDA');
const { claimPhoto } = require('../DoctorRequests/DoctorRequestsService');

const { generateUUID } = require('../../utils/commonUtils');
const { auditQuery } = require('../../utils/audit');
const { getPermissions } = require('../../utils/permissions');
const { resolveScope } = require('../../utils/reportScope');
const { normalizePhone, normalizeRegistration } = require('../../utils/doctorMatching');
const { fail, isGuid, optionalText, requireActingUser, sameId, todayKey } = require('../../utils/access');

// Proof that a doctor is genuine. Any one accepted proof makes the doctor VERIFIED.
//   REGISTRATION_NO  the manager checks the number (e.g. on the council website)
//   PHONE            the manager calls the doctor to confirm
//   DOCUMENT         photo of the prescription pad or visiting card (in-app camera)
//   JOINT_VISIT      the manager confirms; allowed only after they visited the doctor themselves
const METHODS = ['REGISTRATION_NO', 'PHONE', 'DOCUMENT', 'JOINT_VISIT'];
const DOCUMENT_KINDS = ['PRESCRIPTION_PAD', 'VISITING_CARD'];

const JOINT_VISIT_DAYS = 30;
const MAX_EXTENSION_DAYS = 30;
const MIN_REMARKS = 10;

const addDays = (key, days) => {
    const date = new Date(`${key}T00:00:00`);
    date.setDate(date.getDate() + days);
    return todayKey(date);
};

const isAdmin = async (userId) => (await getPermissions(userId)).has('masters.edit');

const loadDoctor = async (doctorId) => {
    if (!isGuid(doctorId)) throw fail(400, 'Doctor is invalid.');
    const doctor = await DA.getDoctor({ DoctorId: doctorId });
    if (!doctor || doctor.IsActive === 'No') throw fail(404, 'Doctor not found.');
    return doctor;
};

const requireProvisional = (doctor) => {
    if (doctor.ApprovalStatus !== 'APPROVED') throw fail(409, 'This doctor is still waiting for approval.');
    if (doctor.VerificationStatus === 'VERIFIED') throw fail(409, 'This doctor is already verified.');
    if (doctor.VerificationStatus !== 'PROVISIONAL') throw fail(409, 'This doctor cannot be verified.');
};

// A registration / phone number may belong to only one doctor.
const refuseClash = async (doctorId, method, value) => {
    const clash = await DA.valueClash({ DoctorId: doctorId, Method: method, Value: value });
    if (clash) {
        throw fail(409, `This ${method === 'PHONE' ? 'phone number' : 'registration number'} already belongs to Dr. ${clash.DoctorName}${clash.AreaName ? ` (${clash.AreaName})` : ''}. It may be a duplicate doctor.`);
    }
};

const daysLeft = (dueOn) => (dueOn ? Math.round((new Date(`${dueOn}T00:00:00`) - new Date(`${todayKey()}T00:00:00`)) / 86400000) : null);

// =========================================================
// READS
// =========================================================

exports.getOverview = async (actingUserId, query) => {
    const scope = await resolveScope(actingUserId, null);
    const admin = await isAdmin(actingUserId);
    const status = ['PENDING', 'ACCEPTED', 'REJECTED'].includes(String(query.status || '').toUpperCase()) ? String(query.status).toUpperCase() : null;

    const [doctors, verifications] = await Promise.all([
        DA.provisionalDoctors({ ...scope, Today: todayKey() }),
        DA.listVerifications({ ...scope, IsAdmin: admin ? 1 : 0, Status: status }),
    ]);

    const rows = doctors.map((row) => ({ ...row, IsMine: Boolean(row.IsMine), overdue: row.DaysLeft != null && row.DaysLeft < 0 }));

    return {
        summary: {
            provisional: rows.length,
            overdue: rows.filter((row) => row.overdue).length,
            dueSoon: rows.filter((row) => !row.overdue && row.DaysLeft != null && row.DaysLeft <= 7).length,
            toReview: verifications.filter((row) => row.Status === 'PENDING' && !sameId(row.SubmittedBy, actingUserId) && (sameId(row.ApproverId, actingUserId) || (!row.ApproverId && admin))).length,
        },
        canExtend: admin,
        doctors: rows,
        verifications: verifications.map((row) => ({
            ...row,
            canReview: row.Status === 'PENDING' && !sameId(row.SubmittedBy, actingUserId) && (sameId(row.ApproverId, actingUserId) || (!row.ApproverId && admin)),
        })),
    };
};

exports.getVerification = async (actingUserId, verificationId) => {
    requireActingUser(actingUserId);
    if (!isGuid(verificationId)) throw fail(400, 'Verification is invalid.');

    const row = await DA.getVerification({ VerificationId: verificationId });
    if (!row) throw fail(404, 'Verification not found.');

    const scope = await resolveScope(actingUserId, null);
    if (!(await DA.canSeeDoctor({ ...scope, DoctorId: row.DoctorId }))) throw fail(403, 'This doctor is outside your team.');

    const admin = await isAdmin(actingUserId);
    let clash = null;
    if (row.Status === 'PENDING' && (row.Method === 'PHONE' || row.Method === 'REGISTRATION_NO')) {
        clash = await DA.valueClash({ DoctorId: row.DoctorId, Method: row.Method, Value: row.Value });
    }

    return {
        verification: row,
        clash,
        daysLeft: daysLeft(row.VerificationDueOn),
        canReview: row.Status === 'PENDING' && !sameId(row.SubmittedBy, actingUserId) && (sameId(row.ApproverId, actingUserId) || (!row.ApproverId && admin)),
    };
};

// =========================================================
// SUBMIT PROOF (MR assigned to / who added the doctor)
// =========================================================

exports.submit = async (actingUserId, doctorId, payload) => {
    requireActingUser(actingUserId);

    const doctor = await loadDoctor(doctorId);
    requireProvisional(doctor);

    const method = String(payload.Method || '').toUpperCase();
    if (!METHODS.includes(method) || method === 'JOINT_VISIT') throw fail(400, 'Choose registration number, phone number or a photo.');

    if (!(await DA.isOwnDoctor({ UserId: actingUserId, DoctorId: doctorId }))) throw fail(403, 'You can only verify doctors assigned to you.');

    const pending = await DA.pendingForDoctor({ DoctorId: doctorId });
    if (pending) throw fail(409, 'A proof for this doctor is already waiting for your manager.');

    const now = new Date();
    const verificationId = generateUUID();
    let value = null;
    let evidence = null;

    if (method === 'REGISTRATION_NO') {
        const council = optionalText(payload.Council, 60, 'Council');
        value = normalizeRegistration(payload.Value);
        if (!value) throw fail(400, 'Enter the registration number (at least 3 letters / digits).');
        await refuseClash(doctorId, method, value);
        value = council ? `${value} (${council})`.slice(0, 100) : value;
    } else if (method === 'PHONE') {
        value = normalizePhone(payload.Value);
        if (!value) throw fail(400, 'Enter a phone number with at least 10 digits.');
        await refuseClash(doctorId, method, value);
    } else {
        const kind = String(payload.Kind || '').toUpperCase();
        if (!DOCUMENT_KINDS.includes(kind)) throw fail(400, 'Choose prescription pad or visiting card.');
        evidence = await claimPhoto(actingUserId, payload.PhotoId, doctorId, kind, null, now);
        value = kind === 'PRESCRIPTION_PAD' ? 'Prescription pad' : 'Visiting card';
    }

    await DA.submit({
        evidence,
        verification: {
            VerificationId: verificationId,
            DoctorId: doctorId,
            Method: method,
            Value: value,
            EvidenceId: evidence?.EvidenceId || null,
            VisitId: null,
            SubmittedBy: actingUserId,
            Now: now,
            Status: 'PENDING',
            ReviewedBy: null,
            ReviewedOn: null,
            ReviewRemarks: null,
        },
        audit: auditQuery({ entityType: 'DOCTOR', entityId: doctorId, action: 'VERIFY_SUBMIT', actorId: actingUserId, after: { method, value } }),
    });

    return { message: `Proof for Dr. ${doctor.DoctorName} sent to your manager.`, VerificationId: verificationId };
};

// =========================================================
// JOINT VISIT (manager confirms directly)
// =========================================================

exports.confirmJointVisit = async (actingUserId, doctorId, payload) => {
    requireActingUser(actingUserId);

    const doctor = await loadDoctor(doctorId);
    requireProvisional(doctor);

    const scope = await resolveScope(actingUserId, null);
    if (!(await DA.canSeeDoctor({ ...scope, DoctorId: doctorId }))) throw fail(403, 'This doctor is outside your team.');
    if (await DA.isOwnDoctor({ UserId: actingUserId, DoctorId: doctorId })) throw fail(403, 'You cannot verify your own doctor; your manager has to.');

    // Fair and checkable: the manager must really have met the doctor recently.
    const visit = await DA.managerVisit({ DoctorId: doctorId, ManagerId: actingUserId, Since: addDays(todayKey(), -JOINT_VISIT_DAYS) });
    if (!visit) {
        throw fail(409, `No visit by you (or with you as joint work) to this doctor in the last ${JOINT_VISIT_DAYS} days. Log the joint visit first.`);
    }

    const remarks = optionalText(payload.Remarks, 500, 'Remarks');
    const now = new Date();

    await DA.submit({
        verification: {
            VerificationId: generateUUID(),
            DoctorId: doctorId,
            Method: 'JOINT_VISIT',
            Value: `Visit on ${visit.VisitDate} by ${visit.VisitedBy}`,
            EvidenceId: null,
            VisitId: visit.VisitId,
            SubmittedBy: actingUserId,
            Now: now,
            Status: 'ACCEPTED',
            ReviewedBy: actingUserId,
            ReviewedOn: now,
            ReviewRemarks: remarks,
        },
        verified: { DoctorId: doctorId, ActorId: actingUserId, Method: 'JOINT_VISIT', Value: null, Now: now },
        audit: auditQuery({ entityType: 'DOCTOR', entityId: doctorId, action: 'VERIFY_JOINT_VISIT', actorId: actingUserId, reason: remarks, after: { visitId: visit.VisitId, visitDate: visit.VisitDate } }),
    });

    return { message: `Dr. ${doctor.DoctorName} verified by your joint visit on ${visit.VisitDate}.` };
};

// =========================================================
// ACCEPT / REJECT (the submitter's primary manager)
// =========================================================

exports.decide = async (actingUserId, verificationId, accept, payload) => {
    const detail = await exports.getVerification(actingUserId, verificationId);
    if (!detail.canReview) throw fail(403, "Only the submitter's reporting manager can accept or reject this proof.");

    const row = detail.verification;
    const remarks = optionalText(payload.Remarks, 500, 'Remarks');
    if (!accept && (!remarks || remarks.length < MIN_REMARKS)) throw fail(400, `Give a reason to reject (at least ${MIN_REMARKS} characters).`);

    if (accept) {
        if (row.VerificationStatus !== 'PROVISIONAL') throw fail(409, 'This doctor is no longer provisional.');
        if (detail.clash) throw fail(409, `This number already belongs to Dr. ${detail.clash.DoctorName}. Check for a duplicate doctor before accepting.`);
    }

    const now = new Date();
    // Store just the number on the doctor (without the council in brackets).
    const value = row.Method === 'REGISTRATION_NO' ? normalizeRegistration(String(row.Value || '').split(' (')[0]) : row.Method === 'PHONE' ? row.Value : null;

    try {
        await DA.decide({
            decision: { VerificationId: verificationId, Status: accept ? 'ACCEPTED' : 'REJECTED', ActorId: actingUserId, Remarks: remarks, Now: now },
            verified: accept ? { DoctorId: row.DoctorId, ActorId: actingUserId, Method: row.Method, Value: value, Now: now } : null,
            audit: auditQuery({ entityType: 'DOCTOR', entityId: row.DoctorId, action: accept ? 'VERIFY_ACCEPT' : 'VERIFY_REJECT', actorId: actingUserId, reason: remarks, after: { method: row.Method, value: row.Value, verificationId } }),
        });
    } catch (error) {
        if (error.number === 50409 || /already decided/i.test(error.message)) throw fail(409, 'This proof was already decided. Refresh to see the result.');
        throw error;
    }

    return { message: accept ? `Dr. ${row.DoctorName} is now verified.` : `Proof for Dr. ${row.DoctorName} rejected.` };
};

// =========================================================
// EXTEND DEADLINE (admin, with a reason)
// =========================================================

exports.extendDeadline = async (actingUserId, doctorId, payload) => {
    requireActingUser(actingUserId);

    const doctor = await loadDoctor(doctorId);
    requireProvisional(doctor);

    const days = Number(payload.Days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_EXTENSION_DAYS) throw fail(400, `Extend by 1 to ${MAX_EXTENSION_DAYS} days.`);

    const reason = optionalText(payload.Reason, 500, 'Reason');
    if (!reason || reason.length < MIN_REMARKS) throw fail(400, `Give a reason (at least ${MIN_REMARKS} characters).`);

    // Count from today if already overdue, otherwise from the current deadline.
    const base = doctor.VerificationDueOn && doctor.VerificationDueOn > todayKey() ? doctor.VerificationDueOn : todayKey();
    const dueOn = addDays(base, days);

    const changed = await DA.extend(
        { DoctorId: doctorId, DueOn: dueOn, Now: new Date() },
        auditQuery({ entityType: 'DOCTOR', entityId: doctorId, action: 'VERIFY_EXTEND', actorId: actingUserId, reason, before: { dueOn: doctor.VerificationDueOn }, after: { dueOn } })
    );
    if (!changed) throw fail(409, 'This doctor is no longer provisional.');

    return { message: `Deadline for Dr. ${doctor.DoctorName} moved to ${dueOn}.` };
};
