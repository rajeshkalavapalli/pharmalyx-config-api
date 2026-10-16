const displayName = (alias) =>
    `COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(${alias}.FirstName, ' ', ${alias}.LastName))), ''), ${alias}.UserName)`;

const ITEM_NAME = `CASE s.ItemType WHEN 'SAMPLE' THEN p.ProductName ELSE g.GiftName END`;

const ITEM_JOINS = `
    LEFT JOIN dbo.Products p ON s.ItemType = 'SAMPLE' AND p.ProductId = s.ItemId
    LEFT JOIN dbo.Gifts g ON s.ItemType = 'GIFT' AND g.GiftId = s.ItemId
`;

module.exports = {
    // Current holding per item, with this month's movement.
    GET_BALANCES: () => {
        return `
            SELECT
                s.ItemType,
                s.ItemId,
                ${ITEM_NAME} AS ItemName,
                CASE s.ItemType WHEN 'SAMPLE' THEN p.PackSize ELSE g.Description END AS ItemDetail,
                SUM(s.Quantity) AS Balance,
                SUM(CASE WHEN s.EntryType = 'ISSUE' THEN s.Quantity ELSE 0 END) AS TotalIssued,
                -SUM(CASE WHEN s.EntryType = 'DISTRIBUTION' THEN s.Quantity ELSE 0 END) AS TotalGiven,
                -SUM(CASE WHEN s.EntryType = 'DISTRIBUTION' AND s.EntryDate >= @MonthStart THEN s.Quantity ELSE 0 END) AS GivenThisMonth,
                MAX(CASE WHEN s.EntryType = 'ISSUE' THEN s.EntryDate END) AS LastIssuedOn
            FROM dbo.EngagementStock s
            ${ITEM_JOINS}
            WHERE s.UserId = @UserId
              AND (@ItemType IS NULL OR s.ItemType = @ItemType)
            GROUP BY s.ItemType, s.ItemId, p.ProductName, p.PackSize, g.GiftName, g.Description
            ORDER BY ItemName
        `;
    },

    GET_LEDGER: () => {
        return `
            SELECT TOP (500)
                s.EntryId,
                s.ItemType,
                s.ItemId,
                ${ITEM_NAME} AS ItemName,
                s.EntryType,
                s.Quantity,
                s.DoctorId,
                d.DoctorName,
                s.VisitId,
                s.BatchNumber,
                s.Remarks,
                CONVERT(VARCHAR(10), s.EntryDate, 23) AS EntryDate,
                ${displayName('cb')} AS CreatedByName,
                s.CreatedOn
            FROM dbo.EngagementStock s
            ${ITEM_JOINS}
            LEFT JOIN dbo.Doctor d ON d.DoctorId = s.DoctorId
            LEFT JOIN Users cb ON cb.UserId = s.CreatedBy
            WHERE s.UserId = @UserId
              AND (@ItemType IS NULL OR s.ItemType = @ItemType)
              AND s.EntryDate BETWEEN @FromDate AND @ToDate
            ORDER BY s.EntryDate DESC, s.CreatedOn DESC
        `;
    },

    // Items given during a visit (for the visit drawer and doctor history).
    GET_VISIT_ITEMS: () => {
        return `
            SELECT s.ItemType, s.ItemId, ${ITEM_NAME} AS ItemName, -s.Quantity AS Quantity
            FROM dbo.EngagementStock s
            ${ITEM_JOINS}
            WHERE s.VisitId = @VisitId AND s.EntryType = 'DISTRIBUTION'
            ORDER BY ItemName
        `;
    },

    ITEM_EXISTS: () => {
        return `
            SELECT 1 AS Found
            WHERE (@ItemType = 'SAMPLE' AND EXISTS (
                      SELECT 1 FROM dbo.Products WHERE ProductId = @ItemId AND IsActive = 1 AND IsSample = 1))
               OR (@ItemType = 'GIFT' AND EXISTS (
                      SELECT 1 FROM dbo.Gifts WHERE GiftId = @ItemId AND IsActive = 1))
        `;
    },

    ADD_ENTRY: () => {
        return `
            INSERT INTO dbo.EngagementStock (
                EntryId, UserId, ItemType, ItemId, EntryType, Quantity, DoctorId, VisitId,
                BatchNumber, Remarks, EntryDate, CreatedBy, CreatedOn
            )
            VALUES (
                @EntryId, @UserId, @ItemType, @ItemId, @EntryType, @Quantity, @DoctorId, @VisitId,
                @BatchNumber, @Remarks, @EntryDate, @CreatedBy, @CreatedOn
            )
        `;
    },

    // Removes stock only if the holder has enough; the check and insert are one statement.
    REMOVE_ENTRY: () => {
        return `
            INSERT INTO dbo.EngagementStock (
                EntryId, UserId, ItemType, ItemId, EntryType, Quantity, DoctorId, VisitId,
                BatchNumber, Remarks, EntryDate, CreatedBy, CreatedOn
            )
            SELECT
                @EntryId, @UserId, @ItemType, @ItemId, @EntryType, -@Quantity, @DoctorId, @VisitId,
                NULL, @Remarks, @EntryDate, @CreatedBy, @CreatedOn
            WHERE (
                SELECT ISNULL(SUM(Quantity), 0)
                FROM dbo.EngagementStock WITH (UPDLOCK, HOLDLOCK)
                WHERE UserId = @UserId AND ItemType = @ItemType AND ItemId = @ItemId
            ) >= @Quantity;

            IF @@ROWCOUNT = 0
                THROW 50021, 'Not enough stock for one of the items.', 1;
        `;
    },
};
