module.exports = {
	DELETE_USER_PHARMACY_MAPPINGS: () => {
		return `
			DELETE FROM dbo.UserPharmacyMapping
			WHERE UserId = @UserId
		`;
	},
	GET_USER_PHARMACY_MAPPINGS: () => {
		return `
			SELECT
				m.UserPharmacyMappingId,
				m.UserId,
				u.UserName,
				u.EmailId,
				d.DivisionName,
				m.PharmacyId,
				p.PharmacyName,
				p.OwnerName,
				p.ContactNumber,
				p.TerritoryId,
				t.TerritoryName,
				p.AreaId,
				a.AreaName
			FROM dbo.UserPharmacyMapping m
			INNER JOIN Users u ON u.UserId = m.UserId
			LEFT JOIN Division d ON d.DivisionId = u.DivisionId
			INNER JOIN dbo.Pharmacy p ON p.PharmacyId = m.PharmacyId
			LEFT JOIN Territory t ON t.TerritoryId = p.TerritoryId
			LEFT JOIN Areas a ON a.AreaId = p.AreaId
			ORDER BY u.UserName, p.PharmacyName
		`;
	},

	CREATE_USER_PHARMACY_MAPPING: () => {
		return `
			INSERT INTO dbo.UserPharmacyMapping (
				UserPharmacyMappingId,
				UserId,
				PharmacyId,
				IsActive,
				CreatedOn,
				ModifiedOn
			)
			VALUES (
				@UserPharmacyMappingId,
				@UserId,
				@PharmacyId,
				'Yes',
				GETDATE(),
				GETDATE()
			)
		`;
	},
	UPDATE_USER_PHARMACY_MAPPING: () => {
		return `
			UPDATE dbo.UserPharmacyMapping
			SET PharmacyId = @PharmacyId,
				ModifiedOn = GETDATE()
			WHERE UserId = @UserId
		`;
	},
	GET_USER_PHARMACY_MAPPING_BY_ID: () => {
		return `
			SELECT
				m.UserPharmacyMappingId,
				m.UserId,
				u.UserName,
				u.EmailId,
				d.DivisionName,
				m.PharmacyId,
				p.PharmacyName,
				p.OwnerName,
				p.ContactNumber,
				p.TerritoryId,
				t.TerritoryName,
				p.AreaId,
				a.AreaName
			FROM dbo.UserPharmacyMapping m
			INNER JOIN Users u ON u.UserId = m.UserId
			LEFT JOIN Division d ON d.DivisionId = u.DivisionId
			INNER JOIN dbo.Pharmacy p ON p.PharmacyId = m.PharmacyId
			LEFT JOIN Territory t ON t.TerritoryId = p.TerritoryId
			LEFT JOIN Areas a ON a.AreaId = p.AreaId
			WHERE m.UserPharmacyMappingId = @UserPharmacyMappingId
		`;
	},
	GET_USER_PHARMACY_MAPPING_BY_USER_ID: () => {
		return `
			SELECT
				m.UserPharmacyMappingId,
				m.UserId,
				u.UserName,
				u.EmailId,
				d.DivisionName,
				m.PharmacyId,
				p.PharmacyName,
				p.OwnerName,
				p.ContactNumber,
				p.TerritoryId,
				t.TerritoryName,
				p.AreaId,
				a.AreaName
			FROM dbo.UserPharmacyMapping m
			INNER JOIN Users u ON u.UserId = m.UserId
			LEFT JOIN Division d ON d.DivisionId = u.DivisionId
			INNER JOIN dbo.Pharmacy p ON p.PharmacyId = m.PharmacyId
			LEFT JOIN Territory t ON t.TerritoryId = p.TerritoryId
			LEFT JOIN Areas a ON a.AreaId = p.AreaId
			WHERE m.UserId = @UserId
		`;
	},
};
