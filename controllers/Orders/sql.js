// Whose orders: the user's own (scope self) or their direct reports' (scope team).
const OWNER_FILTER = `
    ((@Scope = 'self' AND o.UserId = @UserId) OR (@Scope = 'team' AND u.ManagerId = @UserId))
`;

const ORDER_COLUMNS = `
    o.OrderId,
    o.OrderNumber,
    o.UserId,
    COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.FirstName, ' ', u.LastName))), ''), u.UserName) AS UserName,
    CONVERT(VARCHAR(10), o.OrderDate, 23) AS OrderDate,
    o.CustomerType,
    o.DoctorId,
    o.PharmacyId,
    COALESCE(d.DoctorName, ph.PharmacyName) AS CustomerName,
    d.Category AS DoctorCategory,
    o.StockistId,
    s.StockistName,
    o.Status,
    o.TotalQuantity,
    o.TotalFreeQuantity,
    o.GrossAmount,
    o.DiscountAmount,
    o.NetAmount,
    o.Remarks,
    o.StatusRemarks,
    o.CreatedOn,
    o.ConfirmedOn,
    o.SuppliedOn,
    o.CancelledOn,
    CASE WHEN o.SlipStorageKey IS NULL THEN 0 ELSE 1 END AS HasSlip,
    o.DistanceFromChemistM,
    o.BookedLatitude,
    o.BookedLongitude,
    o.FollowUpOn,
    COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(fu.FirstName, ' ', fu.LastName))), ''), fu.UserName) AS FollowUpByName,
    o.VerifiedOn,
    COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(vb.FirstName, ' ', vb.LastName))), ''), vb.UserName) AS VerifiedByName
`;

const ORDER_JOINS = `
    FROM dbo.Orders o
    INNER JOIN Users u ON u.UserId = o.UserId
    LEFT JOIN dbo.Doctor d ON d.DoctorId = o.DoctorId
    LEFT JOIN dbo.Pharmacy ph ON ph.PharmacyId = o.PharmacyId
    LEFT JOIN dbo.Stockist s ON s.StockistId = o.StockistId
    LEFT JOIN Users fu ON fu.UserId = o.FollowUpBy
    LEFT JOIN Users vb ON vb.UserId = o.VerifiedBy
`;

