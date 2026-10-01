module.exports = {
	DELETE_USER_MAPPINGS: () => {
		return `
			DELETE FROM UserAreaMapping
			WHERE UserId = @UserId
		`;
	},
	GET_USER_AREA_MAPPINGS: () => {
		return `
			SELECT
				m.UserAreaMappingId,
				m.UserId,
				u.UserName,
				u.EmailId,
				d.DivisionName,
				m.TerritoryId,
				t.TerritoryName,
				m.AreaId,
				a.AreaName,
				a.AreaCode
			FROM UserAreaMapping m
			INNER JOIN Users u ON u.UserId = m.UserId
			LEFT JOIN Division d ON d.DivisionId = u.DivisionId
			INNER JOIN Territory t ON t.TerritoryId = m.TerritoryId
			INNER JOIN Areas a ON a.AreaId = m.AreaId
			ORDER BY u.UserName, t.TerritoryName, a.AreaName
		`;
	},

	CREATE_USER_MAPPING: () => {
		return `
			INSERT INTO UserAreaMapping (
				UserAreaMappingId,
				UserId,
				TerritoryId,
				AreaId,
				CreatedOn,
				ModifiedOn
			)
			VALUES (
				@UserAreaMappingId,
				@UserId,
				@TerritoryId,
				@AreaId,
				GETDATE(),
				GETDATE()
			)
		`;
	},
	UPDATE_USER_MAPPING: () => {
		return `
			UPDATE UserAreaMapping
			SET Mappings = @Mappings,
				ModifiedOn = GETDATE()
			WHERE UserId = @UserId
		`;
	},
	GET_USER_MAPPING_BY_ID: () => {
		return `
			SELECT
				m.UserAreaMappingId,
				m.UserId,
				u.UserName,
				u.EmailId,
				d.DivisionName,
				m.TerritoryId,
				t.TerritoryName,
				m.AreaId,
				a.AreaName,
				a.AreaCode
			FROM UserAreaMapping m
			INNER JOIN Users u ON u.UserId = m.UserId
			LEFT JOIN Division d ON d.DivisionId = u.DivisionId
			INNER JOIN Territory t ON t.TerritoryId = m.TerritoryId
			INNER JOIN Areas a ON a.AreaId = m.AreaId
			WHERE m.UserAreaMappingId = @UserId
		`;
	},
	GET_USER_MAPPING_BY_USER_ID: () => {
		return `
			SELECT
				m.UserAreaMappingId,
				m.UserId,
				u.UserName,
				u.EmailId,
				d.DivisionName,
				m.TerritoryId,
				t.TerritoryName,
				m.AreaId,
				a.AreaName,
				a.AreaCode
			FROM UserAreaMapping m
			INNER JOIN Users u ON u.UserId = m.UserId
			LEFT JOIN Division d ON d.DivisionId = u.DivisionId
			INNER JOIN Territory t ON t.TerritoryId = m.TerritoryId
			INNER JOIN Areas a ON a.AreaId = m.AreaId
			WHERE m.UserId = @UserId
		`;
	},
	DELETE_USER_MAPPING: () => {
		return `
			DELETE FROM UserAreaMapping
			WHERE UserId = @UserId
		`;
	},
};
