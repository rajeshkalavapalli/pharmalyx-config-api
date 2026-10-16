const { customQuery } = require('./dbFunctions');

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Error carrying an HTTP status; handlers send `message` as-is when `status` is set.
const fail = (status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

const sameId = (a, b) =>
    a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase();

const isGuid = (value) => GUID.test(String(value ?? ''));

const requireActingUser = (actingUserId) => {
    if (!actingUserId || !isGuid(actingUserId)) {
        throw fail(401, 'Acting user is required.');
    }
};

const getUser = async (UserId) =>
    (await customQuery('SELECT UserId, ManagerId FROM Users WHERE UserId = @UserId', { UserId }))[0] || null;

// The user whose data is requested: yourself, or a direct report if you manage them.
const resolveViewUser = async (actingUserId, userId, noun = 'data') => {
    requireActingUser(actingUserId);

    const targetUserId = userId || actingUserId;

    if (!isGuid(targetUserId)) throw fail(400, 'User is invalid.');

    if (!sameId(targetUserId, actingUserId)) {
        const target = await getUser(targetUserId);

        if (!target || !sameId(target.ManagerId, actingUserId)) {
            throw fail(403, `You can only view your own or your team's ${noun}.`);
        }
    }

    return targetUserId;
};

// Throws unless the acting user is the target user's reporting manager.
const requireManagerOf = async (actingUserId, targetUserId, action) => {
    requireActingUser(actingUserId);

    if (!isGuid(targetUserId)) throw fail(400, 'User is invalid.');

    const target = await getUser(targetUserId);

    if (!target) throw fail(404, 'User not found.');

    if (!sameId(target.ManagerId, actingUserId)) {
        throw fail(403, `Only the reporting manager can ${action}.`);
    }
};

// Local calendar date as YYYY-MM-DD.
const todayKey = (date = new Date()) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const toDateKey = (value, label) => {
    const text = String(value ?? '').slice(0, 10);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00`))) {
        throw fail(400, `${label} must be a valid date.`);
    }

    return text;
};

const toMonthStart = (value, label = 'Month') => {
    const match = /^(\d{4})-(0[1-9]|1[0-2])(?:-01)?$/.exec(String(value ?? ''));

    if (!match) throw fail(400, `${label} must be in YYYY-MM format.`);

    return `${match[1]}-${match[2]}-01`;
};

const optionalText = (value, max, label) => {
    const text = String(value ?? '').trim();

    if (text.length > max) throw fail(400, `${label} cannot exceed ${max} characters.`);

    return text || null;
};

module.exports = {
    GUID,
    fail,
    sameId,
    isGuid,
    requireActingUser,
    resolveViewUser,
    requireManagerOf,
    todayKey,
    toDateKey,
    toMonthStart,
    optionalText,
};
