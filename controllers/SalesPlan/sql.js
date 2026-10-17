module.exports = {
    GET_TARGETS: () => {
        return `
            SELECT t.ProductId, p.ProductName, p.PackSize, t.TargetQty, t.UnitPrice, t.TargetValue, t.ModifiedOn,
                   COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(sb.FirstName, ' ', sb.LastName))), ''), sb.UserName) AS SetByName
            FROM dbo.SalesTargets t
            INNER JOIN dbo.Products p ON p.ProductId = t.ProductId
            LEFT JOIN Users sb ON sb.UserId = t.SetBy
            WHERE t.UserId = @UserId AND t.TargetMonth = @Month
        `;
    },

    // Secondary sales from the MR's submitted / approved stockist statements for the month.
    GET_SECONDARY: () => {
        return `
            SELECT l.ProductId, p.ProductName, SUM(l.SalesQty) AS Qty, SUM(l.SalesValue) AS Value
            FROM dbo.SecondaryStatementLines l
            INNER JOIN dbo.SecondaryStatements st ON st.StatementId = l.StatementId
            INNER JOIN dbo.Products p ON p.ProductId = l.ProductId
            WHERE st.UserId = @UserId AND st.StatementMonth = @Month AND st.Status IN ('SUBMITTED', 'APPROVED')
            GROUP BY l.ProductId, p.ProductName
        `;
    },

    // POB the MR booked in the month that has been supplied.
    GET_POB_SUPPLIED: () => {
        return `
            SELECT l.ProductId, p.ProductName, SUM(l.Quantity) AS Qty, SUM(l.NetAmount) AS Value
            FROM dbo.OrderLines l
            INNER JOIN dbo.Orders o ON o.OrderId = l.OrderId
            INNER JOIN dbo.Products p ON p.ProductId = l.ProductId
            WHERE o.UserId = @UserId AND o.Status = 'SUPPLIED' AND o.OrderDate BETWEEN @Month AND @MonthEnd
            GROUP BY l.ProductId, p.ProductName
        `;
    },

    GET_PRICED_PRODUCTS: () => {
        return `
            SELECT ProductId, ProductName, PackSize, Therapy, UnitPrice
            FROM dbo.Products
            WHERE IsActive = 1 AND UnitPrice IS NOT NULL AND UnitPrice > 0
            ORDER BY ProductName
        `;
    },

    // Direct reports with their month totals.
    GET_TEAM: () => {
        return `
            SELECT
                u.UserId,
                COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.FirstName, ' ', u.LastName))), ''), u.UserName) AS Name,
                sld.SystemLovDetailName AS DesignationName,
                ISNULL(t.TargetValue, 0) AS TargetValue,
                ISNULL(t.Products, 0) AS TargetProducts,
                ISNULL(sec.Value, 0) AS SecondaryValue,
                ISNULL(pob.Value, 0) AS PobSuppliedValue
            FROM Users u
            LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = u.DesignationId
            OUTER APPLY (
                SELECT SUM(x.TargetValue) AS TargetValue, COUNT(*) AS Products
                FROM dbo.SalesTargets x WHERE x.UserId = u.UserId AND x.TargetMonth = @Month
            ) t
            OUTER APPLY (
                SELECT SUM(st.SalesValue) AS Value
                FROM dbo.SecondaryStatements st
                WHERE st.UserId = u.UserId AND st.StatementMonth = @Month AND st.Status IN ('SUBMITTED', 'APPROVED')
            ) sec
            OUTER APPLY (
                SELECT SUM(o.NetAmount) AS Value
                FROM dbo.Orders o
                WHERE o.UserId = u.UserId AND o.Status = 'SUPPLIED' AND o.OrderDate BETWEEN @Month AND @MonthEnd
            ) pob
            WHERE u.ManagerId = @UserId AND ISNULL(u.IsActive, 1) = 1
            ORDER BY Name
        `;
    },

    GET_USER: () => {
        return `
            SELECT u.UserId, u.ManagerId,
                   COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.FirstName, ' ', u.LastName))), ''), u.UserName) AS Name
            FROM Users u WHERE u.UserId = @UserId
        `;
    },

    DELETE_TARGETS: () => `DELETE FROM dbo.SalesTargets WHERE UserId = @UserId AND TargetMonth = @Month`,

    INSERT_TARGET: () => {
        return `
            INSERT INTO dbo.SalesTargets (TargetId, UserId, TargetMonth, ProductId, TargetQty, UnitPrice, TargetValue, SetBy, ModifiedOn)
            VALUES (@TargetId, @UserId, @Month, @ProductId, @TargetQty, @UnitPrice, @TargetValue, @SetBy, @Now)
        `;
    },
};
