// Doctor-related spend. Only activity types head office allows can be requested. The MR states the
// business they expect from the territory; the reporting manager recommends or not; only head office
// approves (with a compliance confirmation) and records the payment with a supporting document.
// After the period, the claim is compared with actual territory net sales. We track the employees'
// claims and recommendations, never the doctor. Spend outside this flow is not reimbursed.

const sql = require('./sql');
const rules = require('./rules');
const { loadSettings } = require('../FieldLedger/settings');
const { access, requireHeadOffice } = require('../FieldLedger/scope');

const fileStore = require('../../utils/fileStore');
const { customQuery, runInTransaction } = require('../../utils/dbFunctions');
const { generateUUID } = require('../../utils/commonUtils');
const { auditQuery } = require('../../utils/audit');
const { fail, isGuid, optionalText, requireActingUser, sameId, toDateKey } = require('../../utils/access');

const q = (name, inputs = {}) => customQuery(sql[name](), inputs);
const run = async (steps) => {
    try {
        return await runInTransaction(steps);
    } catch (error) {
        if (error.number === 50409) throw fail(409, error.message);
        throw error;
    }
};
const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const lower = (value) => String(value || '').toLowerCase();
const rupees = (value) => `Rs ${Number(value || 0).toLocaleString('en-IN')}`;
const round2 = (value) => Math.round(Number(value) * 100) / 100;

const UCPMP_NOTE =
    'Confirm every allowed activity type with the company’s legal advisor under the Uniform Code for Pharmaceutical Marketing Practices (UCPMP) 2024 before switching it on. Only documented, permitted activities should be listed here.';

const MAX_DOC_BYTES = 10 * 1024 * 1024;
const DOC_ID = /^[0-9a-f-]{36}\.(pdf|jpg|png|webp)$/i;
const docKey = (userId, docId) => `spend/${lower(userId)}/${lower(docId)}`;
const sniffDocument = (buffer) => {
    if (buffer && buffer.length > 4 && buffer.slice(0, 4).toString('ascii') === '%PDF') return { contentType: 'application/pdf', ext: 'pdf' };
    return fileStore.sniffImage(buffer);
};

const note = (value, label, min = 10) => {
    const text = optionalText(value, 500, label);
    if (!text || text.length < min) throw fail(400, `${label} is required (at least ${min} characters).`);
    return text;
};

// =========================================================
// Outcomes and scores
// =========================================================

const loadOutcomes = async (requests, settings, today) => {
    const paid = requests.filter((r) => r.Status === 'DISBURSED' && r.DisbursedDate);
    const result = new Map();
    if (!paid.length) return result;

    const windows = paid.map((r) => ({ r, ...rules.outcomeWindow(r.DisbursedDate, Number(r.PeriodMonths)) }));
    const from = windows.map((w) => w.from).sort()[0];
    const lastEnd = windows.map((w) => w.to).sort().pop();
    const to = lastEnd < today ? lastEnd : today;
    const territories = [...new Set(paid.map((r) => lower(r.TerritoryId)))];
    const areas = [...new Set(paid.map((r) => lower(r.AreaId)).filter(Boolean))];

    const net = await q('NET_DAILY', { From: from, To: to, Territories: JSON.stringify(territories) });
    let nearby = [];
    if (areas.length) {
        try {
            nearby = await q('AREA_CHEMISTS_DAILY', { From: from, To: to, Areas: JSON.stringify(areas) });
        } catch (error) {
            if (error.number !== 208) throw error;
            nearby = await q('AREA_CHEMISTS_DAILY_POB_ONLY', { From: from, To: to, Areas: JSON.stringify(areas) });
        }
    }

    windows.forEach(({ r, from: wFrom, to: wTo }) => {
        const upTo = wTo < today ? wTo : today;
        const actual = round2(rules.sumWindow(net.filter((row) => sameId(row.TerritoryId, r.TerritoryId)), wFrom, upTo));
        const chemists = r.AreaId ? round2(rules.sumWindow(nearby.filter((row) => sameId(row.AreaId, r.AreaId)), wFrom, upTo)) : null;
        const outcome = rules.evaluateOutcome({ expected: Number(r.ExpectedBusiness), actual, from: wFrom, to: wTo, today, onTrackPct: settings.SPEND_ON_TRACK_PCT, partlyPct: settings.SPEND_PARTLY_PCT });
        result.set(lower(r.RequestId), { ...outcome, from: wFrom, to: wTo, actual, nearbyChemists: chemists });
    });
    return result;
};

