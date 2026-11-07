const { getScopeUsers } = require('../../utils/reportScope');
const { canViewUser } = require('../../utils/access');
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

    // Yourself first, then everyone you can see: your team at all levels, or the whole company for head office.
    const { users } = await getScopeUsers(actingUserId);

    return users
        .filter((row) => row.IsActive !== false || row.IsSelf)
        .map((row) => ({ UserId: row.UserId, Name: row.Name, DesignationName: row.DesignationName, ManagerName: row.ManagerName, IsSelf: Boolean(row.IsSelf) }));
};

// A user sees their own doctors; a manager can also see a direct report's.
exports.getMyDoctors = async (actingUserId, userId) => {
    requireActingUser(actingUserId);

    const targetUserId = userId || actingUserId;

    if (!GUID.test(String(targetUserId))) {
        throw fail(400, 'User is invalid.');
    }

    if (!sameId(targetUserId, actingUserId)) {
        if (!(await canViewUser(actingUserId, targetUserId))) {
            throw fail(403, "You can only view your own or your team's doctors.");
        }
    }

    return MyDoctorsDA.getMyDoctors(targetUserId);
};
