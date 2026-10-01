
const { customQuery } = require('../../utils/dbFunctions')
const sql = require('./sql')

exports.createDivision  = async(finalDivision)=>{
    return await customQuery(sql.CREATE_DIVISION(),finalDivision);
}

exports.getDivisions = async (  )=>{
    return await customQuery(sql.GET_DIVISIONS())
}

exports.getDivisionById = async (divisionId)=>{
    return await customQuery(sql.GET_DIVISION_BY_ID(), { DivisionId: divisionId });
}

exports.updateDivision = async (divisionId, updatedDivision)=>{
    return await customQuery(sql.UPDATE_DIVISION(), { DivisionId: divisionId, ...updatedDivision });
}

exports.deleteDivision = async (divisionId)=>{
    return await customQuery(sql.DELETE_DIVISION(), { DivisionId: divisionId });
}