const scoresBy = (requests, outcomes, field, filter = () => true) => {
    const groups = new Map();
    requests.filter((r) => r[field] && filter(r)).forEach((r) => {
        const key = lower(r[field]);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(outcomes.get(lower(r.RequestId)));
    });
    return new Map([...groups.entries()].map(([key, list]) => [key, rules.recommendationScore(list)]));
};

// Everything the screens need about the requests the viewer may see.
const loadView = async (scope) => {
    const settings = await loadSettings();
    const today = todayIst();
    const all = await q('REQUESTS');
    const outcomes = await loadOutcomes(all, settings, today);
    const mrScores = scoresBy(all, outcomes, 'UserId');
    const managerScores = scoresBy(all, outcomes, 'ManagerId', (r) => r.ManagerRecommendation === 'RECOMMEND');

    const failedByDoctor = new Map();
    all.forEach((r) => {
        const o = outcomes.get(lower(r.RequestId));
        if (o?.final && o.status === 'CLAIM_FAILED') {
            const key = lower(r.DoctorId);
            if (!failedByDoctor.has(key)) failedByDoctor.set(key, []);
            failedByDoctor.get(key).push(r.RequestNumber);
        }
    });

    const visible = all.filter((r) => scope.viewAll || scope.canSee(r.UserId));
    const rows = visible.map((r) => {
        const isManager = sameId(r.ManagerId, scope.actingUserId);
        const priorFailed = (failedByDoctor.get(lower(r.DoctorId)) || []).filter((n) => n !== r.RequestNumber);
        return {
            ...r,
            Amount: Number(r.Amount),
            ExpectedBusiness: Number(r.ExpectedBusiness),
            DisbursedAmount: r.DisbursedAmount == null ? null : Number(r.DisbursedAmount),
            outcome: outcomes.get(lower(r.RequestId)) || null,
            requesterScore: mrScores.get(lower(r.UserId)) || rules.recommendationScore([]),
            managerScore: r.ManagerId ? managerScores.get(lower(r.ManagerId)) || rules.recommendationScore([]) : null,
            priorFailed,
            can: {
                recommend: isManager && scope.permissions.has('spend.edit') && rules.canRecommend(r.Status),
                decide: scope.headOffice && !sameId(r.UserId, scope.actingUserId) && rules.canDecide(r.Status, Boolean(r.ManagerId)),
                disburse: scope.headOffice && rules.canDisburse(r.Status),
            },
        };
    });
    return { settings, rows, all, outcomes, mrScores, managerScores };
};

// =========================================================
// Setup and lists
// =========================================================

exports.getConfig = async (actingUserId) => {
    const scope = await access(actingUserId, 'spend.approve');
    const settings = await loadSettings();
    const types = await q('TYPES');
    const doctors = scope.permissions.has('spend.create') ? await q('MY_DOCTORS', { UserId: actingUserId }) : [];
    return {
        headOffice: scope.headOffice,
        canRequest: scope.permissions.has('spend.create'),
        canRecommend: scope.permissions.has('spend.edit'),
        ucpmpNote: UCPMP_NOTE,
        periods: rules.PERIODS,
        methods: rules.METHODS,
        onTrackPct: settings.SPEND_ON_TRACK_PCT,
        partlyPct: settings.SPEND_PARTLY_PCT,
        types: scope.headOffice ? types : types.filter((t) => t.IsActive),
        doctors,
    };
};

