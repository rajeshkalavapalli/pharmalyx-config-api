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
