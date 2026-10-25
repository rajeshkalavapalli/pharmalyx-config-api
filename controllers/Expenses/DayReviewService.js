// TA / DA day reviews. A work day that looks unusual (VerifiedWork/dayChecks.js) is put ON HOLD:
// its DA / TA is worked out as usual but not paid until a decision.
//   HELD          the employee sees the hold and the reason, and sends their reason
//   WITH_MANAGER  the reporting manager reviews: reject -> NOT_PAYABLE (final), approve -> WITH_ADMIN
//   WITH_ADMIN    head office decides: PAYABLE or NOT_PAYABLE, with a reason
// Timers move a day on: no reason within 2 days -> manager; no manager decision within 3 days -> admin.
// Wording is facts only. Every step is in the audit log. The day report (admin only) is a printable
// summary with a verification code, for disputes.
// Needs dbo.AllowanceDayReviews / dbo.PolicyAcceptances (schema_day_reviews.sql); until then holds are off.

const crypto = require('crypto');

const DayChecks = require('../VerifiedWork/dayChecks');
const { loadSettings } = require('../VerifiedWork/territory');

const { customQuery, runInTransaction } = require('../../utils/dbFunctions');
const { forEachOrganisation } = require('../../utils/orgContext');
const { auditQuery } = require('../../utils/audit');
const { displayName } = require('../../utils/reportScope');
const { generateUUID } = require('../../utils/commonUtils');
const { fail, isGuid, requireActingUser, sameId } = require('../../utils/access');

const REASON_DAYS = 2; // employee's time to give a reason
const MANAGER_DAYS = 3; // manager's time to decide
const MIN_TEXT = 10;
const MAX_TEXT = 500;
const OPEN = ['HELD', 'WITH_MANAGER', 'WITH_ADMIN'];

// The allowance policy the employee accepts in the app (version recorded with each acceptance).
const POLICY = {
    code: 'ALLOWANCE',
    version: '1.0',
    title: 'TA / DA policy',
    points: [
        'TA / DA is paid for field work done on the day, in your territory, as planned.',
        'TA is worked out from the distance your phone records during work hours; DA from the visits that count that day.',
        'Report each visit at the clinic with a live check-in. Without network the app saves it and sends it later.',
        'If a day looks unusual, its TA / DA is put on hold, not cut. You will see why, and you can send your reason.',
        'Your manager reviews your reason. If your manager rejects it, the day is not payable. If your manager approves, head office makes the final decision.',
        'Every step, with names, times and reasons, is recorded and kept.',
    ],
};

const lower = (value) => String(value || '').toLowerCase();
const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const notReady = (error) => /Invalid object name 'dbo\.(AllowanceDayReviews|PolicyAcceptances)'/i.test(error?.message || '');
const NOT_READY = () => fail(503, 'Day reviews are not available yet. Please tell your administrator.');

const run = async (work) => {
    try {
        return await work();
    } catch (error) {
        if (notReady(error)) throw NOT_READY();
        if (error.number === 50409) throw fail(409, error.message);
        throw error;
    }
};

const text = (value, label, { required = true } = {}) => {
    const clean = String(value || '').trim().slice(0, MAX_TEXT);
    if (required && clean.length < MIN_TEXT) throw fail(400, `${label} needs at least ${MIN_TEXT} characters.`);
    return clean || null;
};

// ---------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------

const REVIEW_COLUMNS = `
    r.ReviewId, r.UserId, CONVERT(VARCHAR(10), r.WorkDate, 23) AS WorkDate, r.Status, r.Findings, r.DaAmount, r.TaAmount,
    r.EmployeeReason, r.EmployeeAt, r.ManagerId, r.ManagerDecision, r.ManagerComment, r.ManagerAt,
    r.AdminId, r.AdminDecision, r.AdminComment, r.AdminAt, r.AutoNote, r.StageSince, r.ReleasedClaimId, r.CreatedOn,
    ${displayName('u')} AS UserName, sld.SystemLovDetailName AS DesignationName, u.ManagerId AS OwnerManagerId,
    ${displayName('m')} AS ManagerName, ${displayName('a')} AS AdminName`;

