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
