const UserPharmacyMappingDA = require('./UserPharmacyMappingDA');
const { generateUUID } = require('../../utils/commonUtils');

exports.deleteUserPharmacyMappings = async (userId) => {
	return await UserPharmacyMappingDA.deleteUserPharmacyMappings(userId);
};

exports.getUserPharmacyMappings = async () => {
	return await UserPharmacyMappingDA.getUserPharmacyMappings();
};

exports.createUserPharmacyMapping = async (userId, mapping) => {
	const newMapping = {
		UserPharmacyMappingId: generateUUID(),
		UserId: userId,
		PharmacyId: mapping.pharmacyId,
	};

	return await UserPharmacyMappingDA.createUserPharmacyMapping(newMapping);
};

exports.createUserPharmacyMappings = async (userId, mappings) => {
	await UserPharmacyMappingDA.replaceUserPharmacyMappings(
		userId,
		(mappings || []).filter((mapping) => mapping.pharmacyId).map((mapping) => ({ UserPharmacyMappingId: generateUUID(), UserId: userId, PharmacyId: mapping.pharmacyId }))
	);

	return {
		success: true,
		message: 'User pharmacy mapping saved successfully',
	};
};

exports.updateUserPharmacyMapping = async (mapping) => {
	return await UserPharmacyMappingDA.updateUserPharmacyMapping(mapping);
};

exports.getUserPharmacyMappingById = async (userId) => {
	return await UserPharmacyMappingDA.getUserPharmacyMappingById(userId);
};

exports.getUserPharmacyMappingByUserId = async (userId) => {
	return await UserPharmacyMappingDA.getUserPharmacyMappingByUserId(userId);
};

exports.deleteUserPharmacyMappingByUserId = async (userId) => {
	return await UserPharmacyMappingDA.deleteUserPharmacyMappings(userId);
};