module.exports = {
    // The chemist's location is saved from the first POB booked there (only if not set yet).
    PIN_PHARMACY: () => {
        return `
            UPDATE dbo.Pharmacy SET Latitude = @Latitude, Longitude = @Longitude, GpsAccuracy = @Accuracy, GpsCapturedAt = @Now, GpsCapturedBy = @UserId
            WHERE PharmacyId = @PharmacyId AND Latitude IS NULL
        `;
    },

    // Manager verifies a supplied order (one tap).
    VERIFY_ORDER: () => {
        return `
            UPDATE dbo.Orders SET VerifiedBy = @UserId, VerifiedOn = @Now, ModifiedBy = @UserId, ModifiedOn = @Now
            WHERE OrderId = @OrderId AND Status = 'SUPPLIED' AND VerifiedOn IS NULL
        `;
    },

    // Team orders still Raised after N days: the manager follows them up.
    FOLLOW_UP_DUE: () => {
        return `
            SELECT o.OrderId AS Id, o.OrderNumber, COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(u.FirstName, ' ', u.LastName))), ''), u.UserName) AS UserName,
                   COALESCE(d.DoctorName, ph.PharmacyName) AS CustomerName, o.NetAmount, o.CreatedOn AS SubmittedOn, CONVERT(VARCHAR(10), o.OrderDate, 23) AS OrderDate
            FROM dbo.Orders o
            INNER JOIN Users u ON u.UserId = o.UserId
            LEFT JOIN dbo.Doctor d ON d.DoctorId = o.DoctorId
            LEFT JOIN dbo.Pharmacy ph ON ph.PharmacyId = o.PharmacyId
            WHERE o.Status = 'BOOKED' AND u.ManagerId = @UserId AND o.OrderDate <= DATEADD(DAY, -@Days, CAST(SYSDATETIME() AS DATE))
        `;
    },

    GET_ORDERS: () => {
        return `
            SELECT ${ORDER_COLUMNS}
            ${ORDER_JOINS}
            WHERE ${OWNER_FILTER}
              AND o.OrderDate BETWEEN @FromDate AND @ToDate
            ORDER BY o.OrderDate DESC, o.CreatedOn DESC
        `;
    },

    GET_LINES: () => {
        return `
            SELECT
                l.LineId,
                l.OrderId,
                l.ProductId,
                p.ProductName,
                p.PackSize,
                l.Quantity,
                l.FreeQuantity,
                l.UnitPrice,
                l.DiscountPercent,
                l.GrossAmount,
                l.DiscountAmount,
                l.NetAmount
            FROM dbo.OrderLines l
            INNER JOIN dbo.Orders o ON o.OrderId = l.OrderId
            INNER JOIN Users u ON u.UserId = o.UserId
            INNER JOIN dbo.Products p ON p.ProductId = l.ProductId
            WHERE ${OWNER_FILTER}
              AND o.OrderDate BETWEEN @FromDate AND @ToDate
            ORDER BY p.ProductName
        `;
    },

    GET_ORDER: () => {
        return `
            SELECT ${ORDER_COLUMNS}, u.ManagerId, o.SlipStorageKey, o.SlipContentType
            ${ORDER_JOINS}
            WHERE o.OrderId = @OrderId
        `;
    },

    HAS_TEAM: () => {
        return `SELECT TOP 1 1 AS Found FROM Users WHERE ManagerId = @UserId`;
    },

    // ---------- Options for the booking form (everything mapped to the MR) ----------

    GET_MY_DOCTORS: () => {
        return `
            SELECT d.DoctorId, d.DoctorName, d.Speciality, d.Category, a.AreaName
            FROM dbo.UserDoctorMapping m
            INNER JOIN dbo.Doctor d ON d.DoctorId = m.DoctorId
            LEFT JOIN Areas a ON a.AreaId = TRY_CONVERT(UNIQUEIDENTIFIER, d.AreaId)
            WHERE m.UserId = @UserId
              AND ISNULL(m.IsActive, 'Yes') <> 'No'
              AND ISNULL(d.IsActive, 'Yes') <> 'No'
            ORDER BY d.DoctorName
        `;
    },

    GET_MY_PHARMACIES: () => {
        return `
            SELECT ph.PharmacyId, ph.PharmacyName, a.AreaName, ph.Latitude, ph.Longitude
            FROM dbo.UserPharmacyMapping m
            INNER JOIN dbo.Pharmacy ph ON ph.PharmacyId = m.PharmacyId
            LEFT JOIN Areas a ON a.AreaId = ph.AreaId
            WHERE m.UserId = @UserId
              AND ISNULL(m.IsActive, 'Yes') <> 'No'
              AND ISNULL(ph.IsActive, 'Yes') <> 'No'
            ORDER BY ph.PharmacyName
        `;
    },

    GET_MY_STOCKISTS: () => {
        return `
            SELECT s.StockistId, s.StockistName, a.AreaName, t.TerritoryName
            FROM dbo.UserStockistMapping m
            INNER JOIN dbo.Stockist s ON s.StockistId = m.StockistId
            LEFT JOIN Areas a ON a.AreaId = s.AreaId
            LEFT JOIN Territory t ON t.TerritoryId = s.TerritoryId
            WHERE m.UserId = @UserId
              AND ISNULL(m.IsActive, 'Yes') <> 'No'
              AND ISNULL(s.IsActive, 'Yes') <> 'No'
            ORDER BY s.StockistName
        `;
    },

    // Orderable products: active and priced.
    GET_ORDERABLE_PRODUCTS: () => {
        return `
            SELECT ProductId, ProductName, PackSize, Therapy, UnitPrice
            FROM dbo.Products
            WHERE IsActive = 1 AND UnitPrice IS NOT NULL AND UnitPrice > 0
            ORDER BY ProductName
        `;
    },

    // ---------- Writes ----------

    CREATE_ORDER: () => {
        return `
            DECLARE @Seq BIGINT = NEXT VALUE FOR dbo.OrderNumberSeq;

            INSERT INTO dbo.Orders (OrderId, OrderNumber, UserId, OrderDate, CustomerType, DoctorId, PharmacyId, StockistId,
                                    Status, TotalQuantity, TotalFreeQuantity, GrossAmount, DiscountAmount, NetAmount,
                                    Remarks, CreatedOn, ModifiedBy, ModifiedOn,
                                    SlipStorageKey, SlipContentType, SlipSha256, SlipDHash, BookedLatitude, BookedLongitude, BookedAccuracy, DistanceFromChemistM)
            VALUES (@OrderId, CONCAT('POB-', FORMAT(@Seq, '000000')), @UserId, @OrderDate, @CustomerType, @DoctorId, @PharmacyId, @StockistId,
                    'BOOKED', @TotalQuantity, @TotalFreeQuantity, @GrossAmount, @DiscountAmount, @NetAmount,
                    @Remarks, @Now, @UserId, @Now,
                    @SlipStorageKey, @SlipContentType, @SlipSha256, @SlipDHash, @BookedLatitude, @BookedLongitude, @BookedAccuracy, @DistanceFromChemistM)
        `;
    },

    CREATE_LINE: () => {
        return `
            INSERT INTO dbo.OrderLines (LineId, OrderId, ProductId, Quantity, FreeQuantity, UnitPrice, DiscountPercent,
                                        GrossAmount, DiscountAmount, NetAmount)
            VALUES (@LineId, @OrderId, @ProductId, @Quantity, @FreeQuantity, @UnitPrice, @DiscountPercent,
                    @GrossAmount, @DiscountAmount, @NetAmount)
        `;
    },

    // Guarded on the current status so two people can't move the same order at once.
    UPDATE_STATUS: () => {
        return `
            UPDATE dbo.Orders
            SET Status = @ToStatus,
                StatusRemarks = @StatusRemarks,
                ConfirmedOn = CASE WHEN @ToStatus = 'CONFIRMED' THEN @Now ELSE ConfirmedOn END,
                FollowUpBy  = CASE WHEN @ToStatus = 'CONFIRMED' THEN @ModifiedBy ELSE FollowUpBy END,
                FollowUpOn  = CASE WHEN @ToStatus = 'CONFIRMED' THEN @Now ELSE FollowUpOn END,
                SuppliedOn  = CASE WHEN @ToStatus = 'SUPPLIED'  THEN @Now ELSE SuppliedOn END,
                CancelledOn = CASE WHEN @ToStatus = 'CANCELLED' THEN @Now ELSE CancelledOn END,
                ModifiedBy = @ModifiedBy,
                ModifiedOn = @Now
            WHERE OrderId = @OrderId AND Status = @FromStatus
        `;
    },
};
