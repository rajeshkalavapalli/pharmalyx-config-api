const sql = require('./sql');
const { customQuery } = require('../../utils/dbFunctions');
const { generateUUID } = require('../../utils/commonUtils');
const { canViewUser, fail, isGuid, optionalText, requireActingUser, sameId, todayKey } = require('../../utils/access');
const { distanceMeters } = require('../../utils/doctorMatching');
const { getPermissions } = require('../../utils/permissions');
const { teamIdsJson } = require('../../utils/reportScope');
const { auditQuery } = require('../../utils/audit');

// Joint audits (see sql.js). The audited rep never sees their audits; only the auditor, their seniors and head office do.

const RESULTS = {
    PASSED: 'Doctor met at the clinic',
    DOCTOR_NOT_FOUND: 'No such doctor at this clinic',
    CLINIC_NOT_FOUND: 'Clinic not found at this place',
    NOT_RECOGNISED: "Doctor didn't know the rep",
};
const KINDS = ['RANDOM', 'CROSS'];
const PER_DAY = 2; // doctors picked per joint day / cross-audit
const CLINIC_RADIUS_M = 300;

const q = (name, inputs = {}) => customQuery(sql[name](), inputs);
const missing = (error) => /Invalid object name 'dbo\.JointAudits'/i.test(error?.message || '');
const notReady = () => fail(503, 'Joint audits are not set up yet. Run the joint audits SQL in the database first.');
const guard = async (work) => {
    try {
        return await work();
    } catch (error) {
        if (missing(error)) throw notReady();
        throw error;
    }
};

const headOffice = async (userId) => (await getPermissions(userId)).has('verifiedwork.approve');

// Why a doctor is worth checking, highest first; a little randomness so reps can't predict it.
const pick = (rows, count) => {
    const scored = rows.map((d) => {
        const reasons = [];
        let score = Math.random() * 2;
        if (d.VerificationStatus === 'PROVISIONAL') { score += 3; reasons.push('NOT_VERIFIED'); }
        if (Number(d.Visits90) >= 4 && Number(d.RxUnits) === 0) { score += 3; reasons.push('NO_RX'); }
        if (Number(d.ShortVisits) >= 3) { score += 2; reasons.push('SHORT_VISITS'); }
        if (d.CreatedOn && Date.now() - new Date(d.CreatedOn).getTime() < 60 * 86400000) { score += 2; reasons.push('NEW_DOCTOR'); }
        return { d, score, reason: reasons[0] || 'RANDOM' };
    });
    scored.sort((a, b) => b.score - a.score);
    const chosen = scored.slice(0, Math.max(0, count - 1));
    // The last one is purely random from the rest, so even "clean" doctors can be checked.
    const rest = scored.slice(chosen.length);
    if (rest.length && count > 0) {
        const r = rest[Math.floor(Math.random() * rest.length)];
        chosen.push({ ...r, reason: 'RANDOM' });
    }
    return chosen;
};

const assign = async ({ repId, auditorId, auditDate, kind, assignedBy, count = PER_DAY }) => {
    const candidates = await q('CANDIDATES', { RepId: repId, Today: auditDate });
    const chosen = pick(candidates, Math.min(count, candidates.length));
    const now = new Date();
    for (const c of chosen) {
        await q('INSERT_AUDIT', {
            AuditId: generateUUID(),
            UserId: repId,
            AuditorId: auditorId,
            DoctorId: c.d.DoctorId,
            AuditDate: auditDate,
            Kind: kind,
            Reason: c.reason,
            AssignedBy: assignedBy,
            Now: now,
        });
    }
    return chosen.length;
};

const shape = (row) => ({
    auditId: row.AuditId,
    userId: row.UserId,
    repName: row.RepName,
    auditorId: row.AuditorId,
    auditorName: row.AuditorName,
    doctorId: row.DoctorId,
    doctorName: row.DoctorName,
    hospitalName: row.HospitalName,
    areaName: row.AreaName,
    clinicPinned: row.ClinicLatitude != null,
    auditDate: row.AuditDate,
    kind: row.Kind,
    reason: row.Reason,
    status: row.Status,
    checkInAt: row.CheckInAt,
    distanceM: row.DistanceM,
    repMatched: row.RepMatched == null ? null : Boolean(row.RepMatched),
    verifiedBy: row.VerifiedBy,
    notes: row.Notes,
    decidedOn: row.DecidedOn,
});

