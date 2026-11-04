const DA = require('./JointWorkDA');
const UserDA = require('../Users/userDA');
const { istDateKey } = require('../VerifiedWork/rules');
const { notifyLater } = require('../../utils/push');
const { generateUUID } = require('../../utils/commonUtils');
const { fail, isGuid, optionalText, requireActingUser, sameId, toDateKey } = require('../../utils/access');

// Joint work: a field person (e.g. a BDE) asks colleagues from their reporting line, team or
// territory (e.g. the ASM, RSM) to work a day with them. The colleague confirms or declines, the
// day's visits carry the colleagues, and the colleague gives coaching feedback afterwards.

const PAST_DAYS = 3; // a request can be made for the last few days (a visit already done together)
const AHEAD_DAYS = 31;
const lower = (value) => String(value ?? '').toLowerCase();

const addDays = (key, days) => {
    const date = new Date(`${key}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
};

// Until the joint work tables exist, the feature says so instead of failing.
const notReady = (error) => /Invalid object name 'dbo\.(JointWorkDays|VisitJointWorkers)'/i.test(error?.message || '');
const run = async (work) => {
    try {
        return await work();
    } catch (error) {
        if (notReady(error)) throw fail(503, 'Joint work is not set up yet. Please tell your administrator.');
        if (error.number === 50404) throw fail(404, error.message);
        if (error.number === 50409) throw fail(409, error.message);
        throw error;
    }
};

// planned: a senior planned the day in their tour plan (no answer needed; changed from that plan only).
const shape = (row, actingUserId) => {
    const planned = sameId(row.RequestedBy, row.ColleagueUserId);
    return {
        ...row,
        planned,
        mine: sameId(row.UserId, actingUserId), // I am the field person
        canRespond: !planned && sameId(row.ColleagueUserId, actingUserId) && row.WorkDate >= addDays(istDateKey(), -PAST_DAYS),
        canGiveFeedback: sameId(row.ColleagueUserId, actingUserId) && row.Status === 'CONFIRMED' && row.WorkDate <= istDateKey(),
        canCancel: !planned && sameId(row.UserId, actingUserId) && !row.JointCalls,
    };
};

const monthRange = (month) => {
    const match = /^(\d{4})-(\d{2})/.exec(String(month || istDateKey()));
    if (!match) throw fail(400, 'Month must be in YYYY-MM format.');
    const from = `${match[1]}-${match[2]}-01`;
    const to = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).toISOString().slice(0, 10);
    return { from, to };
};

// My joint work for a month (or one date): days I asked for and days I was asked to join.
exports.list = async (actingUserId, query = {}) => {
    requireActingUser(actingUserId);
    const date = query.date ? toDateKey(query.date, 'Date') : null;
    const { from, to } = date ? { from: date, to: date } : monthRange(query.month);
    const rows = (await run(() => DA.mine(actingUserId, from, to))).map((row) => shape(row, actingUserId));
    const withMe = rows.filter((row) => !row.mine);
    return {
        from,
        to,
        asked: rows.filter((row) => row.mine),
        withMe,
        summary: {
            // Field days spent with the team (the usual "JFW days" count for a manager).
            jointDays: new Set(withMe.filter((row) => row.Status === 'CONFIRMED' && row.WorkDate <= istDateKey()).map((row) => row.WorkDate)).size,
            jointCalls: withMe.reduce((sum, row) => sum + Number(row.JointCalls || 0), 0),
            pending: withMe.filter((row) => row.Status === 'PENDING' && row.canRespond).length,
            feedbackDue: withMe.filter((row) => row.canGiveFeedback && !row.FeedbackOn).length,
        },
    };
};

// For the alerts: requests waiting for my answer (badge), my plan days to replan because of leave,
// and the next week's days a senior planned with me. Empty until the tables exist.
exports.pendingCount = async (actingUserId) => {
    requireActingUser(actingUserId);
    const today = istDateKey();
    try {
        const [pending, replan, upcoming] = await Promise.all([
            DA.pendingFor(actingUserId, addDays(today, -PAST_DAYS)),
            DA.replanFor(actingUserId, today),
            DA.upcomingFor(actingUserId, today, addDays(today, 7)),
        ]);
        const brief = (row) => ({ JointWorkId: row.JointWorkId, WorkDate: row.WorkDate, UserName: row.UserName, ColleagueName: row.ColleagueName, ResponseNote: row.ResponseNote });
        return { pending, replan: replan.map(brief), upcoming: upcoming.map(brief) };
    } catch (error) {
        if (notReady(error)) return { pending: 0, replan: [], upcoming: [] };
        throw error;
    }
};

// Today's joint work for My Day (either side). Empty until the tables exist.
exports.todayFor = async (userId) => {
    try {
        const rows = await DA.today(userId, istDateKey());
        return rows.map((row) => {
            const field = sameId(row.UserId, userId);
            return {
                JointWorkId: row.JointWorkId,
                Status: row.Status,
                role: field ? 'field' : 'colleague', // field: I am the field person; colleague: I join them
                withName: field ? row.ColleagueName : row.UserName,
                TerritoryName: row.TerritoryName,
                AreaName: row.AreaName,
            };
        });
    } catch (error) {
        if (notReady(error)) return [];
        throw error;
    }
};

// Leave applied: confirmed joint work days it touches (to warn). Leave approved: those days are cancelled,
// and the senior who planned them sees a "replan" alert. Nothing happens until the tables exist.
exports.leaveClashes = async (userId, from, to) => {
    try {
        return (await DA.leaveClashes(userId, from, to)).map((row) => ({
            WorkDate: row.WorkDate,
            withName: sameId(row.UserId, userId) ? row.ColleagueName : row.UserName,
        }));
    } catch (error) {
        if (notReady(error)) return [];
        throw error;
    }
};

exports.cancelForLeave = async (userId, userName, from, to) => {
    try {
        await DA.cancelForLeave({ UserId: userId, From: from, To: to, Note: `Cancelled: ${userName || 'on'} leave`.slice(0, 300), Now: new Date() });
    } catch (error) {
        if (!notReady(error)) throw error;
    }
};

// Checks colleagues for a joint work day: people I may work with, never me.
const checkColleagues = async (actingUserId, ids) => {
    const unique = [...new Set((Array.isArray(ids) ? ids : []).map(lower).filter(Boolean))];
    if (!unique.length) throw fail(400, 'Choose at least one colleague.');
    if (unique.length > 5) throw fail(400, 'Choose up to 5 colleagues for one day.');
    const allowed = new Set((await UserDA.getColleagues(actingUserId)).map((row) => lower(row.UserId)));
    for (const id of unique) {
        if (!isGuid(id)) throw fail(400, 'A colleague is invalid.');
        if (sameId(id, actingUserId)) throw fail(400, 'Choose colleagues other than yourself.');
        if (!allowed.has(id)) throw fail(400, 'Joint work is possible with your managers, your team and colleagues in your territory.');
    }
    return unique;
};

exports.request = async (actingUserId, payload = {}) => {
    requireActingUser(actingUserId);
    const workDate = toDateKey(payload.WorkDate, 'Date');
    const today = istDateKey();
    if (workDate < addDays(today, -PAST_DAYS) || workDate > addDays(today, AHEAD_DAYS)) {
        throw fail(400, `Joint work can be asked for the last ${PAST_DAYS} days up to ${AHEAD_DAYS} days ahead.`);
    }
    const colleagues = await checkColleagues(actingUserId, payload.ColleagueUserIds);
    const now = new Date();
    await run(() =>
        DA.request(colleagues.map((ColleagueUserId) => ({ JointWorkId: generateUUID(), UserId: actingUserId, ColleagueUserId, WorkDate: workDate, RequestedBy: actingUserId, Now: now })))
    );
    notifyLater(colleagues, {
        title: 'Joint work request',
        body: `A colleague asked you to work with them on ${workDate}. Confirm or decline.`,
        data: { screen: 'JointWork' },
    });
    return { message: colleagues.length === 1 ? 'Joint work request sent.' : `Joint work request sent to ${colleagues.length} colleagues.` };
};

const loadRow = async (actingUserId, jointWorkId) => {
    if (!isGuid(jointWorkId)) throw fail(400, 'Joint work day is invalid.');
    const row = await run(() => DA.byId(jointWorkId));
    if (!row) throw fail(404, 'Joint work request not found.');
    return shape(row, actingUserId);
};

exports.respond = async (actingUserId, jointWorkId, payload = {}) => {
    requireActingUser(actingUserId);
    const row = await loadRow(actingUserId, jointWorkId);
    if (!row.canRespond) throw fail(403, 'Only the invited colleague can answer, and only until a few days after the date.');
    const accept = payload.Accept === true;
    const note = optionalText(payload.Note, 300, 'Note');
    await run(() => DA.respond({ JointWorkId: row.JointWorkId, ColleagueUserId: actingUserId, Status: accept ? 'CONFIRMED' : 'DECLINED', Note: note, Now: new Date() }));
    notifyLater([row.UserId], {
        title: accept ? 'Joint work confirmed' : 'Joint work declined',
        body: `${row.ColleagueName} ${accept ? 'confirmed' : 'declined'} joint work on ${row.WorkDate}.${!accept && note ? ` “${note}”` : ''}`,
        data: { screen: 'JointWork' },
    });
    return { message: accept ? `Joint work with ${row.UserName} on ${row.WorkDate} confirmed.` : 'Joint work request declined.' };
};

exports.feedback = async (actingUserId, jointWorkId, payload = {}) => {
    requireActingUser(actingUserId);
    const row = await loadRow(actingUserId, jointWorkId);
    if (!row.canGiveFeedback) throw fail(403, 'Feedback is given by the colleague, on a confirmed day that has started.');
    const rating = Number(payload.Rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw fail(400, 'Rating must be 1 to 5.');
    const notes = optionalText(payload.Notes, 1000, 'Coaching notes');
    await run(() => DA.feedback({ JointWorkId: row.JointWorkId, ColleagueUserId: actingUserId, Rating: rating, Notes: notes, Now: new Date() }));
    return { message: `Feedback saved for ${row.UserName}.` };
};

exports.cancel = async (actingUserId, jointWorkId) => {
    requireActingUser(actingUserId);
    if (!isGuid(jointWorkId)) throw fail(400, 'Joint work day is invalid.');
    await run(() => DA.cancel({ JointWorkId: jointWorkId, UserId: actingUserId }));
    return { message: 'Joint work request cancelled.' };
};

/**
 * Colleagues for a visit being saved, and the extra transaction steps that record them.
 * explicitIds: colleagues chosen on the visit (optional). Without them, the day's joint work
 * colleagues (not declined) are used. A chosen colleague gets a joint work request for the day.
 * Returns { ids, queries }. Before the tables exist, only the first chosen colleague is kept
 * (stored on the visit itself, as before).
 */
exports.forVisit = async (actingUserId, visitDate, visitId, explicitIds = []) => {
    const chosen = [...new Set(explicitIds.filter(Boolean).map(lower))].filter((id) => !sameId(id, actingUserId));
    let dayIds;
    try {
        dayIds = (await DA.dayColleagues(actingUserId, visitDate)).map(lower);
    } catch (error) {
        if (notReady(error)) return { ids: chosen.slice(0, 1), queries: [] };
        throw error;
    }
    const ids = chosen.length ? chosen : dayIds;
    const now = new Date();
    const queries = [
        ...chosen
            .filter((id) => !dayIds.includes(id))
            .map((ColleagueUserId) => DA.requestQuery({ JointWorkId: generateUUID(), UserId: actingUserId, ColleagueUserId, WorkDate: visitDate, RequestedBy: actingUserId, Now: now })),
        ...ids.map((UserId) => DA.visitWorkerQuery({ VisitId: visitId, UserId })),
    ];
    return { ids, queries };
};
