const { customQuery, runInTransaction } = require('../../utils/dbFunctions');
const sql = require('./Sql');

exports.deleteUserDoctorMappings = async (userId) => {
	return await customQuery(
		sql.DELETE_USER_DOCTOR_MAPPINGS(),
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
		{ UserDoctorMappingId: userDoctorMappingId }
	);
};

exports.getUserDoctorMappingByUserId = async (userId) => {
	return await customQuery(
		sql.GET_USER_DOCTOR_MAPPING_BY_USER_ID(),
		{ UserId: userId }
	);
};	


// Replaces the user's doctors with this list, all or nothing (a failure keeps the old list).
exports.replaceUserDoctorMappings = async (userId, mappings) => {
	return await runInTransaction([
		{ sqlQuery: sql.DELETE_USER_DOCTOR_MAPPINGS(), inputs: { UserId: userId } },
		...mappings.map((inputs) => ({ sqlQuery: sql.CREATE_USER_DOCTOR_MAPPING(), inputs })),
	]);
};