exports.saveType = async (actingUserId, typeId, payload) => {
    const scope = await access(actingUserId, 'spend.approve');
    requireHeadOffice(scope);
    const name = optionalText(payload.TypeName, 100, 'Activity name');
    if (!name || name.length < 3) throw fail(400, 'Name the activity, e.g. "Documented CME sponsorship".');
    const max = Number(payload.MaxAmount);
    if (!Number.isFinite(max) || max <= 0 || max > 100000000) throw fail(400, 'Set the most that can be requested for this activity.');
    if (payload.LegalConfirmed !== true) throw fail(400, 'Tick the box to confirm this activity was checked with the legal advisor under UCPMP 2024.');
    const row = {
        TypeId: typeId || generateUUID(),
        TypeName: name,
        Description: optionalText(payload.Description, 500, 'Description'),
        MaxAmount: round2(max),
        IsActive: payload.IsActive === false ? 0 : 1,
        ActorId: actingUserId,
        Now: new Date(),
    };
    let before = null;
    if (typeId) {
        if (!isGuid(typeId)) throw fail(400, 'Activity type is invalid.');
        before = (await q('GET_TYPE', { TypeId: typeId }))[0];
        if (!before) throw fail(404, 'Activity type not found.');
    }
    await run([
        { sqlQuery: typeId ? sql.UPDATE_TYPE() : sql.INSERT_TYPE(), inputs: row },
        auditQuery({ entityType: 'SPEND_TYPE', entityId: row.TypeId, action: typeId ? 'UPDATE' : 'CREATE', actorId: actingUserId, reason: 'Confirmed with legal advisor (UCPMP 2024)', before, after: row }),
    ]);
    return { message: `Activity type "${name}" saved.`, TypeId: row.TypeId };
};

exports.listRequests = async (actingUserId, query) => {
    const scope = await access(actingUserId, 'spend.approve');
    const { rows, settings } = await loadView(scope);
    const filter = String(query.filter || 'all');
    const list = rows.filter((r) => {
        if (filter === 'action') return r.can.recommend || r.can.decide || r.can.disburse;
        if (filter === 'mine') return sameId(r.UserId, actingUserId);
        if (filter === 'open') return !['REJECTED', 'DISBURSED'].includes(r.Status);
        if (filter === 'paid') return r.Status === 'DISBURSED';
        return true;
    });
    return { onTrackPct: settings.SPEND_ON_TRACK_PCT, partlyPct: settings.SPEND_PARTLY_PCT, headOffice: scope.headOffice, requests: list };
};

// =========================================================
// MR: raise a request
// =========================================================