// The auditor's audits for today. On a confirmed joint day with someone below them, doctors are picked now.
exports.getToday = async (actingUserId) => {
    requireActingUser(actingUserId);
    const today = todayKey();
    return guard(async () => {
        // Joint days (a missing joint-work table just means no joint days).
        const joint = await q('JOINT_TODAY', { ActingUserId: actingUserId, Today: today }).catch((error) => {
            if (/Invalid object name 'dbo\.JointWorkDays'/i.test(error.message)) return [];
            throw error;
        });
        for (const { RepId } of joint) {
            if (!(await canViewUser(actingUserId, RepId)) || sameId(RepId, actingUserId)) continue;
            const existing = await q('EXISTING_FOR_DAY', { RepId, ActingUserId: actingUserId, Today: today });
            if (!existing.length) await assign({ repId: RepId, auditorId: actingUserId, auditDate: today, kind: 'RANDOM', assignedBy: null });
        }
        const rows = await customQuery(`${sql.LIST()} WHERE a.AuditorId = @ActingUserId AND a.AuditDate = @Today ORDER BY a.CreatedOn`, { ActingUserId: actingUserId, Today: today });
        return { date: today, results: RESULTS, audits: rows.map(shape) };
    });
};

// Audits of the people the acting user can see (never their own), for a month.
exports.list = async (actingUserId, query) => {
    requireActingUser(actingUserId);
    const month = /^\d{4}-\d{2}/.test(String(query.month || '')) ? String(query.month).slice(0, 7) : todayKey().slice(0, 7);
    const from = `${month}-01`;
    const to = (() => {
        const d = new Date(`${from}T00:00:00`);
        d.setMonth(d.getMonth() + 1);
        d.setDate(0);
        return todayKey(d);
    })();
    return guard(async () => {
        const TeamIds = await teamIdsJson(actingUserId);
        const rows = await customQuery(
            `${sql.LIST()}
             WHERE a.AuditDate BETWEEN @From AND @To
               AND a.UserId <> @ActingUserId
               AND (a.AuditorId = @ActingUserId OR a.UserId IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@TeamIds)))
             ORDER BY a.AuditDate DESC, a.CreatedOn DESC`,
            { From: from, To: to, ActingUserId: actingUserId, TeamIds }
        );
        const audits = rows.map(shape);
        const done = audits.filter((a) => a.status !== 'ASSIGNED');
        return {
            month,
            headOffice: await headOffice(actingUserId),
            results: RESULTS,
            summary: {
                total: audits.length,
                passed: done.filter((a) => a.status === 'PASSED').length,
                failed: done.filter((a) => a.status !== 'PASSED').length,
                pending: audits.filter((a) => a.status === 'ASSIGNED' && a.auditDate >= todayKey()).length,
                skipped: audits.filter((a) => a.status === 'ASSIGNED' && a.auditDate < todayKey()).length,
            },
            audits,
        };
    });
};

// Head office sends another manager (not the rep's own) to check a rep's doctors on a date.
exports.assignCross = async (actingUserId, payload) => {
    requireActingUser(actingUserId);
    if (!(await headOffice(actingUserId))) throw fail(403, 'Only head office can assign a cross-audit.');
    if (!isGuid(payload.UserId) || !isGuid(payload.AuditorId)) throw fail(400, 'Choose the rep and the auditor.');
    if (sameId(payload.UserId, payload.AuditorId)) throw fail(400, 'A rep cannot audit themselves.');
    const date = String(payload.AuditDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < todayKey()) throw fail(400, 'Choose today or a later date.');

    return guard(async () => {
        const [rep] = await customQuery('SELECT UserId, ManagerId FROM Users WHERE UserId = @UserId AND ISNULL(IsActive, 1) = 1', { UserId: payload.UserId });
        if (!rep) throw fail(404, 'Rep not found.');
        if (sameId(rep.ManagerId, payload.AuditorId)) throw fail(400, "Pick someone other than the rep's own manager - that is the point of a cross-audit.");
        const count = await assign({ repId: payload.UserId, auditorId: payload.AuditorId, auditDate: date, kind: 'CROSS', assignedBy: actingUserId });
        if (!count) throw fail(409, 'No doctors to audit for this rep (none assigned, or all were audited in the last 60 days).');
        return { message: `Cross-audit set for ${date}: ${count} doctor(s). Only the auditor sees which ones, on that day.` };
    });
};

