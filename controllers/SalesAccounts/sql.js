// Only the MR's own business is counted (orders they booked, audits they did).
// Cancelled orders never count towards value or "last order".

module.exports = {
    // Chemists assigned to the user; @Id narrows to one.
    GET_RETAILERS: () => {
        return `
            SELECT
                ph.PharmacyId AS AccountId,
                ph.PharmacyName AS Name,
                ph.OwnerName,
                ph.ContactNumber,
                ph.EmailId,
                ph.DrugLicenceNumber,
                ph.GSTIN,
                ph.Address,
                t.TerritoryName,
                a.AreaName,
                ISNULL(mo.Orders, 0) AS MonthOrders,
                ISNULL(mo.Value, 0) AS MonthValue,
                ISNULL(lt.Orders, 0) AS TotalOrders,
                ISNULL(lt.Value, 0) AS TotalValue,
                CONVERT(VARCHAR(10), lt.LastOrderDate, 23) AS LastOrderDate,
                CONVERT(VARCHAR(10), lr.LastRcpaDate, 23) AS LastRcpaDate
            FROM dbo.UserPharmacyMapping m
            INNER JOIN dbo.Pharmacy ph ON ph.PharmacyId = m.PharmacyId
            LEFT JOIN Territory t ON t.TerritoryId = ph.TerritoryId
            LEFT JOIN Areas a ON a.AreaId = ph.AreaId
            OUTER APPLY (
                SELECT COUNT(*) AS Orders, SUM(o.NetAmount) AS Value
                FROM dbo.Orders o
                WHERE o.PharmacyId = ph.PharmacyId AND o.UserId = @UserId AND o.Status <> 'CANCELLED'
                  AND o.OrderDate BETWEEN @FromDate AND @ToDate
            ) mo
            OUTER APPLY (
                SELECT COUNT(*) AS Orders, SUM(o.NetAmount) AS Value, MAX(o.OrderDate) AS LastOrderDate
                FROM dbo.Orders o
                WHERE o.PharmacyId = ph.PharmacyId AND o.UserId = @UserId AND o.Status <> 'CANCELLED'
            ) lt
            OUTER APPLY (
                SELECT MAX(r.AuditDate) AS LastRcpaDate
                FROM dbo.RcpaEntries r
                WHERE r.PharmacyId = ph.PharmacyId AND r.UserId = @UserId
            ) lr
            WHERE m.UserId = @UserId
              AND ISNULL(m.IsActive, 'Yes') <> 'No'
              AND ISNULL(ph.IsActive, 'Yes') <> 'No'
              AND (@Id IS NULL OR ph.PharmacyId = @Id)
            ORDER BY ph.PharmacyName
        `;
    },

    // Stockists assigned to the user, with the orders the user routed through them.
    GET_STOCKISTS: () => {
        return `
            SELECT
                s.StockistId AS AccountId,
                s.StockistName AS Name,
                s.OwnerName,
                s.ContactNumber,
                s.EmailId,
                s.DrugLicenceNumber,
                s.GSTIN,
                s.Address,
                t.TerritoryName,
                a.AreaName,
                ISNULL(mo.Orders, 0) AS MonthOrders,
                ISNULL(mo.Value, 0) AS MonthValue,
                ISNULL(lt.Orders, 0) AS TotalOrders,
                ISNULL(lt.Value, 0) AS TotalValue,
                ISNULL(lt.Pending, 0) AS PendingOrders,
                ISNULL(lt.PendingValue, 0) AS PendingValue,
                CONVERT(VARCHAR(10), lt.LastOrderDate, 23) AS LastOrderDate
            FROM dbo.UserStockistMapping m
            INNER JOIN dbo.Stockist s ON s.StockistId = m.StockistId
            LEFT JOIN Territory t ON t.TerritoryId = s.TerritoryId
            LEFT JOIN Areas a ON a.AreaId = s.AreaId
            OUTER APPLY (
                SELECT COUNT(*) AS Orders, SUM(o.NetAmount) AS Value
                FROM dbo.Orders o
                WHERE o.StockistId = s.StockistId AND o.UserId = @UserId AND o.Status <> 'CANCELLED'
                  AND o.OrderDate BETWEEN @FromDate AND @ToDate
            ) mo
            OUTER APPLY (
                SELECT COUNT(*) AS Orders,
                       SUM(o.NetAmount) AS Value,
                       SUM(CASE WHEN o.Status IN ('BOOKED', 'CONFIRMED') THEN 1 ELSE 0 END) AS Pending,
                       SUM(CASE WHEN o.Status IN ('BOOKED', 'CONFIRMED') THEN o.NetAmount ELSE 0 END) AS PendingValue,
                       MAX(o.OrderDate) AS LastOrderDate
                FROM dbo.Orders o
                WHERE o.StockistId = s.StockistId AND o.UserId = @UserId AND o.Status <> 'CANCELLED'
            ) lt
            WHERE m.UserId = @UserId
              AND ISNULL(m.IsActive, 'Yes') <> 'No'
              AND ISNULL(s.IsActive, 'Yes') <> 'No'
              AND (@Id IS NULL OR s.StockistId = @Id)
            ORDER BY s.StockistName
        `;
    },

    // The user's latest orders for one chemist or one stockist.
    GET_RECENT_ORDERS: () => {
        return `
            SELECT TOP 20
                o.OrderId,
                o.OrderNumber,
                CONVERT(VARCHAR(10), o.OrderDate, 23) AS OrderDate,
                o.Status,
                o.CustomerType,
                COALESCE(d.DoctorName, ph.PharmacyName) AS CustomerName,
                s.StockistName,
                o.NetAmount,
                (SELECT COUNT(*) FROM dbo.OrderLines l WHERE l.OrderId = o.OrderId) AS Items
            FROM dbo.Orders o
            LEFT JOIN dbo.Doctor d ON d.DoctorId = o.DoctorId
            LEFT JOIN dbo.Pharmacy ph ON ph.PharmacyId = o.PharmacyId
            LEFT JOIN dbo.Stockist s ON s.StockistId = o.StockistId
            WHERE o.UserId = @UserId
              AND ((@Kind = 'retailer' AND o.PharmacyId = @Id) OR (@Kind = 'stockist' AND o.StockistId = @Id))
            ORDER BY o.OrderDate DESC, o.CreatedOn DESC
        `;
    },
};
