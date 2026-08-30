const moment = require('moment/moment')
const sql = require('./sql');

const {customQuery} = require('../../utils/dbFunctions')

exports.getDesignation  = async()=>{ 
    return await customQuery(sql.GET_DESIGNATION())};


exports.createUser = async (newUser)=>{
    return await customQuery(sql.CREATE_USER(),newUser)
}

exports.getUsers = async ()=>{
    return await customQuery(sql.GET_USERS())
}
