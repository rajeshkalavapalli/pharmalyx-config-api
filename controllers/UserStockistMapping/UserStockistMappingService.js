const UserStockistMappingDA = require('./UserStockistMappingDA');
const { generateUUID } = require('../../utils/commonUtils');

exports.deleteUserStockistMappings = async (userId) => {
	return await UserStockistMappingDA.deleteUserStockistMappings(userId);
};

exports.getUserStockistMappings = async () => {
	return await UserStockistMappingDA.getUserStockistMappings();
};

exports.createUserStockistMapping = async (userId, mapping) => {
	const newMapping = {
		UserStockistMappingId: generateUUID(),
		UserId: userId,
		StockistId: mapping.stockistId,
	};

	return await UserStockistMappingDA.createUserStockistMapping(newMapping);
};

exports.createUserStockistMappings = async (userId, mappings) => {
	await exports.deleteUserStockistMappings(userId);

	for (const mapping of mappings) {
		await exports.createUserStockistMapping(userId, mapping);
	}

	return {
		success: true,
		message: 'User stockist mapping saved successfully',
	};
};

exports.updateUserStockistMapping = async (mapping) => {
	return await UserStockistMappingDA.updateUserStockistMapping(mapping);
};

exports.getUserStockistMappingById = async (userId) => {
	return await UserStockistMappingDA.getUserStockistMappingById(userId);
};

exports.getUserStockistMappingByUserId = async (userId) => {
	return await UserStockistMappingDA.getUserStockistMappingByUserId(userId);
};

exports.deleteUserStockistMappingByUserId = async (userId) => {
	return await UserStockistMappingDA.deleteUserStockistMappings(userId);
};