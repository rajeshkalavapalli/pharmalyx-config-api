const { customQuery } = require('../../utils/dbFunctions');
const sql = require('./Sql');

exports.deleteUserPharmacyMappings = async (userId) => {
	return await customQuery(
		sql.DELETE_USER_PHARMACY_MAPPINGS(),
		{ UserId: userId }
	);
};

exports.getUserPharmacyMappings = async () => {
	return await customQuery(sql.GET_USER_PHARMACY_MAPPINGS());
};

exports.createUserPharmacyMapping = async (mapping) => {
	return await customQuery(
		sql.CREATE_USER_PHARMACY_MAPPING(),
		mapping
	);
};
exports.updateUserPharmacyMapping = async (mapping) => {
	return await customQuery(
		sql.UPDATE_USER_PHARMACY_MAPPING(),
		mapping
	);
};
exports.getUserPharmacyMappingById = async (userPharmacyMappingId) => {
	return await customQuery(
		sql.GET_USER_PHARMACY_MAPPING_BY_ID(),
		{ UserPharmacyMappingId: userPharmacyMappingId }
	);
};

exports.getUserPharmacyMappingByUserId = async (userId) => {
	return await customQuery(
		sql.GET_USER_PHARMACY_MAPPING_BY_USER_ID(),
		{ UserId: userId }
	);
};	