const REVIEW_JOINS = `
    FROM dbo.AllowanceDayReviews r
    INNER JOIN Users u ON u.UserId = r.UserId
    LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = u.DesignationId
    LEFT JOIN Users m ON m.UserId = r.ManagerId
    LEFT JOIN Users a ON a.UserId = r.AdminId`;

const SQL = {
    forUser: `SELECT ${REVIEW_COLUMNS} ${REVIEW_JOINS} WHERE r.UserId = @UserId AND r.WorkDate BETWEEN @From AND @To`,
    byId: `SELECT ${REVIEW_COLUMNS} ${REVIEW_JOINS} WHERE r.ReviewId = @ReviewId`,
    insert: `
        IF NOT EXISTS (SELECT 1 FROM dbo.AllowanceDayReviews WHERE UserId = @UserId AND WorkDate = @WorkDate)
            INSERT INTO dbo.AllowanceDayReviews (ReviewId, UserId, WorkDate, Status, Findings, DaAmount, TaAmount, StageSince, CreatedOn)
            VALUES (@ReviewId, @UserId, @WorkDate, 'HELD', @Findings, @DaAmount, @TaAmount, @Now, @Now)`,
    amounts: `UPDATE dbo.AllowanceDayReviews SET DaAmount = @DaAmount, TaAmount = @TaAmount WHERE ReviewId = @ReviewId AND Status IN ('HELD', 'WITH_MANAGER', 'WITH_ADMIN')`,
    // One guarded move per decision: the row must still be in the expected step.
    move: (sets) => `
        UPDATE dbo.AllowanceDayReviews SET ${sets}, StageSince = @Now, ModifiedOn = @Now
        WHERE ReviewId = @ReviewId AND Status = @FromStatus;
        IF @@ROWCOUNT = 0 THROW 50409, 'This day was already moved to another step. Refresh to see it.', 1;`,
    withManager: `SELECT ${REVIEW_COLUMNS} ${REVIEW_JOINS} WHERE r.Status = 'WITH_MANAGER' AND u.ManagerId = @UserId AND r.UserId <> @UserId ORDER BY r.StageSince`,
    withAdmin: `SELECT ${REVIEW_COLUMNS} ${REVIEW_JOINS} WHERE r.Status = 'WITH_ADMIN' AND r.UserId <> @UserId ORDER BY r.StageSince`,
    managerRejections: `SELECT ${REVIEW_COLUMNS} ${REVIEW_JOINS} WHERE r.ManagerDecision = 'REJECTED' AND r.ManagerAt >= @Since ORDER BY r.ManagerAt DESC`,
    // The special case only: payable but no DA (too few counted visits), still open for a DA grant.
    approvedWithoutDa: `SELECT ${REVIEW_COLUMNS} ${REVIEW_JOINS} WHERE r.Status = 'PAYABLE' AND r.AdminDecision = 'APPROVED' AND ISNULL(r.DaAmount, 0) = 0 AND r.ReleasedClaimId IS NULL AND r.AdminAt >= @Since ORDER BY r.AdminAt DESC`,
    // The day's month claim, and whether that claim already pays an amount for the day.
    monthClaimStatus: `
        SELECT TOP 1 c.Status,
               CASE WHEN EXISTS (SELECT 1 FROM dbo.ExpenseClaimDays d WHERE d.ClaimId = c.ClaimId AND d.ExpenseDate = @WorkDate
                                 AND ISNULL(d.DaAmount, 0) + ISNULL(d.TaAmount, 0) > 0) THEN 1 ELSE 0 END AS DayPaidInClaim
        FROM dbo.ExpenseClaims c WHERE c.UserId = @UserId AND c.ClaimMonth = DATEFROMPARTS(YEAR(@WorkDate), MONTH(@WorkDate), 1)`,
    grantLater: `
        UPDATE dbo.AllowanceDayReviews
        SET AdminDecision = 'GRANT_DA', AdminId = @ActorId, AdminAt = @Now, DaAmount = @DaAmount, TaAmount = @TaAmount,
            AdminComment = LEFT(CONCAT(ISNULL(AdminComment + ' | ', ''), 'DA granted: ', @Comment), 500), ModifiedOn = @Now
        WHERE ReviewId = @ReviewId AND Status = 'PAYABLE' AND AdminDecision = 'APPROVED' AND ReleasedClaimId IS NULL;
        IF @@ROWCOUNT = 0 THROW 50409, 'This day was changed meanwhile. Refresh to see it.', 1;`,
    overdue: `
        SELECT r.ReviewId, r.Status, r.UserId, u.ManagerId AS OwnerManagerId
        FROM dbo.AllowanceDayReviews r INNER JOIN Users u ON u.UserId = r.UserId
        WHERE (r.Status = 'HELD' AND r.StageSince < @ReasonCutoff) OR (r.Status = 'WITH_MANAGER' AND r.StageSince < @ManagerCutoff)`,
    // Payable after its own month's claim was submitted, not yet paid with a later claim.
    releasable: `
        SELECT r.ReviewId, CONVERT(VARCHAR(10), r.WorkDate, 23) AS WorkDate, r.DaAmount, r.TaAmount
        FROM dbo.AllowanceDayReviews r
        WHERE r.UserId = @UserId AND r.Status = 'PAYABLE' AND r.ReleasedClaimId IS NULL AND r.WorkDate < @Month
          AND EXISTS (SELECT 1 FROM dbo.ExpenseClaims c WHERE c.UserId = r.UserId
                      AND c.ClaimMonth = DATEFROMPARTS(YEAR(r.WorkDate), MONTH(r.WorkDate), 1) AND c.Status NOT IN ('DRAFT', 'RETURNED')
                      -- only if the day was still on hold (no amount) in that submitted claim, so it is never paid twice
                      AND NOT EXISTS (SELECT 1 FROM dbo.ExpenseClaimDays d WHERE d.ClaimId = c.ClaimId AND d.ExpenseDate = r.WorkDate
                                      AND ISNULL(d.DaAmount, 0) + ISNULL(d.TaAmount, 0) > 0))`,
    markReleased: `UPDATE dbo.AllowanceDayReviews SET ReleasedClaimId = @ClaimId, ModifiedOn = @Now WHERE ReviewId = @ReviewId AND ReleasedClaimId IS NULL`,
    accepted: `SELECT TOP 1 Version, AcceptedAt FROM dbo.PolicyAcceptances WHERE UserId = @UserId AND PolicyCode = @Code ORDER BY AcceptedAt DESC`,
    accept: `
        IF NOT EXISTS (SELECT 1 FROM dbo.PolicyAcceptances WHERE UserId = @UserId AND PolicyCode = @Code AND Version = @Version)
            INSERT INTO dbo.PolicyAcceptances (AcceptanceId, UserId, PolicyCode, Version, AcceptedAt, UserAgent) VALUES (@AcceptanceId, @UserId, @Code, @Version, @Now, @UserAgent)`,
    reportVisits: `
        SELECT d.DoctorName, a.AreaName, v.CheckInAt, v.CheckOutAt, v.DwellSeconds, v.Latitude, v.Longitude, COALESCE(v.ValidityOverride, v.Validity) AS FinalValidity
        FROM dbo.Visits v
        INNER JOIN dbo.Doctor d ON d.DoctorId = v.DoctorId
        LEFT JOIN Areas a ON a.AreaId = TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId)
        WHERE v.UserId = @UserId AND v.VisitDate = @WorkDate
        ORDER BY COALESCE(v.CheckInAt, v.CreatedOn)`,
    reportPoints: `
        SELECT COALESCE(DeviceAt, ServerAt) AS At, Latitude AS Lat, Longitude AS Lng
        FROM dbo.LocationPings WHERE UserId = @UserId AND PingDate = @WorkDate AND ISNULL(IsMock, 0) = 0
        ORDER BY COALESCE(DeviceAt, ServerAt)`,
};

