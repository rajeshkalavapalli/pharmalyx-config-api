// Visit explanations: an employee explains a visit that "needs a look" or is "not counted"; their
// reporting manager (or head office) accepts or rejects it.
//   Accept -> the visit counts (ValidityOverride = VALID).   Reject -> it does not (INVALID).
// One explanation per visit, within EXPLAIN_DAYS of the visit. Every decision is audited, and
// head office sees each manager's acceptance pattern, so explanations are not a rubber stamp.
// Needs dbo.VisitExplanations (schema_visit_explanations.sql); until then it says so plainly.

const rules = require('./rules');
const { describeReasons } = require('./VerifiedWorkService');

const { customQuery, runInTransaction } = require('../../utils/dbFunctions');
const { getPermissions } = require('../../utils/permissions');
const { auditQuery } = require('../../utils/audit');
const { displayName } = require('../../utils/reportScope');
const { fail, isGuid, requireActingUser, sameId } = require('../../utils/access');

const EXPLAIN_DAYS = 2; // the visit day plus two days
const MIN_TEXT = 10;
const MAX_TEXT = 500;
const EFFECTIVE = 'COALESCE(v.ValidityOverride, v.Validity)';

const VISIT = `
    SELECT v.VisitId, v.UserId, CONVERT(VARCHAR(10), v.VisitDate, 23) AS VisitDate, v.Validity, v.ValidityOverride,
           ${EFFECTIVE} AS FinalValidity, v.InvalidReasons, u.ManagerId, ${displayName('u')} AS UserName, d.DoctorName
    FROM dbo.Visits v
    INNER JOIN Users u ON u.UserId = v.UserId
    LEFT JOIN dbo.Doctor d ON d.DoctorId = v.DoctorId
    WHERE v.VisitId = @VisitId`;

const EXPLANATION = `SELECT VisitId, UserId, Reason, Status, CreatedOn, ReviewedBy, ReviewedOn, ReviewNote FROM dbo.VisitExplanations WHERE VisitId = @VisitId`;

const INSERT = `
    INSERT INTO dbo.VisitExplanations (VisitId, UserId, Reason, Status, CreatedOn)
    VALUES (@VisitId, @UserId, @Reason, 'PENDING', @Now)`;

// Pending explanations the acting user may decide: their direct reports' (or everyone's for head office).
const PENDING = `
    SELECT e.VisitId AS Id, e.VisitId, e.Reason, e.CreatedOn AS SubmittedOn, e.UserId,
           ${displayName('u')} AS UserName, CONVERT(VARCHAR(10), v.VisitDate, 23) AS VisitDate,
           d.DoctorName, ${EFFECTIVE} AS FinalValidity, v.InvalidReasons, v.DwellSeconds
    FROM dbo.VisitExplanations e
    INNER JOIN dbo.Visits v ON v.VisitId = e.VisitId
    INNER JOIN Users u ON u.UserId = e.UserId
    LEFT JOIN dbo.Doctor d ON d.DoctorId = v.DoctorId
    WHERE e.Status = 'PENDING' AND e.UserId <> @UserId AND (@AllPeople = 1 OR u.ManagerId = @UserId)
    ORDER BY e.CreatedOn`;

// The explanation status of several visits at once (for visit lists).
const FOR_VISITS = `
    SELECT e.VisitId, e.Reason, e.Status, e.ReviewNote, e.ReviewedOn, ${displayName('rv')} AS ReviewedByName
    FROM dbo.VisitExplanations e
    LEFT JOIN Users rv ON rv.UserId = e.ReviewedBy
    WHERE e.VisitId IN (SELECT TRY_CONVERT(UNIQUEIDENTIFIER, value) FROM OPENJSON(@VisitIds))`;

const DECIDE = `
    UPDATE dbo.VisitExplanations SET Status = @Status, ReviewedBy = @ActorId, ReviewedOn = @Now, ReviewNote = @Note
    WHERE VisitId = @VisitId AND Status = 'PENDING';
    IF @@ROWCOUNT = 0 THROW 50409, 'This explanation was already decided.', 1;
    UPDATE dbo.Visits SET ValidityOverride = @Validity, OverrideBy = @ActorId, OverrideOn = @Now, OverrideReason = @OverrideReason, ModifiedOn = @Now
    WHERE VisitId = @VisitId;`;

