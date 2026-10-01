
const { customQuery } = require('../../utils/dbFunctions')
const sql = require('./sql')




exports.CreateTerritory = async(finaldata)=>{
    const result = await customQuery(sql.CREATE_TERRITOTY(), finaldata);
    return result
}

exports.getTerritorie = async (StateId) => {

    const territories =
        await customQuery(
            sql.GET_TERRITORIES_BY_STATE(),
            {
                StateId
            }
        );

    return territories;

};

exports.getTerritories = async ()=>{
        const territories = await customQuery(sql.GET_TERRITORIES());
        return territories;
}

exports.updateTerritory = async (TerritoryId, updatedData) => {
    const result = await customQuery(sql.UPDATE_TERRITORY(), {
        TerritoryId,
        ...updatedData
    });
    return result;
};

exports.deleteTerritory = async (TerritoryId) => {
    const result = await customQuery(sql.DELETE_TERRITORY(), {
        TerritoryId
    });
    return result;
};

exports.getTerritoryById = async (TerritoryId) => {
    const result = await customQuery(sql.GET_TERRITORY_BY_ID(), {
        TerritoryId
    });
    return result;
};