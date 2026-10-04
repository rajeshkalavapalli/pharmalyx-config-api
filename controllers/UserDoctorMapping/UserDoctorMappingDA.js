const { customQuery } = require('../../utils/dbFunctions');
const sql = require('./Sql');

exports.deleteUserDoctorMappings = async (userId) => {
	return await customQuery(
		sql.DELETE_USER_MAPPINGS(),
		{ UserId: userId }
	);
};

exports.getUserDoctorMappings = async () => {
	return await customQuery(sql.GET_USER_DOCTOR_MAPPINGS());
};

exports.createUserDoctorMapping = async (mapping) => {
	return await customQuery(
		sql.CREATE_USER_DOCTOR_MAPPING(),
		mapping
	);
};
exports.updateUserDoctorMapping = async (mapping) => {
	return await customQuery(
		sql.UPDATE_USER_DOCTOR_MAPPING(),
		mapping
	);
};
exports.getUserDoctorMappingById = async (userDoctorMappingId) => {
	return await customQuery(
		sql.GET_USER_DOCTOR_MAPPING_BY_ID(),
		{ UserId: userId }
	);
};

exports.getUserDoctorMappingByUserId = async (userId) => {
	return await customQuery(
		sql.GET_USER_DOCTOR_MAPPING_BY_USER_ID(),
		{ UserId: userId }
	);
};	