const lower = (value) => String(value || '').toLowerCase();
const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const addDays = (key, days) => {
    const date = new Date(`${key}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
};

const notReady = (error) => /Invalid object name 'dbo\.VisitExplanations'/i.test(error?.message || '');
const NOT_READY = () => fail(503, 'Explaining visits is not available yet. Please tell your administrator.');

const run = async (work) => {
    try {
        return await work();
    } catch (error) {
        if (notReady(error)) throw NOT_READY();
        if (error.number === 50409) throw fail(409, error.message);
        throw error;
    }
};

const text = (value, label) => {
    const clean = String(value || '').trim();
    if (clean.length < MIN_TEXT) throw fail(400, `${label} needs at least ${MIN_TEXT} characters.`);
    return clean.slice(0, MAX_TEXT);
};

const loadVisit = async (visitId) => {
    if (!isGuid(visitId)) throw fail(400, 'Visit is invalid.');
    const [visit] = await customQuery(VISIT, { VisitId: visitId });
    if (!visit) throw fail(404, 'Visit not found.');
    return visit;
};

// Can this person decide explanations for the visit's owner? Their reporting manager or head office.
const reviewerRights = async (actingUserId, ownerManagerId) => {
    const permissions = await getPermissions(actingUserId);
    const headOffice = permissions.has('verifiedwork.approve');
    return { headOffice, canDecide: headOffice || sameId(ownerManagerId, actingUserId) };
};

// The employee explains their own visit.
exports.explain = async (actingUserId, visitId, payload) => {
    requireActingUser(actingUserId);
    const visit = await loadVisit(visitId);
    if (!sameId(visit.UserId, actingUserId)) throw fail(403, 'You can only explain your own visits.');
    if (!['REVIEW', 'INVALID'].includes(visit.FinalValidity)) throw fail(400, 'This visit already counts; there is nothing to explain.');
    if (istToday() > addDays(visit.VisitDate, EXPLAIN_DAYS)) throw fail(400, `Visits can be explained within ${EXPLAIN_DAYS} days. This one is too old now.`);

    const reason = text(payload.Reason, 'Your explanation');
    return run(async () => {
        const [existing] = await customQuery(EXPLANATION, { VisitId: visitId });
        if (existing) throw fail(409, existing.Status === 'PENDING' ? 'This visit is already explained and waiting for your manager.' : 'This visit was already explained and decided.');

        await runInTransaction([
            { sqlQuery: INSERT, inputs: { VisitId: visitId, UserId: actingUserId, Reason: reason, Now: new Date() } },
            auditQuery({ entityType: 'VISIT', entityId: visitId, action: 'EXPLAIN', actorId: actingUserId, reason }),
        ]);
        return { message: visit.ManagerId ? 'Sent to your manager. You will see their decision on this visit.' : 'Sent to head office. You will see their decision on this visit.' };
    });
};

// Explanations waiting for the acting user's decision.
exports.listPending = async (actingUserId) => {
    requireActingUser(actingUserId);
    const permissions = await getPermissions(actingUserId);
    const rows = await run(() => customQuery(PENDING, { UserId: actingUserId, AllPeople: permissions.has('verifiedwork.approve') ? 1 : 0 }));
    return rows.map((row) => ({ ...row, ...describeReasons(row.InvalidReasons), InvalidReasons: undefined }));
};

// Manager / head office decision.
exports.decide = async (actingUserId, visitId, accept, payload = {}) => {
    requireActingUser(actingUserId);
    const visit = await loadVisit(visitId);
    if (sameId(visit.UserId, actingUserId)) throw fail(403, 'You cannot decide on your own visit.');
    const { canDecide } = await reviewerRights(actingUserId, visit.ManagerId);
    if (!canDecide) throw fail(403, "Only the employee's reporting manager or head office can decide this.");

    const note = String(payload.Note ?? payload.Remarks ?? '').trim().slice(0, MAX_TEXT) || null;
    if (!accept && (!note || note.length < MIN_TEXT)) throw fail(400, `Say why you are rejecting it (at least ${MIN_TEXT} characters); the employee will see this.`);

    return run(async () => {
        const [explanation] = await customQuery(EXPLANATION, { VisitId: visitId });
        if (!explanation) throw fail(404, 'This visit has no explanation to decide.');
        const now = new Date();
        await runInTransaction([
            {
                sqlQuery: DECIDE,
                inputs: {
                    VisitId: visitId,
                    Status: accept ? 'ACCEPTED' : 'REJECTED',
                    Validity: accept ? 'VALID' : 'INVALID',
                    ActorId: actingUserId,
                    Now: now,
                    Note: note,
                    OverrideReason: `${accept ? 'Explanation accepted' : 'Explanation rejected'}: ${note || explanation.Reason}`.slice(0, 1000),
                },
            },
            auditQuery({ entityType: 'VISIT', entityId: visitId, action: accept ? 'EXPLANATION_ACCEPTED' : 'EXPLANATION_REJECTED', actorId: actingUserId, reason: note, before: { validity: visit.FinalValidity } }),
        ]);
        return { message: accept ? `Accepted. ${visit.UserName}'s visit to Dr. ${visit.DoctorName || ''} now counts.`.replace('Dr.  ', '') : 'Rejected. The employee will see your reason.' };
    });
};

// Explanation per visit id, for visit lists; {} before the table exists.
exports.forVisits = async (visitIds) => {
    const ids = (visitIds || []).filter(isGuid);
    if (!ids.length) return {};
    try {
        const rows = await customQuery(FOR_VISITS, { VisitIds: JSON.stringify(ids) });
        return Object.fromEntries(rows.map((row) => [lower(row.VisitId), row]));
    } catch (error) {
        if (notReady(error)) return {};
        throw error;
    }
};

// Can the employee still explain this visit? (for the screens)
exports.canExplain = (visit, explanation, actingUserId) =>
    sameId(visit.UserId, actingUserId) &&
    ['REVIEW', 'INVALID'].includes(visit.FinalValidity) &&
    !explanation &&
    istToday() <= addDays(String(visit.VisitDate).slice(0, 10), EXPLAIN_DAYS);

exports.EXPLAIN_DAYS = EXPLAIN_DAYS;
exports._internals = { rules };
