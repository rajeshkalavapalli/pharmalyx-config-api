const sql = require('./sql')

const { customQuery } = require('../../utils/dbFunctions')

exports.createDoctor = async (newDoctor) => {
    return await customQuery(sql.CREATE_DOCTOR(), newDoctor);
}

exports.getDoctors = async (scope = null) => {
    return await customQuery(sql.GET_DOCTORS(Boolean(scope)), scope || {});
}

exports.getDoctorById = async (doctorId) => {
    return await customQuery(sql.GET_DOCTOR_BY_ID(), { DoctorId: doctorId });
}

exports.updateDoctor = async (doctorId, DoctorUpdate) => {
    return await customQuery(sql.UPDATE_DOCTOR(),
     {...DoctorUpdate, DoctorId: doctorId});
}

exports.deactivateDoctor = async (doctorId) => {
    return await customQuery(sql.DEACTIVATE_DOCTOR(), { DoctorId: doctorId });
}

exports.isDoctorInScope = async (DoctorId, ActingUserId) =>
    (await customQuery(sql.DOCTOR_IN_SCOPE(), { DoctorId, ActingUserId, ViewAll: 0 })).length > 0;
