const moment = require('moment/moment')

const sql = require('./sql');

const {customQuery} = require('../../utils/dbFunctions')

exports.getDesignation  = async()=>{ 
    return await customQuery(sql.GET_DESIGNATION())};

exports.getuserDetailsByUserId =  async(userId)=>{
    return await customQuery(sql.GET_USER_DETAILS_BY_USERID(userId)) };

