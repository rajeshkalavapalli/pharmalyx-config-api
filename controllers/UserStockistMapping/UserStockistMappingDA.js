const { customQuery, runInTransaction } = require('../../utils/dbFunctions');
const sql = require('./Sql');

exports.deleteUserStockistMappings = async (userId) => {
	return await customQuery(
		sql.DELETE_USER_STOCKIST_MAPPINGS(),
		{ UserId: userId }
	);
};

exports.getUserStockistMappings = async () => {
	return await customQuery(sql.GET_USER_STOCKIST_MAPPINGS());
};

exports.createUserStockistMapping = async (mapping) => {
	return await customQuery(
		sql.CREATE_USER_STOCKIST_MAPPING(),
		mapping
	);
};
exports.updateUserStockistMapping = async (mapping) => {
	return await customQuery(
		sql.UPDATE_USER_STOCKIST_MAPPING(),
		mapping
	);
};
exports.getUserStockistMappingById = async (userStockistMappingId) => {
	return await customQuery(
		sql.GET_USER_STOCKIST_MAPPING_BY_ID(),
		{ UserStockistMappingId: userStockistMappingId }
	);
};

exports.getUserStockistMappingByUserId = async (userId) => {
	return await customQuery(
		sql.GET_USER_STOCKIST_MAPPING_BY_USER_ID(),
		{ UserId: userId }
	);
};	


// Replaces the user's stockist list with this one, all or nothing (a failure keeps the old list).
exports.replaceUserStockistMappings = async (userId, mappings) => {
	return await runInTransaction([
		{ sqlQuery: sql.DELETE_USER_STOCKIST_MAPPINGS(), inputs: { UserId: userId } },
		...mappings.map((inputs) => ({ sqlQuery: sql.CREATE_USER_STOCKIST_MAPPING(), inputs })),
	]);
};
