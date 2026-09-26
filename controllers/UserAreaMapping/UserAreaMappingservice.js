const UserAreaMappingDA = require('./UserAreaMappingDA');
const { generateUUID } = require('../../utils/commonUtils');

exports.deleteUserAreaMappings = async (userId) => {
	return await UserAreaMappingDA.deleteUserAreaMappings(userId);
};

exports.getUserAreaMappings = async () => {
	return await UserAreaMappingDA.getUserAreaMappings();
};

exports.createUserAreaMapping = async (userId, mapping) => {
	const newMapping = {
		UserAreaMappingId: generateUUID(),
		UserId: userId,
		TerritoryId: mapping.territoryId,
		AreaId: mapping.areaId,
	};

	return await UserAreaMappingDA.createUserAreaMapping(newMapping);
};

exports.createUserAreaMappings = async (userId, mappings) => {
	await exports.deleteUserAreaMappings(userId);

	for (const mapping of mappings) {
		await exports.createUserAreaMapping(userId, mapping);
	}

	return {
		success: true,
		message: 'User area mapping saved successfully',
	};
};
