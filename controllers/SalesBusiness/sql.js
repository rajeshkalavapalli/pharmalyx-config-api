// Whose business: the user's own (scope self) or their direct reports' (scope team).
const OWNER = (alias) => `
    ((@Scope = 'self' AND ${alias}.UserId = @UserId) OR (@Scope = 'team' AND u.ManagerId = @UserId))
`;

// Cancelled orders never count; only submitted or approved statements count.
const LIVE_ORDERS = `
    FROM dbo.Orders o
    INNER JOIN Users u ON u.UserId = o.UserId
    WHERE ${OWNER('o')} AND o.Status <> 'CANCELLED'
`;

const FINAL_STATEMENTS = `
    FROM dbo.SecondaryStatements st
    INNER JOIN Users u ON u.UserId = st.UserId
    WHERE ${OWNER('st')} AND st.Status IN ('SUBMITTED', 'APPROVED')
`;

module.exports = {
    // POB per month over the trend window (@FromDate .. @ToDate).
    POB_TREND: () => {
        return `
            SELECT CONVERT(VARCHAR(10), DATEFROMPARTS(YEAR(o.OrderDate), MONTH(o.OrderDate), 1), 23) AS Month,
                   COUNT(*) AS Orders,
                   SUM(o.NetAmount) AS Value,
                   SUM(CASE WHEN o.Status = 'SUPPLIED' THEN o.NetAmount ELSE 0 END) AS SuppliedValue
            ${LIVE_ORDERS}
              AND o.OrderDate BETWEEN @FromDate AND @ToDate
            GROUP BY DATEFROMPARTS(YEAR(o.OrderDate), MONTH(o.OrderDate), 1)
        `;
    },

    SECONDARY_TREND: () => {
        return `
            SELECT CONVERT(VARCHAR(10), st.StatementMonth, 23) AS Month,
                   COUNT(*) AS Statements,
                   SUM(st.TotalSalesQty) AS SalesQty,
                   SUM(st.SalesValue) AS Value,
                   SUM(st.ClosingValue) AS ClosingValue
            ${FINAL_STATEMENTS}
              AND st.StatementMonth BETWEEN @FromDate AND @MonthStart
            GROUP BY st.StatementMonth
        `;
    },

    // ---------- The selected month (@MonthStart .. @ToDate) ----------

    POB_PRODUCTS: () => {
        return `
            SELECT l.ProductId, p.ProductName, SUM(l.Quantity) AS Qty, SUM(l.FreeQuantity) AS FreeQty, SUM(l.NetAmount) AS Value
            FROM dbo.OrderLines l
            INNER JOIN dbo.Orders o ON o.OrderId = l.OrderId
            INNER JOIN Users u ON u.UserId = o.UserId
            INNER JOIN dbo.Products p ON p.ProductId = l.ProductId
            WHERE ${OWNER('o')} AND o.Status <> 'CANCELLED'
              AND o.OrderDate BETWEEN @MonthStart AND @ToDate
            GROUP BY l.ProductId, p.ProductName
        `;
    },

    SECONDARY_PRODUCTS: () => {
        return `
            SELECT l.ProductId, p.ProductName, SUM(l.SalesQty) AS Qty, SUM(l.SalesValue) AS Value,
                   SUM(l.ClosingQty) AS ClosingQty, SUM(l.ClosingValue) AS ClosingValue
            FROM dbo.SecondaryStatementLines l
            INNER JOIN dbo.SecondaryStatements st ON st.StatementId = l.StatementId
            INNER JOIN Users u ON u.UserId = st.UserId
            INNER JOIN dbo.Products p ON p.ProductId = l.ProductId
            WHERE ${OWNER('st')} AND st.Status IN ('SUBMITTED', 'APPROVED')
              AND st.StatementMonth = @MonthStart
            GROUP BY l.ProductId, p.ProductName
        `;
    },

    POB_STOCKISTS: () => {
        return `
            SELECT o.StockistId, s.StockistName, COUNT(*) AS Orders, SUM(o.NetAmount) AS Value
            FROM dbo.Orders o
            INNER JOIN Users u ON u.UserId = o.UserId
            LEFT JOIN dbo.Stockist s ON s.StockistId = o.StockistId
            WHERE ${OWNER('o')} AND o.Status <> 'CANCELLED'
              AND o.OrderDate BETWEEN @MonthStart AND @ToDate
            GROUP BY o.StockistId, s.StockistName
        `;
    },

    SECONDARY_STOCKISTS: () => {
        return `
            SELECT st.StockistId, s.StockistName, SUM(st.SalesValue) AS Value, SUM(st.ClosingValue) AS ClosingValue, SUM(st.TotalSalesQty) AS SalesQty
            FROM dbo.SecondaryStatements st
            INNER JOIN Users u ON u.UserId = st.UserId
            LEFT JOIN dbo.Stockist s ON s.StockistId = st.StockistId
            WHERE ${OWNER('st')} AND st.Status IN ('SUBMITTED', 'APPROVED')
              AND st.StatementMonth = @MonthStart
            GROUP BY st.StockistId, s.StockistName
        `;
    },

    TOP_CUSTOMERS: () => {
        return `
            SELECT TOP 8
                o.CustomerType,
                COALESCE(o.DoctorId, o.PharmacyId) AS CustomerId,
                COALESCE(d.DoctorName, ph.PharmacyName) AS CustomerName,
                COUNT(*) AS Orders,
                SUM(o.NetAmount) AS Value
            FROM dbo.Orders o
            INNER JOIN Users u ON u.UserId = o.UserId
            LEFT JOIN dbo.Doctor d ON d.DoctorId = o.DoctorId
            LEFT JOIN dbo.Pharmacy ph ON ph.PharmacyId = o.PharmacyId
            WHERE ${OWNER('o')} AND o.Status <> 'CANCELLED'
              AND o.OrderDate BETWEEN @MonthStart AND @ToDate
            GROUP BY o.CustomerType, COALESCE(o.DoctorId, o.PharmacyId), COALESCE(d.DoctorName, ph.PharmacyName)
            ORDER BY SUM(o.NetAmount) DESC
        `;
    },

    HAS_TEAM: () => `SELECT TOP 1 1 AS Found FROM Users WHERE ManagerId = @UserId`,
};