const parseFindings = (value) => {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const shape = (row) =>
    row && {
        ReviewId: row.ReviewId,
        UserId: row.UserId,
        UserName: row.UserName,
        DesignationName: row.DesignationName,
        WorkDate: row.WorkDate,
        Status: row.Status,
        Findings: parseFindings(row.Findings),
        DaAmount: money(row.DaAmount),
        TaAmount: money(row.TaAmount),
        Amount: money(Number(row.DaAmount || 0) + Number(row.TaAmount || 0)),
        EmployeeReason: row.EmployeeReason,
        EmployeeAt: row.EmployeeAt,
        ManagerName: row.ManagerName,
        ManagerDecision: row.ManagerDecision,
        ManagerComment: row.ManagerComment,
        ManagerAt: row.ManagerAt,
        AdminName: row.AdminName,
        AdminDecision: row.AdminDecision,
        // Head office granted DA although the day had fewer counted visits than the DA rule.
        DaGranted: row.Status === 'PAYABLE' && row.AdminDecision === 'GRANT_DA',
        AdminComment: row.AdminComment,
        AdminAt: row.AdminAt,
        AutoNote: row.AutoNote,
        StageSince: row.StageSince,
        Released: Boolean(row.ReleasedClaimId),
    };

const loadReview = async (reviewId) => {
    if (!isGuid(reviewId)) throw fail(400, 'Day is invalid.');
    const [row] = await run(() => customQuery(SQL.byId, { ReviewId: reviewId }));
    if (!row) throw fail(404, 'Day review not found.');
    return row;
};

// ---------------------------------------------------------------------
// Holds (used by the claim and the daily statement)
// ---------------------------------------------------------------------

/**
 * Puts unusual days of the range on hold (once per day) and returns Map(date -> review) for the range.
 * facts: the allowance day facts (date, km, station, points). price(fact) -> { da, ta } in rupees.
 * Returns an empty map until the tables exist, so claims work exactly as before.
 */
exports.holdsFor = async (userId, from, to, facts, price) => {
    try {
        const settings = await loadSettings();
        const findings = await DayChecks.findingsFor(userId, from, to, facts, settings);
        const existing = await customQuery(SQL.forUser, { UserId: userId, From: from, To: to });
        const known = new Set(existing.map((row) => row.WorkDate));
        const factByDate = new Map(facts.map((fact) => [fact.date, fact]));
        const now = new Date();

        // Hold only days that would pay something: a ₹0 day has nothing to review.
        const inserts = [...findings].filter(([date]) => {
            if (known.has(date) || !factByDate.has(date)) return false;
            const amount = price(factByDate.get(date));
            return Number(amount.da || 0) + Number(amount.ta || 0) > 0;
        });
        for (const [date, list] of inserts) {
            const amount = price(factByDate.get(date));
            await runInTransaction([
                { sqlQuery: SQL.insert, inputs: { ReviewId: generateUUID(), UserId: userId, WorkDate: date, Findings: JSON.stringify(list), DaAmount: amount.da, TaAmount: amount.ta, Now: now } },
                auditQuery({ entityType: 'ALLOWANCE_DAY', entityId: `${userId}:${date}`, action: 'HOLD', actorId: null, after: { findings: list.map((f) => f.code) } }),
            ]);
        }

        const rows = inserts.length ? await customQuery(SQL.forUser, { UserId: userId, From: from, To: to }) : existing;
        // Keep the amount on hold in step with the day (km and visits can change while the claim is open).
        for (const row of rows.filter((r) => OPEN.includes(r.Status) && factByDate.has(r.WorkDate))) {
            const amount = price(factByDate.get(row.WorkDate));
            if (money(row.DaAmount) !== money(amount.da) || money(row.TaAmount) !== money(amount.ta)) {
                await customQuery(SQL.amounts, { ReviewId: row.ReviewId, DaAmount: amount.da, TaAmount: amount.ta });
                row.DaAmount = amount.da;
                row.TaAmount = amount.ta;
            }
        }
        return new Map(rows.map((row) => [row.WorkDate, shape(row)]));
    } catch (error) {
        if (notReady(error)) return new Map();
        throw error;
    }
};

// Is a day's amount held back from the claim? (on hold, or decided not payable)
exports.isHeld = (review) => Boolean(review) && review.Status !== 'PAYABLE';

// Payable days from earlier months whose claim was already submitted: paid with this claim.
exports.releasable = async (userId, month) => {
    try {
        return await customQuery(SQL.releasable, { UserId: userId, Month: month });
    } catch (error) {
        if (notReady(error)) return [];
        throw error;
    }
};
exports.markReleasedQuery = (reviewId, claimId, now) => ({ sqlQuery: SQL.markReleased, inputs: { ReviewId: reviewId, ClaimId: claimId, Now: now } });

// ---------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------

// The employee sends their reason for a held day.
exports.sendReason = async (actingUserId, reviewId, payload) => {
    requireActingUser(actingUserId);
    const review = await loadReview(reviewId);
    if (!sameId(review.UserId, actingUserId)) throw fail(403, 'You can only explain your own days.');
    if (review.Status !== 'HELD') throw fail(409, 'This day is already with your manager or decided.');

    const reason = text(payload.Reason, 'Your reason');
    const toAdmin = !review.OwnerManagerId;
    const now = new Date();
    await run(() =>
        runInTransaction([
            {
                sqlQuery: SQL.move("Status = @ToStatus, EmployeeReason = @Reason, EmployeeAt = @Now"),
                inputs: { ReviewId: reviewId, FromStatus: 'HELD', ToStatus: toAdmin ? 'WITH_ADMIN' : 'WITH_MANAGER', Reason: reason, Now: now },
            },
            auditQuery({ entityType: 'ALLOWANCE_DAY', entityId: reviewId, action: 'REASON', actorId: actingUserId, reason }),
        ])
    );
    return { message: toAdmin ? 'Sent to head office for review.' : 'Sent to your manager for review.' };
};

// The reporting manager: reject = final (not payable); approve = goes to head office. A comment is always required.
exports.managerDecide = async (actingUserId, reviewId, approve, payload = {}) => {
    requireActingUser(actingUserId);
    const review = await loadReview(reviewId);
    if (sameId(review.UserId, actingUserId)) throw fail(403, 'You cannot review your own day.');
    if (!sameId(review.OwnerManagerId, actingUserId)) throw fail(403, "Only the employee's reporting manager can review this day.");
    if (review.Status !== 'WITH_MANAGER') throw fail(409, 'This day is not waiting for the manager.');

    const comment = text(payload.Comment ?? payload.Note ?? payload.Remarks, 'Your comment');
    const now = new Date();
    await run(() =>
        runInTransaction([
            {
                sqlQuery: SQL.move('Status = @ToStatus, ManagerId = @ActorId, ManagerDecision = @Decision, ManagerComment = @Comment, ManagerAt = @Now'),
                inputs: { ReviewId: reviewId, FromStatus: 'WITH_MANAGER', ToStatus: approve ? 'WITH_ADMIN' : 'NOT_PAYABLE', ActorId: actingUserId, Decision: approve ? 'APPROVED' : 'REJECTED', Comment: comment, Now: now },
            },
            auditQuery({ entityType: 'ALLOWANCE_DAY', entityId: reviewId, action: approve ? 'MANAGER_APPROVED' : 'MANAGER_REJECTED', actorId: actingUserId, reason: comment }),
        ])
    );
    return { message: approve ? 'Approved and sent to head office for the final decision.' : 'Rejected. The day is not payable; the employee sees your comment.' };
};

// Head office: the final decision. A reason is required to refuse.
exports.adminDecide = async (actingUserId, reviewId, approve, payload = {}) => {
    requireActingUser(actingUserId);
    const review = await loadReview(reviewId);
    if (sameId(review.UserId, actingUserId)) throw fail(403, 'You cannot decide your own day.');
    if (review.Status !== 'WITH_ADMIN') throw fail(409, 'This day is not waiting for head office.');

    // Granting DA on a day short of the DA rule is a head office decision with a written reason.
    const grantDa = approve && payload.GrantDa === true;
    const comment = text(payload.Comment ?? payload.Note ?? payload.Remarks, grantDa ? 'Your reason for granting DA' : 'Your reason', { required: !approve || grantDa });

    // The payable amount, worked out again now (with DA when granted), so a later claim pays it exactly.
    const amount = approve ? await require('./ExpensesService').priceReviewedDay(review.UserId, review.WorkDate, grantDa) : null;
    const now = new Date();
    await run(() =>
        runInTransaction([
            {
                sqlQuery: SQL.move(`Status = @ToStatus, AdminId = @ActorId, AdminDecision = @Decision, AdminComment = @Comment, AdminAt = @Now${amount ? ', DaAmount = @DaAmount, TaAmount = @TaAmount' : ''}`),
                inputs: {
                    ReviewId: reviewId,
                    FromStatus: 'WITH_ADMIN',
                    ToStatus: approve ? 'PAYABLE' : 'NOT_PAYABLE',
                    ActorId: actingUserId,
                    Decision: grantDa ? 'GRANT_DA' : approve ? 'APPROVED' : 'REJECTED',
                    Comment: comment,
                    Now: now,
                    ...(amount ? { DaAmount: amount.da, TaAmount: amount.ta } : {}),
                },
            },
            auditQuery({ entityType: 'ALLOWANCE_DAY', entityId: reviewId, action: grantDa ? 'ADMIN_GRANTED_DA' : approve ? 'ADMIN_APPROVED' : 'ADMIN_REJECTED', actorId: actingUserId, reason: comment, after: amount || null }),
        ])
    );
    if (grantDa) return { message: `Payable with DA granted (${amount.da.toLocaleString('en-IN')} DA + ${amount.ta.toLocaleString('en-IN')} TA). The employee sees your reason.` };
    return { message: approve ? 'Payable. It is added to the claim.' : 'Not payable. The employee and the manager see your reason.' };
};

// Head office grants DA on a day it already approved without DA (with a reason). Only while the
// day's claim is still open, or the day is waiting to be paid with a later claim.
exports.grantDaLater = async (actingUserId, reviewId, payload = {}) => {
    requireActingUser(actingUserId);
    const review = await loadReview(reviewId);
    if (sameId(review.UserId, actingUserId)) throw fail(403, 'You cannot decide your own day.');
    if (review.Status !== 'PAYABLE' || review.AdminDecision !== 'APPROVED') throw fail(409, 'DA can be granted only on a day approved as payable without DA.');
    if (Number(review.DaAmount || 0) > 0) throw fail(409, 'This day already earns DA.');
    if (review.ReleasedClaimId) throw fail(409, 'This day was already paid with a claim.');

    const [claim] = await customQuery(SQL.monthClaimStatus, { UserId: review.UserId, WorkDate: review.WorkDate });
    // Open claim: it follows the change. Submitted claim: only a day it did not pay (still on hold at
    // submission) can change; that day is paid with a later claim at the new amount.
    const open = !claim || ['DRAFT', 'RETURNED'].includes(claim.Status);
    if (!open && claim.DayPaidInClaim) throw fail(409, 'This day is already paid inside the submitted claim for its month, so DA cannot be added now.');

    const comment = text(payload.Comment ?? payload.Note, 'Your reason for granting DA');
    const amount = await require('./ExpensesService').priceReviewedDay(review.UserId, review.WorkDate, true);
    const now = new Date();
    await run(() =>
        runInTransaction([
            { sqlQuery: SQL.grantLater, inputs: { ReviewId: reviewId, ActorId: actingUserId, Now: now, DaAmount: amount.da, TaAmount: amount.ta, Comment: comment } },
            auditQuery({ entityType: 'ALLOWANCE_DAY', entityId: reviewId, action: 'ADMIN_GRANTED_DA', actorId: actingUserId, reason: comment, after: amount }),
        ])
    );
    return { message: `DA granted: ${amount.da.toLocaleString('en-IN')} DA + ${amount.ta.toLocaleString('en-IN')} TA for ${review.WorkDate}.` };
};

exports.approvedWithoutDa = async (days = 60) =>
    (await run(() => customQuery(SQL.approvedWithoutDa, { Since: new Date(Date.now() - days * 86400000) }))).map(shape);

// Lists: the manager's queue, head office's queue, and (head office, read only) manager rejections.
exports.managerQueue = async (actingUserId) => (await run(() => customQuery(SQL.withManager, { UserId: actingUserId }))).map(shape);
exports.adminQueue = async (actingUserId) => (await run(() => customQuery(SQL.withAdmin, { UserId: actingUserId }))).map(shape);
exports.managerRejections = async (days = 90) =>
    (await run(() => customQuery(SQL.managerRejections, { Since: new Date(Date.now() - days * 86400000) }))).map(shape);

// ---------------------------------------------------------------------
// Timers: nobody can block a day by doing nothing
// ---------------------------------------------------------------------

exports.autoForward = async (now = new Date()) => {
    let rows;
    try {
        rows = await customQuery(SQL.overdue, { ReasonCutoff: new Date(now - REASON_DAYS * 86400000), ManagerCutoff: new Date(now - MANAGER_DAYS * 86400000) });
    } catch (error) {
        if (notReady(error)) return 0;
        throw error;
    }
    for (const row of rows) {
        const held = row.Status === 'HELD';
        const toStatus = held && row.OwnerManagerId ? 'WITH_MANAGER' : 'WITH_ADMIN';
        const note = held ? `No reason was given within ${REASON_DAYS} days.` : `The manager did not decide within ${MANAGER_DAYS} days.`;
        await runInTransaction([
            { sqlQuery: SQL.move('Status = @ToStatus, AutoNote = @Note'), inputs: { ReviewId: row.ReviewId, FromStatus: row.Status, ToStatus: toStatus, Note: note, Now: now } },
            auditQuery({ entityType: 'ALLOWANCE_DAY', entityId: row.ReviewId, action: 'AUTO_FORWARD', actorId: null, reason: note }),
        ]).catch((error) => console.error('Day review auto-forward failed:', error.message));
    }
    return rows.length;
};

exports.startScheduler = (hours = 1) => {
    const tick = () => forEachOrganisation(customQuery, () => exports.autoForward(), 'Day reviews').catch((error) => console.error('Day review timers failed:', error.message));
    setTimeout(tick, 60 * 1000);
    return setInterval(tick, hours * 3600 * 1000);
};

// ---------------------------------------------------------------------
// Policy acceptance
// ---------------------------------------------------------------------

exports.getPolicy = async (actingUserId) => {
    requireActingUser(actingUserId);
    let accepted = null;
    try {
        [accepted] = await customQuery(SQL.accepted, { UserId: actingUserId, Code: POLICY.code });
    } catch (error) {
        if (!notReady(error)) throw error;
    }
    return { ...POLICY, accepted: accepted ? { version: accepted.Version, at: accepted.AcceptedAt, current: accepted.Version === POLICY.version } : null };
};

exports.acceptPolicy = async (actingUserId, userAgent) => {
    requireActingUser(actingUserId);
    await run(() =>
        runInTransaction([
            { sqlQuery: SQL.accept, inputs: { AcceptanceId: generateUUID(), UserId: actingUserId, Code: POLICY.code, Version: POLICY.version, Now: new Date(), UserAgent: String(userAgent || '').slice(0, 300) || null } },
            auditQuery({ entityType: 'POLICY', entityId: `${POLICY.code}:${POLICY.version}`, action: 'ACCEPT', actorId: actingUserId }),
        ])
    );
    return { message: 'Thank you. Your acceptance is recorded.' };
};

// ---------------------------------------------------------------------
// Day report (head office only): one printable page, with a verification code
// ---------------------------------------------------------------------

const referenceOf = (review) => `PLX-DR-${review.WorkDate.replace(/-/g, '')}-${String(review.ReviewId).slice(0, 4).toUpperCase()}`;

// The code is an HMAC of the report's facts, so any change to the record changes the code.
const codeOf = (facts) => {
    const secret = process.env.AUTH_SECRET || 'pharmalyx';
    const hex = crypto.createHmac('sha256', secret).update(JSON.stringify(facts)).digest('hex').toUpperCase();
    return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
};

const travelSummary = (points) => {
    const { travelledKm } = require('../VerifiedWork/rules');
    const usable = points.map((p) => ({ at: p.At, lat: Number(p.Lat), lng: Number(p.Lng) }));
    return { km: usable.length ? travelledKm(usable).km : 0, points: usable.length, first: points[0]?.At || null, last: points[points.length - 1]?.At || null, route: usable.map((p) => [p.lat, p.lng]) };
};

const reportFacts = async (reviewId) => {
    const review = shape(await loadReview(reviewId));
    const [visits, points, accepted] = await Promise.all([
        customQuery(SQL.reportVisits, { UserId: review.UserId, WorkDate: review.WorkDate }),
        customQuery(SQL.reportPoints, { UserId: review.UserId, WorkDate: review.WorkDate }),
        customQuery(SQL.accepted, { UserId: review.UserId, Code: POLICY.code }).catch(() => []),
    ]);
    return {
        reference: referenceOf(review),
        employee: { name: review.UserName, designation: review.DesignationName },
        date: review.WorkDate,
        claimed: { da: review.DaAmount, ta: review.TaAmount, total: review.Amount },
        findings: review.Findings,
        travel: travelSummary(points),
        visits: visits.map((v) => ({
            doctor: v.DoctorName,
            area: v.AreaName,
            checkIn: v.CheckInAt,
            checkOut: v.CheckOutAt,
            staySeconds: v.DwellSeconds,
            reportedAt: v.Latitude != null ? [Number(v.Latitude), Number(v.Longitude)] : null,
            result: v.FinalValidity,
        })),
        policy: { title: POLICY.title, version: POLICY.version, points: POLICY.points, acceptedVersion: accepted[0]?.Version || null, acceptedAt: accepted[0]?.AcceptedAt || null },
        steps: {
            employee: review.EmployeeReason ? { reason: review.EmployeeReason, at: review.EmployeeAt } : null,
            manager: review.ManagerDecision ? { name: review.ManagerName, decision: review.ManagerDecision, comment: review.ManagerComment, at: review.ManagerAt } : null,
            admin: review.AdminDecision ? { name: review.AdminName, decision: review.AdminDecision, comment: review.AdminComment, at: review.AdminAt } : null,
            autoNote: review.AutoNote,
        },
        status: review.Status,
    };
};

exports.dayReport = async (actingUserId, reviewId) => {
    requireActingUser(actingUserId);
    const facts = await reportFacts(reviewId);
    return { ...facts, verificationCode: codeOf(facts), generatedAt: new Date() };
};

// Verify a printed report: same reference and code means the record is unchanged.
exports.verifyReport = async (actingUserId, reviewId, code) => {
    requireActingUser(actingUserId);
    const facts = await reportFacts(reviewId);
    const genuine = String(code || '').trim().toUpperCase() === codeOf(facts);
    return { reference: facts.reference, genuine, message: genuine ? 'This report matches the record: it has not been changed.' : 'This code does not match the current record.' };
};

exports.POLICY = POLICY;
exports.OPEN = OPEN;
