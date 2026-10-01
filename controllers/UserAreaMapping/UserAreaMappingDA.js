const { customQuery } = require('../../utils/dbFunctions');
const sql = require('./Sql');

exports.deleteUserAreaMappings = async (userId) => {
	return await customQuery(
		sql.DELETE_USER_MAPPINGS(),
		{ UserId: userId }
	);
};

exports.getUserAreaMappings = async () => {
	return await customQuery(sql.GET_USER_AREA_MAPPINGS());
};

exports.createUserAreaMapping = async (mapping) => {
	return await customQuery(
		sql.CREATE_USER_MAPPING(),
		mapping
	);
};

exports.updateUserAreaMapping = async (userId, mappings) => {
	return await customQuery(
		sql.UPDATE_USER_MAPPING(),
		{ UserId: userId, Mappings: mappings }
	);
};

exports.getUserAreaMappingById = async (userId) => {
	return await customQuery(
		sql.GET_USER_MAPPING_BY_ID(),
		{ UserId: userId }
	);
};	

exports.getUserAreaMappingByUserId = async (userId) => {
	return await customQuery(
		sql.GET_USER_MAPPING_BY_USER_ID(),
		{ UserId: userId }
	);
};

exports.deleteUserAreaMapping = async (userId) => {
	return await customQuery(
		sql.DELETE_USER_MAPPING(),
		{ UserId: userId }
	);
};