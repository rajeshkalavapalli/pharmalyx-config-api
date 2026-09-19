
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
                StateId: StateId
            }
        );

    return territories;

};

exports.getTerritories = async ()=>{
        const territories = await customQuery(sql.GET_TERRITORIES());
        return territories;
}