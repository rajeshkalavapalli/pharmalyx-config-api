module.exports = {
    GET_PRODUCTS: () => {
        return `
            SELECT ProductId, ProductName, Composition, PackSize, Therapy, UnitPrice,
                   CAST(IsSample AS BIT) AS IsSample, CAST(IsActive AS BIT) AS IsActive, CreatedOn
            FROM dbo.Products
            WHERE (@ActiveOnly = 0 OR IsActive = 1)
            ORDER BY IsActive DESC, ProductName
        `;
    },

    FIND_PRODUCT_BY_NAME: () => {
        return `
            SELECT ProductId FROM dbo.Products
            WHERE ProductName = @ProductName AND (@ProductId IS NULL OR ProductId <> @ProductId)
        `;
    },

    CREATE_PRODUCT: () => {
        return `
            INSERT INTO dbo.Products (ProductId, ProductName, Composition, PackSize, Therapy, UnitPrice, IsSample, IsActive, CreatedOn)
            VALUES (@ProductId, @ProductName, @Composition, @PackSize, @Therapy, @UnitPrice, @IsSample, @IsActive, @Now)
        `;
    },

    UPDATE_PRODUCT: () => {
        return `
            UPDATE dbo.Products
            SET ProductName = @ProductName, Composition = @Composition, PackSize = @PackSize,
                Therapy = @Therapy, UnitPrice = @UnitPrice, IsSample = @IsSample,
                IsActive = @IsActive, ModifiedOn = @Now
            WHERE ProductId = @ProductId
        `;
    },

    GET_GIFTS: () => {
        return `
            SELECT GiftId, GiftName, Description, UnitValue, CAST(IsActive AS BIT) AS IsActive, CreatedOn
            FROM dbo.Gifts
            WHERE (@ActiveOnly = 0 OR IsActive = 1)
            ORDER BY IsActive DESC, GiftName
        `;
    },

    FIND_GIFT_BY_NAME: () => {
        return `
            SELECT GiftId FROM dbo.Gifts
            WHERE GiftName = @GiftName AND (@GiftId IS NULL OR GiftId <> @GiftId)
        `;
    },

    CREATE_GIFT: () => {
        return `
            INSERT INTO dbo.Gifts (GiftId, GiftName, Description, UnitValue, IsActive, CreatedOn)
            VALUES (@GiftId, @GiftName, @Description, @UnitValue, @IsActive, @Now)
        `;
    },

    UPDATE_GIFT: () => {
        return `
            UPDATE dbo.Gifts
            SET GiftName = @GiftName, Description = @Description, UnitValue = @UnitValue,
                IsActive = @IsActive, ModifiedOn = @Now
            WHERE GiftId = @GiftId
        `;
    },
};