// The auditor at the clinic: live location must be at the doctor's pinned clinic.
exports.checkIn = async (actingUserId, auditId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(auditId)) throw fail(400, 'Audit is invalid.');
    const fix = payload.Location || {};
    if (String(fix.status || '').toUpperCase() !== 'CAPTURED') throw fail(400, 'Turn on location: the audit is checked at the clinic.');
    if (fix.isMock === true) throw fail(400, 'A location-changing app is on. Please turn it off.');
    const lat = Number(fix.latitude);
    const lng = Number(fix.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw fail(400, 'Location is invalid.');

    return guard(async () => {
        const [audit] = await q('GET', { AuditId: auditId });
        if (!audit || !sameId(audit.AuditorId, actingUserId)) throw fail(404, 'Audit not found.');
        if (audit.Status !== 'ASSIGNED') throw fail(409, 'This audit is already done.');
        if (String(audit.AuditDate instanceof Date ? todayKey(audit.AuditDate) : audit.AuditDate).slice(0, 10) !== todayKey()) throw fail(409, 'This audit is for another day.');

        const distance = audit.ClinicLatitude == null ? null : Math.round(distanceMeters(lat, lng, Number(audit.ClinicLatitude), Number(audit.ClinicLongitude)));
        if (distance != null && distance - Math.min(Number(fix.accuracy) || 0, 100) > CLINIC_RADIUS_M) {
            throw fail(400, `You are about ${distance} m from Dr. ${audit.DoctorName}'s clinic. Check in at the clinic (within ${CLINIC_RADIUS_M} m).`);
        }
        const verifiedBy = payload.Biometric === true ? 'BIOMETRIC' : 'GPS';
        await q('CHECK_IN', { AuditId: auditId, ActingUserId: actingUserId, Now: new Date(), Latitude: lat, Longitude: lng, Accuracy: fix.accuracy == null ? null : Math.round(Number(fix.accuracy)), DistanceM: distance, VerifiedBy: verifiedBy });
        return {
            message: distance == null ? "Checked in. This clinic isn't pinned yet, so the place can't be compared." : `Checked in about ${distance} m from the clinic.`,
            distanceM: distance,
        };
    });
};

// The auditor's finding. A failed audit flags the doctor and the rep for head office.
exports.decide = async (actingUserId, auditId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(auditId)) throw fail(400, 'Audit is invalid.');
    const status = String(payload.Result || '').toUpperCase();
    if (!RESULTS[status]) throw fail(400, 'Choose what you found.');
    const notes = optionalText(payload.Notes, 500, 'Notes');
    if (status !== 'PASSED' && (!notes || notes.length < 5)) throw fail(400, 'Write what you saw (at least 5 characters).');

    return guard(async () => {
        const [audit] = await q('GET', { AuditId: auditId });
        if (!audit || !sameId(audit.AuditorId, actingUserId)) throw fail(404, 'Audit not found.');
        if (audit.Status !== 'ASSIGNED') throw fail(409, 'This audit is already done.');
        if (!audit.CheckInAt) throw fail(400, 'Check in at the clinic first.');

        let repMatched = null;
        if (audit.Kind === 'RANDOM') {
            repMatched = (await q('REP_NEAR', { RepId: audit.UserId, DoctorId: audit.DoctorId, At: audit.CheckInAt })).length ? 1 : 0;
        }
        const now = new Date();
        await q('DECIDE', { AuditId: auditId, ActingUserId: actingUserId, Status: status, RepMatched: repMatched, Notes: notes, Now: now });
        const log = auditQuery({ entityType: 'DOCTOR', entityId: audit.DoctorId, action: `AUDIT_${status}`, actorId: actingUserId, reason: notes, after: { auditId, rep: audit.UserId, kind: audit.Kind } });
        await customQuery(log.sqlQuery, log.inputs).catch(() => null);
        return {
            message: status === 'PASSED' ? 'Audit passed.' : 'Audit recorded. Head office will see this doctor and rep flagged.',
            repMatched: repMatched == null ? null : Boolean(repMatched),
        };
    });
};

exports.RESULTS = RESULTS;
exports.KINDS = KINDS;
