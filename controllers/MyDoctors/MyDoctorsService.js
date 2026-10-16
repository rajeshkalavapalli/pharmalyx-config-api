const MyDoctorsDA = require('./MyDoctorsDA');

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

const sameId = (a, b) =>
    a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase();

const requireActingUser = (actingUserId) => {
    if (!actingUserId || !GUID.test(actingUserId)) {
        throw fail(401, 'Acting user is required.');
    }
};

exports.getTeam = async (actingUserId) => {
    requireActingUser(actingUserId);

    const rows = await MyDoctorsDA.getTeam(actingUserId);

    return rows.map((row) => ({ ...row, IsSelf: Boolean(row.IsSelf) }));
};

// A user sees their own doctors; a manager can also see a direct report's.
exports.getMyDoctors = async (actingUserId, userId) => {
    requireActingUser(actingUserId);

    const targetUserId = userId || actingUserId;

    if (!GUID.test(String(targetUserId))) {
        throw fail(400, 'User is invalid.');
    }

    if (!sameId(targetUserId, actingUserId)) {
        const target = await MyDoctorsDA.getUser(targetUserId);

        if (!target || !sameId(target.ManagerId, actingUserId)) {
            throw fail(403, "You can only view your own or your team's doctors.");
        }
    }

    return MyDoctorsDA.getMyDoctors(targetUserId);
};
