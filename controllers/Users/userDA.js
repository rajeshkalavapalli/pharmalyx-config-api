const sql = require('./sql');
const { LOCK_SEATS_SQL, CHECK_SEATS_SQL } = require('../../utils/seats');
const { SET_MUST_CHANGE_SQL, GET_MUST_CHANGE_SQL, CHANGE_OWN_PASSWORD_SQL } = require('../../utils/passwords');

const { customQuery, runInTransaction } = require('../../utils/dbFunctions');

exports.getDesignation = async () => {
    return await customQuery(sql.GET_DESIGNATION());
};

exports.createUser = async (newUser, stateIds = [], territoryIds = []) => {
    const queries = [
        // The company's user limit: lock first, check after the insert (utils/seats.js).
        { sqlQuery: LOCK_SEATS_SQL },
        {
            sqlQuery: sql.CREATE_USER(),
            inputs: newUser,
        },
        // Someone else chose this password: the new user sets their own at first sign-in.
        { sqlQuery: SET_MUST_CHANGE_SQL, inputs: { UserId: newUser.UserId, MustChangePassword: true } },
        ...stateIds.map((StateId) => ({
            sqlQuery: sql.CREATE_USER_STATE_MAPPING(),
            inputs: {
                UserId: newUser.UserId,
                StateId,
            },
        })),
        ...territoryIds.map((TerritoryId) => ({
            sqlQuery: sql.CREATE_USER_TERRITORY_MAPPING(),
            inputs: {
                UserId: newUser.UserId,
                TerritoryId,
            },
        })),
        { sqlQuery: CHECK_SEATS_SQL },
    ];

    await runInTransaction(queries);

    return {
        success: true,
        message: 'User created successfully',
        UserId: newUser.UserId,
        UserName: newUser.UserName,
        DesignationId: newUser.DesignationId,
        DivisionId: newUser.DivisionId,
        CountryId: newUser.CountryId,
        StateIds: [...stateIds],
        TerritoryIds: [...territoryIds],
    };
};

exports.getUsers = async () => {
    return await customQuery(sql.GET_USERS());
};

// mustChange: the new password was set by someone else, so they choose their own at next sign-in.
exports.updateUser = async (updatedUser, stateIds = [], territoryIds = [], countryId, passwordHash = null, mustChange = false) => {
    const queries = [
        {
            sqlQuery: sql.UPDATE_USER(),
            inputs: updatedUser,
        },
        // Only when a new password was entered; otherwise the current one stays.
        ...(passwordHash
            ? [
                  { sqlQuery: sql.UPDATE_USER_PASSWORD(), inputs: { UserId: updatedUser.UserId, PasswordHash: passwordHash } },
                  { sqlQuery: SET_MUST_CHANGE_SQL, inputs: { UserId: updatedUser.UserId, MustChangePassword: mustChange } },
              ]
            : []),
        {
            sqlQuery: sql.DELETE_USER_STATE_MAPPINGS(),
            inputs: { UserId: updatedUser.UserId },
        },
        {
            sqlQuery: sql.DELETE_USER_TERRITORY_MAPPINGS(),
            inputs: { UserId: updatedUser.UserId },
        },
        ...stateIds.map((StateId) => ({
            sqlQuery: sql.CREATE_USER_STATE_MAPPING(),
            inputs: {
                UserId: updatedUser.UserId,
                StateId,
            },
        })),
        ...territoryIds.map((TerritoryId) => ({
            sqlQuery: sql.CREATE_USER_TERRITORY_MAPPING(),
            inputs: {
                UserId: updatedUser.UserId,
                TerritoryId,
            },
        })),
    ];

    await runInTransaction(queries);

    return {
        success: true,
        message: 'User updated successfully',
        UserId: updatedUser.UserId,
        UserName: updatedUser.UserName,
        DesignationId: updatedUser.DesignationId,
        DivisionId: updatedUser.DivisionId,
        CountryId: countryId,
    };
};

// Work this user has done or reviewed: { tableName: rows } for every table naming them,
// apart from their set-up links (which are removed with them).
exports.getUserHistory = async (userId) => {
    const columns = await customQuery(sql.USER_HISTORY_COLUMNS(), { SkipTables: JSON.stringify(['Users', ...sql.USER_LINK_TABLES]) });
    if (!columns.length) return {};
    const counts = await customQuery(sql.USER_HISTORY_COUNTS(columns), { UserId: userId });
    const history = {};
    counts.filter((row) => row.n > 0).forEach((row) => (history[row.tableName] = (history[row.tableName] || 0) + row.n));
    return history;
};

exports.deactivateUser = (userId) => customQuery(sql.DEACTIVATE_USER(), { UserId: userId });

// Removes a user with no history: people reporting to them lose the manager link,
// their assignments and consent go, then the user.
exports.deleteUser = async (userId) => {
    await runInTransaction([
        { sqlQuery: sql.UPDATE_MANAGER_REFERENCE(), inputs: { UserId: userId } },
        { sqlQuery: sql.DELETE_USER_LINKS(sql.USER_LINK_TABLES), inputs: { UserId: userId } },
        { sqlQuery: sql.DELETE_USER(), inputs: { UserId: userId } },
    ]);
};

exports.getUserById = async (userId) => {
    const result = await customQuery(sql.GET_USER_BY_ID(), { UserId: userId });
    return result[0] || null;
};  

// Organisations on: matches in every company (the caller runs this across companies).
exports.getLoginUsersAllOrgs = async (login) => customQuery(sql.GET_LOGIN_USERS_ALL_ORGS(), { Login: login });

exports.getLoginUser = async (login) => {
    const result = await customQuery(sql.GET_LOGIN_USER(), { Login: login });
    return result[0] || null;
};

// True when the user must choose their own password before using the app.
exports.mustChangePassword = async (userId) => {
    const [row] = await customQuery(GET_MUST_CHANGE_SQL, { UserId: userId });
    return Boolean(row?.MustChangePassword);
};

exports.getPasswordHash = async (userId) => {
    const [row] = await customQuery(sql.GET_PASSWORD_HASH(), { UserId: userId });
    return row?.PasswordHash || null;
};

// The person's own new password; clears the must-change flag.
exports.changeOwnPassword = async (userId, passwordHash) => {
    await customQuery(CHANGE_OWN_PASSWORD_SQL, { UserId: userId, PasswordHash: passwordHash });
};

// True when making managerId the manager of userId would create a reporting loop.
exports.wouldLoop = async (userId, managerId) => {
    const [row] = await customQuery(sql.MANAGER_LOOP(), { UserId: userId, ManagerId: managerId });
    return Boolean(row?.Loop);
};

exports.getColleagues = (userId) => customQuery(sql.GET_COLLEAGUES(), { UserId: userId });
