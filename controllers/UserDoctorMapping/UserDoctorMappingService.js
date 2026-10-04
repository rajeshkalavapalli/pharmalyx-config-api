const UserDoctorMappingDA = require('./UserDoctorMappingDA');
const { generateUUID } = require('../../utils/commonUtils');

exports.deleteUserDoctorMappings = async (userId) => {
	return await UserDoctorMappingDA.deleteUserDoctorMappings(userId);
};

exports.getUserDoctorMappings = async () => {
	return await UserDoctorMappingDA.getUserDoctorMappings();
};

exports.createUserDoctorMapping = async (userId, mapping) => {
	const newMapping = {
		UserDoctorMappingId: generateUUID(),
		UserId: userId,
		DoctorId: mapping.doctorId,
	};

	return await UserDoctorMappingDA.createUserDoctorMapping(newMapping);
};

exports.createUserDoctorMappings = async (userId, mappings) => {
	await exports.deleteUserDoctorMappings(userId);

	for (const mapping of mappings) {
		await exports.createUserDoctorMapping(userId, mapping);
	}

	return {
		success: true,
		message: 'User doctor mapping saved successfully',
	};
};

exports.updateUserDoctorMapping = async (mapping) => {
	return await UserDoctorMappingDA.updateUserDoctorMapping(mapping);
};

exports.getUserDoctorMappingById = async (userId) => {
	return await UserDoctorMappingDA.getUserDoctorMappingById(userId);
};

exports.getUserDoctorMappingByUserId = async (userId) => {
	return await UserDoctorMappingDA.getUserDoctorMappingByUserId(userId);
};

exports.deleteUserDoctorMappingByUserId = async (userId) => {
	return await UserDoctorMappingDA.deleteUserDoctorMappings(userId);
};