exports.createRequest = async (actingUserId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(payload.DoctorId)) throw fail(400, 'Choose the doctor.');
    if (!isGuid(payload.TypeId)) throw fail(400, 'Choose the activity type.');
    const doctor = (await q('MY_DOCTORS', { UserId: actingUserId })).find((d) => sameId(d.DoctorId, payload.DoctorId));
    if (!doctor) throw fail(400, 'This doctor is not assigned to you.');
    const type = (await q('GET_TYPE', { TypeId: payload.TypeId }))[0];
    if (!type || !type.IsActive) throw fail(400, 'Only activity types allowed by head office can be requested.');
    const me = (await q('USER', { UserId: actingUserId }))[0];
    const territoryId = doctor.TerritoryId || me?.TerritoryId;
    if (!territoryId) throw fail(400, "The doctor has no territory, so the expected business can't be tracked. Ask head office to set it.");

    const amount = round2(payload.Amount);
    const expected = round2(payload.ExpectedBusiness);
    const periodMonths = Number(payload.PeriodMonths);
    const purpose = optionalText(payload.Purpose, 500, 'Purpose');
    const errors = rules.validateRequest({ amount, maxAmount: Number(type.MaxAmount), expected, periodMonths, purpose });
    if (errors.length) throw fail(400, errors[0]);

    // Earlier claims for this doctor that failed: the request still goes in, flagged for head office.
    const scope = await access(actingUserId, 'spend.approve');
    const { all, outcomes } = await loadView({ ...scope, viewAll: true });
    const failed = all.filter((r) => sameId(r.DoctorId, doctor.DoctorId) && outcomes.get(lower(r.RequestId))?.final && outcomes.get(lower(r.RequestId)).status === 'CLAIM_FAILED');

    const requestId = generateUUID();
    const now = new Date();
    const steps = [
        {
            sqlQuery: sql.INSERT_REQUEST(),
            inputs: {
                RequestId: requestId,
                UserId: actingUserId,
                ManagerId: me?.ManagerId || null,
                DoctorId: doctor.DoctorId,
                TerritoryId: territoryId,
                AreaId: doctor.AreaId || null,
                TypeId: type.TypeId,
                Amount: amount,
                Purpose: purpose,
                ExpectedBusiness: expected,
                PeriodMonths: periodMonths,
                PriorFailedClaims: failed.length,
                Now: now,
            },
        },
        auditQuery({ entityType: 'SPEND_REQUEST', entityId: requestId, action: 'CREATE', actorId: actingUserId, after: { doctorId: doctor.DoctorId, typeId: type.TypeId, amount, expected, periodMonths, priorFailed: failed.length } }),
    ];
    if (failed.length) {
        steps.push({
            sqlQuery: sql.INSERT_FLAG(),
            inputs: {
                FlagId: generateUUID(),
                FlagType: 'SPEND_PRIOR_FAILED',
                Severity: failed.length > 1 ? 'HIGH' : 'MEDIUM',
                UserId: actingUserId,
                DoctorId: doctor.DoctorId,
                Details: `New spend request of ${rupees(amount)} for Dr. ${doctor.DoctorName}; earlier claim(s) ${failed.map((r) => r.RequestNumber).join(', ')} for this doctor failed.`.slice(0, 500),
                Data: JSON.stringify({ requestId, failed: failed.map((r) => r.RequestId) }),
                SubjectKey: `SPENDFAIL|${requestId}`,
                Now: now,
            },
        });
    }
    const results = await run(steps);
    const number = results[0]?.recordset?.[0]?.RequestNumber || '';
    return {
        message: `Request ${number} sent${me?.ManagerId ? ' to your manager for a recommendation' : ' to head office'}.${failed.length ? ' Note: an earlier claim for this doctor failed, so head office will see a flag.' : ''}`,
        RequestId: requestId,
    };
};

// =========================================================
// Manager: recommend (never approve)
// =========================================================

exports.recommend = async (actingUserId, requestId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(requestId)) throw fail(400, 'Request is invalid.');
    const request = (await q('GET_REQUEST', { RequestId: requestId }))[0];
    if (!request) throw fail(404, 'Request not found.');
    if (!sameId(request.ManagerId, actingUserId) && !sameId(request.CurrentManagerId, actingUserId)) throw fail(403, "Only the MR's reporting manager can recommend this request.");
    if (!rules.canRecommend(request.Status)) throw fail(409, 'This request is no longer waiting for a recommendation.');
    const recommendation = String(payload.Recommendation || '').toUpperCase();
    if (!['RECOMMEND', 'DO_NOT_RECOMMEND'].includes(recommendation)) throw fail(400, 'Choose recommend or do not recommend.');
    const text = note(payload.Note, 'Note');
    await run([
        { sqlQuery: sql.RECOMMEND(), inputs: { RequestId: requestId, Recommendation: recommendation, Note: text, ActorId: actingUserId, Now: new Date() } },
        auditQuery({ entityType: 'SPEND_REQUEST', entityId: requestId, action: recommendation, actorId: actingUserId, reason: text }),
    ]);
    return { message: `Your ${recommendation === 'RECOMMEND' ? 'recommendation' : '"do not recommend"'} was sent to head office.` };
};

// =========================================================
// Head office: approve / reject, then record the payment
// =========================================================

