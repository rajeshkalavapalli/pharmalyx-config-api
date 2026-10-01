const sql = require('./sql')

const { customQuery } = require('../../utils/dbFunctions')

exports.createDoctor = async (newDoctor) => {
    return await customQuery(sql.CREATE_DOCTOR(), newDoctor);
}

exports.getDoctors = async () => {
    return await customQuery(sql.GET_DOCTORS());
}

exports.getDoctorById = async (doctorId) => {
    return await customQuery(sql.GET_DOCTOR_BY_ID(), [doctorId]);
}

exports.updateDoctor = async (doctorId, updatedDoctor) => {
    return await customQuery(sql.UPDATE_DOCTOR(),
     {...updatedDoctor, DoctorId: doctorId});
}

exports.deactivateDoctor = async (doctorId) => {
    return await customQuery(sql.DEACTIVATE_DOCTOR(), { DoctorId: doctorId });
}   