// Who may see what: an MR sees their own records, a manager their whole team (any depth),
// head office everyone. Head office = the module's "approve" permission (or reports.viewall to view).

const { customQuery } = require('../../utils/dbFunctions');
const { getPermissions } = require('../../utils/permissions');
const { SCOPE_CTE, displayName } = require('../../utils/reportScope');
const { fail, isGuid, requireActingUser, sameId } = require('../../utils/access');

const SCOPE_USERS = `${SCOPE_CTE} SELECT u.UserId, ${displayName('u')} AS Name, u.ManagerId FROM Scope s INNER JOIN Users u ON u.UserId = s.UserId ORDER BY Name`;

// approveCode: 'ledger.approve' or 'spend.approve'
const access = async (actingUserId, approveCode) => {
    requireActingUser(actingUserId);
    const permissions = await getPermissions(actingUserId);
    const headOffice = permissions.has(approveCode);
    const viewAll = headOffice || permissions.has('reports.viewall');
    const users = await customQuery(SCOPE_USERS, { ActingUserId: actingUserId, ViewAll: viewAll ? 1 : 0 });
    return {
        actingUserId,
        permissions,
        headOffice,
        viewAll,
        users,
        userIds: users.map((u) => u.UserId),
        canSee: (userId) => viewAll || users.some((u) => sameId(u.UserId, userId)),
    };
};

// The person whose records are requested: yourself by default, else someone in your scope.
const targetUser = (scope, userId) => {
    if (!userId) return scope.actingUserId;
    if (!isGuid(userId)) throw fail(400, 'User is invalid.');
    if (!scope.canSee(userId)) throw fail(403, "You can only see your own or your team's records.");
    return userId;
};

const requireHeadOffice = (scope) => {
    if (!scope.headOffice) throw fail(403, 'Only head office can do this.');
};

module.exports = { access, targetUser, requireHeadOffice };