exports.decide = async (actingUserId, requestId, payload) => {
    const scope = await access(actingUserId, 'spend.approve');
    requireHeadOffice(scope);
    if (!isGuid(requestId)) throw fail(400, 'Request is invalid.');
    const request = (await q('GET_REQUEST', { RequestId: requestId }))[0];
    if (!request) throw fail(404, 'Request not found.');
    if (sameId(request.UserId, actingUserId)) throw fail(403, 'You cannot decide your own request.');
    if (!rules.canDecide(request.Status, Boolean(request.ManagerId))) {
        throw fail(409, request.Status === 'REQUESTED' ? "Wait for the manager's recommendation first." : 'This request has already been decided.');
    }
    const decision = String(payload.Decision || '').toUpperCase();
    if (!['APPROVED', 'REJECTED'].includes(decision)) throw fail(400, 'Choose approve or reject.');
    if (decision === 'APPROVED' && payload.ComplianceConfirmed !== true) throw fail(400, 'Tick the compliance check: the activity is allowed under company policy and UCPMP 2024, and is documented.');
    const text = note(payload.Note, decision === 'APPROVED' ? 'Compliance note' : 'Reason for rejecting');
    await run([
        { sqlQuery: sql.DECIDE(), inputs: { RequestId: requestId, Decision: decision, Note: text, Compliance: decision === 'APPROVED' ? 1 : payload.ComplianceConfirmed === true ? 1 : 0, ActorId: actingUserId, Now: new Date(), FromStatus: request.Status } },
        auditQuery({ entityType: 'SPEND_REQUEST', entityId: requestId, action: decision, actorId: actingUserId, reason: text, before: { status: request.Status }, after: { status: decision, compliance: payload.ComplianceConfirmed === true } }),
    ]);
    return { message: decision === 'APPROVED' ? 'Approved. Record the payment when it is made.' : 'Rejected.' };
};

exports.uploadDocument = async (actingUserId, buffer) => {
    const scope = await access(actingUserId, 'spend.approve');
    requireHeadOffice(scope);
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw fail(400, 'No file received.');
    if (buffer.length > MAX_DOC_BYTES) throw fail(413, 'File is larger than 10 MB.');
    const type = sniffDocument(buffer);
    if (!type) throw fail(400, 'Only PDF, JPEG, PNG or WebP files are accepted.');
    const docId = `${generateUUID()}.${type.ext}`;
    await fileStore.put(docKey(actingUserId, docId), buffer);
    return { docId };
};

exports.disburse = async (actingUserId, requestId, payload) => {
    const scope = await access(actingUserId, 'spend.approve');
    requireHeadOffice(scope);
    if (!isGuid(requestId)) throw fail(400, 'Request is invalid.');
    const request = (await q('GET_REQUEST', { RequestId: requestId }))[0];
    if (!request) throw fail(404, 'Request not found.');
    if (!rules.canDisburse(request.Status)) throw fail(409, 'Only an approved request can be paid, and only once.');

    const amount = round2(payload.Amount);
    if (!(amount > 0)) throw fail(400, 'Enter the amount actually paid.');
    if (amount > Number(request.Amount)) throw fail(400, `The payment cannot be more than the approved ${rupees(request.Amount)}.`);
    const date = toDateKey(payload.DisbursedDate || todayIst(), 'Payment date');
    if (date > todayIst()) throw fail(400, 'Payment date cannot be in the future.');
    const method = String(payload.Method || '').toUpperCase();
    if (!rules.METHODS.includes(method)) throw fail(400, 'Choose how it was paid.');
    const reference = optionalText(payload.Reference, 100, 'Reference');
    if (!DOC_ID.test(String(payload.DocumentId || ''))) throw fail(400, 'Upload the supporting document (invoice, agreement or receipt).');
    const key = docKey(actingUserId, payload.DocumentId);
    const buffer = await fileStore.get(key).catch(() => null);
    if (!buffer) throw fail(400, 'The document was not found. Upload it again.');
    const type = sniffDocument(buffer);

    await run([
        { sqlQuery: sql.DISBURSE(), inputs: { RequestId: requestId, Amount: amount, DisbursedDate: date, Method: method, Reference: reference, DocKey: key, DocType: type?.contentType || 'application/octet-stream', ActorId: actingUserId, Now: new Date() } },
        auditQuery({ entityType: 'SPEND_REQUEST', entityId: requestId, action: 'DISBURSED', actorId: actingUserId, after: { amount, date, method, reference } }),
    ]);
    return { message: `Payment of ${rupees(amount)} recorded. The outcome is tracked for ${request.PeriodMonths} months from ${date}.` };
};

