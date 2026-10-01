module.exports = {
	DELETE_USER_MAPPINGS: () => {
		return `
			DELETE FROM dbo.UserDoctorMapping
			WHERE UserId = @UserId
		`;
	},
	GET_USER_DOCTOR_MAPPINGS: () => {
		return `
			SELECT
				m.UserDoctorMappingId,
				m.UserId,
				u.UserName,
				u.EmailId,
				d.DivisionName,
				m.DoctorId,
				doc.DoctorName,
				doc.Speciality,
				doc.HospitalName,
				doc.TerritoryId,
				t.TerritoryName,
				doc.AreaId,
				a.AreaName
			FROM dbo.UserDoctorMapping m
			INNER JOIN Users u ON u.UserId = m.UserId
			LEFT JOIN Division d ON d.DivisionId = u.DivisionId
			INNER JOIN dbo.Doctor doc ON doc.DoctorId = m.DoctorId
			LEFT JOIN Territory t ON t.TerritoryId = doc.TerritoryId
			LEFT JOIN Areas a ON a.AreaId = doc.AreaId
			ORDER BY u.UserName, doc.DoctorName
		`;
	},

	CREATE_USER_MAPPING: () => {
		return `
			INSERT INTO dbo.UserDoctorMapping (
				UserDoctorMappingId,
				UserId,
				DoctorId,
				CreatedOn,
				ModifiedOn
			)
			VALUES (
				@UserDoctorMappingId,
				@UserId,
				@DoctorId,
				GETDATE(),
				GETDATE()
			)
		`;
	},
	UPDATE_USER_MAPPING: () => {
		return `
			UPDATE dbo.UserDoctorMapping
			SET DoctorId = @DoctorId,
				ModifiedOn = GETDATE()
			WHERE UserId = @UserId
		`;
	},
	GET_USER_DOCTOR_MAPPING_BY_ID: () => {
		return `
			SELECT
				m.UserDoctorMappingId,
				m.UserId,
				u.UserName,
				u.EmailId,
				d.DivisionName,
				m.DoctorId,
				doc.DoctorName,
				doc.Speciality,
				doc.HospitalName,
				doc.TerritoryId,
				t.TerritoryName,
				doc.AreaId,
				a.AreaName
			FROM dbo.UserDoctorMapping m
			INNER JOIN Users u ON u.UserId = m.UserId
			LEFT JOIN Division d ON d.DivisionId = u.DivisionId
			INNER JOIN dbo.Doctor doc ON doc.DoctorId = m.DoctorId
			LEFT JOIN Territory t ON t.TerritoryId = doc.TerritoryId
			LEFT JOIN Areas a ON a.AreaId = doc.AreaId
			WHERE m.UserDoctorMappingId = @UserId
		`;
	},
	GET_USER_DOCTOR_MAPPING_BY_USER_ID: () => {
		return `
			SELECT
				m.UserDoctorMappingId,
				m.UserId,
				u.UserName,
				u.EmailId,
				d.DivisionName,
				m.DoctorId,
				doc.DoctorName,
				doc.Speciality,
				doc.HospitalName,
				doc.TerritoryId,
				t.TerritoryName,
				doc.AreaId,
				a.AreaName
			FROM dbo.UserDoctorMapping m
			INNER JOIN Users u ON u.UserId = m.UserId
			LEFT JOIN Division d ON d.DivisionId = u.DivisionId
			INNER JOIN dbo.Doctor doc ON doc.DoctorId = m.DoctorId
			LEFT JOIN Territory t ON t.TerritoryId = doc.TerritoryId
			LEFT JOIN Areas a ON a.AreaId = doc.AreaId
			WHERE m.UserId = @UserId
		`;
	},
};
