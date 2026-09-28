const sql = require('./sql')

const { customQuery } = require('../../utils/dbFunctions')

exports.createDoctor = async (newDoctor) => {
    return await customQuery(sql.CREATE_DOCTOR(), newDoctor);
}

exports.getDoctors = async () => {
    return await customQuery(sql.GET_DOCTORS());
}
