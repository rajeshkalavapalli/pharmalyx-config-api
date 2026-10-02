const sql = require('./sql');

const { customQuery, runInTransaction } = require('../../utils/dbFunctions');

exports.getDesignation = async () => {
    return await customQuery(sql.GET_DESIGNATION());
};

exports.createUser = async (newUser, stateIds = [], territoryIds = []) => {
    const queries = [
        {
            sqlQuery: sql.CREATE_USER(),
            inputs: newUser,
        },
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

exports.updateUser = async (updatedUser, stateIds = [], territoryIds = [], countryId) => {
    const queries = [
        {
            sqlQuery: sql.UPDATE_USER(),
            inputs: updatedUser,
        },
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

exports.deleteUser = async (userId) => {
    await runInTransaction([
        {
            sqlQuery: sql.UPDATE_MANAGER_REFERENCE(),
            inputs: { UserId: userId },
        },
        {
            sqlQuery: sql.DELETE_USER(),
            inputs: { UserId: userId },
        },
    ]);

    return {
        success: true,
        message: 'User deleted successfully',
        UserId: userId,
    };
};

exports.getUserById = async (userId) => {
    const result = await customQuery(sql.GET_USER_BY_ID(), { UserId: userId });
    return result[0] || null;
};  
