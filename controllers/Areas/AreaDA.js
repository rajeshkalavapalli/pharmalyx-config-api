const sql = require('./sql')

const { customQuery } = require('../../utils/dbFunctions')

exports.createArea  = async(newArea)=>{
    return await customQuery(sql.CREATE_AREA(), newArea);
}

exports.getAreasCode = async()=>{
    return await customQuery(sql.GET_AREA_CODE());
}

exports.getNextAreaSequence = async (TerritoryId) => {
    return await customQuery(sql.GET_NEXT_AREA_SEQUENCE(), { TerritoryId });

}

exports.checkAreaExists = async (TerritoryId, AreaName) => {
    return await customQuery(sql.CHECK_AREA_EXISTS(), { TerritoryId, AreaName });
}

