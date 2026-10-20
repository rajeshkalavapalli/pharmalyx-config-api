const UserDoctorMappingDA = require('./UserDoctorMappingDA');
const { generateUUID } = require('../../utils/commonUtils');
const { customQuery } = require('../../utils/dbFunctions');

// Doctors (from the list) already actively assigned to a different person.
const ASSIGNED_ELSEWHERE = `
    SELECT d.DoctorName, COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.FirstName, ' ', u.LastName))), ''), u.UserName) AS AssignedTo
    FROM dbo.UserDoctorMapping m
    INNER JOIN dbo.Doctor d ON d.DoctorId = m.DoctorId
    INNER JOIN Users u ON u.UserId = m.UserId
    WHERE m.UserId <> @UserId AND ISNULL(m.IsActive, 'Yes') <> 'No'
      AND m.DoctorId IN (SELECT TRY_CONVERT(UNIQUEIDENTIFIER, value) FROM OPENJSON(@DoctorIds))
`;

// Doctors (from the list) still waiting for approval or rejected, not already assigned to this person.
// An MR's new doctor is assigned to them when their manager approves it.
const NOT_APPROVED = `
    SELECT d.DoctorName, d.ApprovalStatus
    FROM dbo.Doctor d
    WHERE d.DoctorId IN (SELECT TRY_CONVERT(UNIQUEIDENTIFIER, value) FROM OPENJSON(@DoctorIds))
      AND ISNULL(d.ApprovalStatus, 'APPROVED') <> 'APPROVED'
      AND NOT EXISTS (SELECT 1 FROM dbo.UserDoctorMapping m
                      WHERE m.DoctorId = d.DoctorId AND m.UserId = @UserId AND ISNULL(m.IsActive, 'Yes') <> 'No')
`;

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
	const doctorIds = (mappings || []).map((mapping) => mapping.doctorId).filter(Boolean);
	if (doctorIds.length) {
		const waiting = await customQuery(NOT_APPROVED, { UserId: userId, DoctorIds: JSON.stringify(doctorIds) });
		if (waiting.length) {
			const error = new Error(
				`Only approved doctors can be assigned. Not approved: ${waiting.slice(0, 5).map((row) => `${row.DoctorName} (${String(row.ApprovalStatus).toLowerCase()})`).join(', ')}${waiting.length > 5 ? '…' : ''}.`
			);
			error.statusCode = 409;
			throw error;
		}

		const taken = await customQuery(ASSIGNED_ELSEWHERE, { UserId: userId, DoctorIds: JSON.stringify(doctorIds) });
		if (taken.length) {
			const error = new Error(
				`Each doctor can be assigned to only one MR. Already assigned: ${taken.slice(0, 5).map((row) => `${row.DoctorName} (${row.AssignedTo})`).join(', ')}${taken.length > 5 ? '…' : ''}.`
			);
			error.statusCode = 409;
			throw error;
		}
	}

	await UserDoctorMappingDA.replaceUserDoctorMappings(
		userId,
		(mappings || []).map((mapping) => ({ UserDoctorMappingId: generateUUID(), UserId: userId, DoctorId: mapping.doctorId }))
	);

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