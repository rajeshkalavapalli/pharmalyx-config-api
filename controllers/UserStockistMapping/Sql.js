module.exports = {
	DELETE_USER_STOCKIST_MAPPINGS: () => {
		return `
			DELETE FROM dbo.UserStockistMapping
			WHERE UserId = @UserId
		`;
	},
	GET_USER_STOCKIST_MAPPINGS: () => {
		return `
			SELECT
				m.UserStockistMappingId,
				m.UserId,
				u.UserName,
				u.EmailId,
				d.DivisionName,
				m.StockistId,
				s.StockistName,
				s.OwnerName,
				s.ContactNumber,
				s.TerritoryId,
				t.TerritoryName,
				s.AreaId,
				a.AreaName
			FROM dbo.UserStockistMapping m
			INNER JOIN Users u ON u.UserId = m.UserId
			LEFT JOIN Division d ON d.DivisionId = u.DivisionId
			INNER JOIN dbo.Stockist s ON s.StockistId = m.StockistId
			LEFT JOIN Territory t ON t.TerritoryId = s.TerritoryId
			LEFT JOIN Areas a ON a.AreaId = s.AreaId
			ORDER BY u.UserName, s.StockistName
		`;
	},

	CREATE_USER_STOCKIST_MAPPING: () => {
		return `
			INSERT INTO dbo.UserStockistMapping (
				UserStockistMappingId,
				UserId,
				StockistId,
				IsActive,
				CreatedOn,
				ModifiedOn
			)
			VALUES (
				@UserStockistMappingId,
				@UserId,
				@StockistId,
				'Yes',
				GETDATE(),
				GETDATE()
			)
		`;
	},
	UPDATE_USER_STOCKIST_MAPPING: () => {
		return `
			UPDATE dbo.UserStockistMapping
			SET StockistId = @StockistId,
				ModifiedOn = GETDATE()
			WHERE UserId = @UserId
		`;
	},
	GET_USER_STOCKIST_MAPPING_BY_ID: () => {
		return `
			SELECT
				m.UserStockistMappingId,
				m.UserId,
				u.UserName,
				u.EmailId,
				d.DivisionName,
				m.StockistId,
				s.StockistName,
				s.OwnerName,
				s.ContactNumber,
				s.TerritoryId,
				t.TerritoryName,
				s.AreaId,
				a.AreaName
			FROM dbo.UserStockistMapping m
			INNER JOIN Users u ON u.UserId = m.UserId
			LEFT JOIN Division d ON d.DivisionId = u.DivisionId
			INNER JOIN dbo.Stockist s ON s.StockistId = m.StockistId
			LEFT JOIN Territory t ON t.TerritoryId = s.TerritoryId
			LEFT JOIN Areas a ON a.AreaId = s.AreaId
			WHERE m.UserStockistMappingId = @UserStockistMappingId
		`;
	},
	GET_USER_STOCKIST_MAPPING_BY_USER_ID: () => {
		return `
			SELECT
				m.UserStockistMappingId,
				m.UserId,
				u.UserName,
				u.EmailId,
				d.DivisionName,
				m.StockistId,
				s.StockistName,
				s.OwnerName,
				s.ContactNumber,
				s.TerritoryId,
				t.TerritoryName,
				s.AreaId,
				a.AreaName
			FROM dbo.UserStockistMapping m
			INNER JOIN Users u ON u.UserId = m.UserId
			LEFT JOIN Division d ON d.DivisionId = u.DivisionId
			INNER JOIN dbo.Stockist s ON s.StockistId = m.StockistId
			LEFT JOIN Territory t ON t.TerritoryId = s.TerritoryId
			LEFT JOIN Areas a ON a.AreaId = s.AreaId
			WHERE m.UserId = @UserId
		`;
	},
};
