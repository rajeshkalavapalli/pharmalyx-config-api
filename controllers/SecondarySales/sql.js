const STATEMENT_COLUMNS = `
    st.StatementId,
    st.StockistId,
    s.StockistName,
    CONVERT(VARCHAR(10), st.StatementMonth, 23) AS StatementMonth,
    st.UserId,
    COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.FirstName, ' ', u.LastName))), ''), u.UserName) AS UserName,
    u.ManagerId,
    st.Status,
    st.TotalSalesQty,
    st.SalesValue,
    st.ClosingValue,
    st.Remarks,
    st.ReviewRemarks,
    st.SubmittedOn,
    st.ReviewedOn,
    st.ModifiedOn
`;

const STATEMENT_JOINS = `
    FROM dbo.SecondaryStatements st
    INNER JOIN Users u ON u.UserId = st.UserId
    LEFT JOIN dbo.Stockist s ON s.StockistId = st.StockistId
`;

// Stockists assigned to the user (@StockistId narrows to one).
const MY_STOCKISTS = `
    SELECT s.StockistId, s.StockistName, a.AreaName
    FROM dbo.UserStockistMapping m
    INNER JOIN dbo.Stockist s ON s.StockistId = m.StockistId
    LEFT JOIN Areas a ON a.AreaId = s.AreaId
    WHERE m.UserId = @UserId
      AND ISNULL(m.IsActive, 'Yes') <> 'No'
      AND ISNULL(s.IsActive, 'Yes') <> 'No'
      AND (@StockistId IS NULL OR s.StockistId = @StockistId)
`;

// Latest submitted or approved statement per assigned stockist (the stock position).
const LATEST_STATEMENT = `
    OUTER APPLY (
        SELECT TOP 1 x.StatementId, x.StatementMonth, x.Status, x.ClosingValue, x.SalesValue
        FROM dbo.SecondaryStatements x
        WHERE x.StockistId = ms.StockistId AND x.Status IN ('SUBMITTED', 'APPROVED')
        ORDER BY x.StatementMonth DESC
    ) ls
`;

module.exports = {
    GET_MY_STOCKISTS: () => `${MY_STOCKISTS} ORDER BY s.StockistName`,

    // This month's statement (by whoever prepares it) for each assigned stockist.
    GET_MONTH_STATEMENTS: () => {
        return `
            SELECT ${STATEMENT_COLUMNS}
            ${STATEMENT_JOINS}
            WHERE st.StatementMonth = @Month
              AND st.StockistId IN (SELECT ms.StockistId FROM (${MY_STOCKISTS}) ms)
        `;
    },

    GET_STATEMENT_BY_KEY: () => {
        return `
            SELECT ${STATEMENT_COLUMNS}
            ${STATEMENT_JOINS}
            WHERE st.StockistId = @StockistId AND st.StatementMonth = @Month
        `;
    },

    GET_STATEMENT_BY_ID: () => {
        return `
            SELECT ${STATEMENT_COLUMNS}
            ${STATEMENT_JOINS}
            WHERE st.StatementId = @StatementId
        `;
    },

    GET_LINES: () => {
        return `
            SELECT l.LineId, l.StatementId, l.ProductId, p.ProductName, p.PackSize,
                   l.OpeningQty, l.ReceiptQty, l.SalesQty, l.ReturnQty, l.ClosingQty,
                   l.UnitPrice, l.SalesValue, l.ClosingValue
            FROM dbo.SecondaryStatementLines l
            INNER JOIN dbo.Products p ON p.ProductId = l.ProductId
            WHERE l.StatementId = @StatementId
            ORDER BY p.ProductName
        `;
    },

    GET_PRICED_PRODUCTS: () => {
        return `
            SELECT ProductId, ProductName, PackSize, UnitPrice
            FROM dbo.Products
            WHERE IsActive = 1 AND UnitPrice IS NOT NULL AND UnitPrice > 0
            ORDER BY ProductName
        `;
    },

    INSERT_STATEMENT: () => {
        return `
            INSERT INTO dbo.SecondaryStatements (StatementId, StockistId, StatementMonth, UserId, Status, TotalSalesQty, SalesValue,
                                                 ClosingValue, Remarks, SubmittedOn, CreatedOn, ModifiedOn)
            VALUES (@StatementId, @StockistId, @Month, @UserId, @Status, @TotalSalesQty, @SalesValue,
                    @ClosingValue, @Remarks, @SubmittedOn, @Now, @Now)
        `;
    },

    // Only a draft or returned statement of this MR can change; otherwise the whole save rolls back.
    UPDATE_STATEMENT: () => {
        return `
            UPDATE dbo.SecondaryStatements
            SET Status = @Status, TotalSalesQty = @TotalSalesQty, SalesValue = @SalesValue, ClosingValue = @ClosingValue,
                Remarks = @Remarks, SubmittedOn = @SubmittedOn, ModifiedOn = @Now
            WHERE StatementId = @StatementId AND UserId = @UserId AND Status IN ('DRAFT', 'RETURNED');

            IF @@ROWCOUNT = 0 THROW 50001, 'STATEMENT_LOCKED', 1;
        `;
    },

    DELETE_LINES: () => `DELETE FROM dbo.SecondaryStatementLines WHERE StatementId = @StatementId`,

    INSERT_LINE: () => {
        return `
            INSERT INTO dbo.SecondaryStatementLines (LineId, StatementId, ProductId, OpeningQty, ReceiptQty, SalesQty, ReturnQty,
                                                     ClosingQty, UnitPrice, SalesValue, ClosingValue)
            VALUES (@LineId, @StatementId, @ProductId, @OpeningQty, @ReceiptQty, @SalesQty, @ReturnQty,
                    @ClosingQty, @UnitPrice, @SalesValue, @ClosingValue)
        `;
    },

    REVIEW_STATEMENT: () => {
        return `
            UPDATE dbo.SecondaryStatements
            SET Status = @Status, ReviewRemarks = @ReviewRemarks, ReviewedBy = @ReviewedBy, ReviewedOn = @Now, ModifiedOn = @Now
            WHERE StatementId = @StatementId AND Status = 'SUBMITTED'
        `;
    },

    // Submitted statements from the manager's direct reports.
    GET_REVIEWS: () => {
        return `
            SELECT ${STATEMENT_COLUMNS}
            ${STATEMENT_JOINS}
            WHERE u.ManagerId = @UserId AND st.Status = 'SUBMITTED'
            ORDER BY st.SubmittedOn
        `;
    },

    HAS_TEAM: () => `SELECT TOP 1 1 AS Found FROM Users WHERE ManagerId = @UserId`,

    GET_STOCK: () => {
        return `
            SELECT ms.StockistId, ms.StockistName, ms.AreaName,
                   ls.StatementId, CONVERT(VARCHAR(10), ls.StatementMonth, 23) AS StatementMonth, ls.Status,
                   ls.ClosingValue, ls.SalesValue
            FROM (${MY_STOCKISTS}) ms
            ${LATEST_STATEMENT}
            ORDER BY ms.StockistName
        `;
    },

    GET_STOCK_LINES: () => {
        return `
            SELECT l.StatementId, l.ProductId, p.ProductName, p.PackSize,
                   l.OpeningQty, l.ReceiptQty, l.SalesQty, l.ReturnQty, l.ClosingQty, l.ClosingValue
            FROM (${MY_STOCKISTS}) ms
            ${LATEST_STATEMENT}
            INNER JOIN dbo.SecondaryStatementLines l ON l.StatementId = ls.StatementId
            INNER JOIN dbo.Products p ON p.ProductId = l.ProductId
            ORDER BY p.ProductName
        `;
    },
};