exports.getDocument = async (actingUserId, requestId) => {
    const scope = await access(actingUserId, 'spend.approve');
    if (!isGuid(requestId)) throw fail(400, 'Request is invalid.');
    const request = (await q('GET_REQUEST', { RequestId: requestId }))[0];
    if (!request || !request.DocStorageKey) throw fail(404, 'No document for this request.');
    if (!scope.viewAll && !scope.canSee(request.UserId)) throw fail(403, 'You cannot see this document.');
    return { buffer: await fileStore.get(request.DocStorageKey), contentType: request.DocContentType || 'application/octet-stream' };
};

// =========================================================
// Reports: spend per doctor, territory, MR, manager; spend vs outcome
// =========================================================

exports.getReports = async (actingUserId) => {
    const scope = await access(actingUserId, 'spend.approve');
    const { rows, settings } = await loadView(scope);
    const paid = rows.filter((r) => r.Status === 'DISBURSED');

    const group = (keyOf, nameOf) => {
        const map = new Map();
        paid.forEach((r) => {
            const key = lower(keyOf(r));
            if (!key) return;
            if (!map.has(key)) map.set(key, { id: key, name: nameOf(r), requests: 0, paid: 0, expected: 0, actual: 0, onTrack: 0, partly: 0, failed: 0, inProgress: 0 });
            const g = map.get(key);
            g.requests++;
            g.paid += Number(r.DisbursedAmount) || 0;
            g.expected += Number(r.ExpectedBusiness) || 0;
            g.actual += Number(r.outcome?.actual) || 0;
            if (!r.outcome?.final) g.inProgress++;
            else if (r.outcome.status === 'ON_TRACK') g.onTrack++;
            else if (r.outcome.status === 'PARTLY_MET') g.partly++;
            else g.failed++;
        });
        return [...map.values()].map((g) => ({ ...g, paid: round2(g.paid), expected: round2(g.expected), actual: round2(g.actual) })).sort((a, b) => b.paid - a.paid);
    };

    const finals = paid.filter((r) => r.outcome?.final);
    return {
        onTrackPct: settings.SPEND_ON_TRACK_PCT,
        partlyPct: settings.SPEND_PARTLY_PCT,
        summary: {
            requests: rows.length,
            waiting: rows.filter((r) => ['REQUESTED', 'RECOMMENDED', 'NOT_RECOMMENDED', 'APPROVED'].includes(r.Status)).length,
            rejected: rows.filter((r) => r.Status === 'REJECTED').length,
            paidCount: paid.length,
            paid: round2(paid.reduce((s, r) => s + (Number(r.DisbursedAmount) || 0), 0)),
            finals: finals.length,
            onTrack: finals.filter((r) => r.outcome.status === 'ON_TRACK').length,
            partly: finals.filter((r) => r.outcome.status === 'PARTLY_MET').length,
            failed: finals.filter((r) => r.outcome.status === 'CLAIM_FAILED').length,
            inProgress: paid.length - finals.length,
            expected: round2(finals.reduce((s, r) => s + r.ExpectedBusiness, 0)),
            actual: round2(finals.reduce((s, r) => s + (Number(r.outcome.actual) || 0), 0)),
        },
        byDoctor: group((r) => r.DoctorId, (r) => r.DoctorName),
        byTerritory: group((r) => r.TerritoryId, (r) => r.TerritoryName),
        byMr: group((r) => r.UserId, (r) => r.UserName).map((g) => ({ ...g, score: rows.find((r) => lower(r.UserId) === g.id)?.requesterScore || null })),
        byManager: group((r) => r.ManagerId, (r) => r.ManagerName || '—').map((g) => ({ ...g, score: rows.find((r) => lower(r.ManagerId) === g.id)?.managerScore || null })),
    };
};

exports._test = { loadOutcomes, sniffDocument, UCPMP_NOTE };
