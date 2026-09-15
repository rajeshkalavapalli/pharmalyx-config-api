
const { customQuery } = require('../../utils/dbFunctions')
const sql = require('./sql')

exports.createDivision  = async(finalDivision)=>{
    return await customQuery(sql.CREATE_DIVISION(),finalDivision);
}

exports.getDivisions = async (  )=>{
    return await customQuery(sql.GET_DIVISIONS())
}