const { displayName } = require('../../utils/reportScope');

const LIVE_STOCK = 'l.VoidedOn IS NULL';
const IN_LIST = (column, param) => `${column} IN (SELECT TRY_CONVERT(UNIQUEIDENTIFIER, value) FROM OPENJSON(${param}))`;

module.exports = {
    // ---------------------------------------------------------
    // People and places
    // ---------------------------------------------------------

    USER: () => `SELECT u.UserId, ${displayName('u')} AS Name, u.ManagerId, ISNULL(u.IsActive, 1) AS IsActive FROM Users u WHERE u.UserId = @UserId`,

    ACTIVE_USERS: () => `SELECT u.UserId, ${displayName('u')} AS Name FROM Users u WHERE ISNULL(u.IsActive, 1) = 1 ORDER BY Name`,

    // Chemists assigned to the MR (with location and territory).
    MY_CHEMISTS: () => {
        return `
            SELECT ph.PharmacyId, ph.PharmacyName, ph.TerritoryId, ph.AreaId, ph.Latitude, ph.Longitude
            FROM dbo.UserPharmacyMapping m
            INNER JOIN dbo.Pharmacy ph ON ph.PharmacyId = m.PharmacyId
            WHERE m.UserId = @UserId AND ISNULL(m.IsActive, 'Yes') <> 'No' AND ISNULL(ph.IsActive, 'Yes') <> 'No'
            ORDER BY ph.PharmacyName
        `;
    },

    PHARMACY: () => `SELECT PharmacyId, PharmacyName, TerritoryId, AreaId, Latitude, Longitude FROM dbo.Pharmacy WHERE PharmacyId = @PharmacyId`,

    // Chemists a set of users is responsible for (current assignments).
    CHEMISTS_OF_USERS: () => {
        return `
            SELECT DISTINCT ph.PharmacyId, ph.PharmacyName, ph.TerritoryId
            FROM dbo.UserPharmacyMapping m
            INNER JOIN dbo.Pharmacy ph ON ph.PharmacyId = m.PharmacyId
            WHERE ISNULL(m.IsActive, 'Yes') <> 'No' AND ${IN_LIST('m.UserId', '@Users')}
        `;
    },

    // Head office: every chemist with a ledger, a credit limit, or a current assignment.
    ALL_LEDGER_CHEMISTS: () => {
        return `
            SELECT ph.PharmacyId, ph.PharmacyName, ph.TerritoryId
            FROM dbo.Pharmacy ph
            WHERE ISNULL(ph.IsActive, 'Yes') <> 'No'
               OR EXISTS (SELECT 1 FROM dbo.ChemistLedger c WHERE c.PharmacyId = ph.PharmacyId)
        `;
    },

    // Who looks after each chemist now (for the dues list).
    CHEMIST_OWNERS: () => {
        return `
            SELECT m.PharmacyId, STRING_AGG(${displayName('u')}, ', ') AS Owners
            FROM dbo.UserPharmacyMapping m INNER JOIN Users u ON u.UserId = m.UserId
            WHERE ISNULL(m.IsActive, 'Yes') <> 'No'
            GROUP BY m.PharmacyId
        `;
    },

    // ---------------------------------------------------------
    // MR stock ledger
    // ---------------------------------------------------------

    STOCK_ENTRIES: () => {
        return `
            SELECT TOP 500 l.EntryId, l.EntryType, l.ProductId, p.ProductName, l.BatchId, b.BatchNumber, CONVERT(VARCHAR(10), b.ExpiryDate, 23) AS ExpiryDate,
                   l.Quantity, l.UnitValue, l.Value, CONVERT(VARCHAR(10), l.EntryDate, 23) AS EntryDate, l.DeliveryId, d.DeliveryNumber, ph.PharmacyName,
                   l.Remarks, ${displayName('cb')} AS CreatedByName, l.CreatedOn, l.VoidedOn, l.VoidReason
            FROM dbo.MrStockLedger l
            INNER JOIN dbo.Products p ON p.ProductId = l.ProductId
            INNER JOIN dbo.ProductBatches b ON b.BatchId = l.BatchId
            LEFT JOIN dbo.ChemistDeliveries d ON d.DeliveryId = l.DeliveryId
            LEFT JOIN dbo.Pharmacy ph ON ph.PharmacyId = d.PharmacyId
            LEFT JOIN Users cb ON cb.UserId = l.CreatedBy
            WHERE l.UserId = @UserId
            ORDER BY l.EntryDate DESC, l.CreatedOn DESC
        `;
    },

    // Balance per batch in the MR's hands.
    STOCK_BALANCES: () => {
        return `
            SELECT l.ProductId, p.ProductName, l.BatchId, b.BatchNumber, CONVERT(VARCHAR(10), b.ExpiryDate, 23) AS ExpiryDate,
                   SUM(l.Quantity) AS Quantity, SUM(l.Value) AS Value
            FROM dbo.MrStockLedger l
            INNER JOIN dbo.Products p ON p.ProductId = l.ProductId
            INNER JOIN dbo.ProductBatches b ON b.BatchId = l.BatchId
            WHERE l.UserId = @UserId AND ${LIVE_STOCK}
            GROUP BY l.ProductId, p.ProductName, l.BatchId, b.BatchNumber, b.ExpiryDate
            HAVING SUM(l.Quantity) <> 0
            ORDER BY p.ProductName, b.ExpiryDate
        `;
    },

    // Every live stock entry of MRs who still hold stock (for the holding-age check and overview).
    LOT_ENTRIES: () => {
        return `
            SELECT l.UserId, ${displayName('u')} AS UserName, l.BatchId, b.BatchNumber, p.ProductName, CONVERT(VARCHAR(10), l.EntryDate, 23) AS EntryDate, l.Quantity, l.Value, l.EntryType
            FROM dbo.MrStockLedger l
            INNER JOIN Users u ON u.UserId = l.UserId
            INNER JOIN dbo.ProductBatches b ON b.BatchId = l.BatchId
            INNER JOIN dbo.Products p ON p.ProductId = l.ProductId
            WHERE ${LIVE_STOCK} AND (@UserId IS NULL OR l.UserId = @UserId)
              AND l.UserId IN (SELECT UserId FROM dbo.MrStockLedger WHERE VoidedOn IS NULL GROUP BY UserId HAVING SUM(Quantity) > 0)
        `;
    },

    BATCH: () => `SELECT b.BatchId, b.ProductId, b.BatchNumber, CONVERT(VARCHAR(10), b.ExpiryDate, 23) AS ExpiryDate, p.ProductName FROM dbo.ProductBatches b INNER JOIN dbo.Products p ON p.ProductId = b.ProductId WHERE b.BatchId = @BatchId`,

    // Issue to an MR; refused inside the transaction if it takes the MR over the stock limit.
    INSERT_ISSUE: () => {
        return `
            DECLARE @Held DECIMAL(14, 2) = (SELECT ISNULL(SUM(Value), 0) FROM dbo.MrStockLedger WITH (UPDLOCK, HOLDLOCK) WHERE UserId = @UserId AND VoidedOn IS NULL);
            IF @Held + @Value > @Limit
            BEGIN
                DECLARE @Msg NVARCHAR(300) = CONCAT(N'Not issued: the MR already holds Rs ', FORMAT(@Held, 'N0', 'en-IN'), N' of stock; this issue would take it over the limit of Rs ', FORMAT(@Limit, 'N0', 'en-IN'), N'.');
                THROW 50409, @Msg, 1;
            END
            INSERT INTO dbo.MrStockLedger (EntryId, UserId, ProductId, BatchId, EntryType, Quantity, UnitValue, Value, EntryDate, Remarks, CreatedBy, CreatedOn)
            VALUES (@EntryId, @UserId, @ProductId, @BatchId, 'ISSUE', @Quantity, @UnitValue, @Value, @EntryDate, @Remarks, @ActorId, @Now);
        `;
    },

    // Stock leaving the MR (delivery, return, transfer out); refused if the batch balance is too small.
    INSERT_OUTFLOW: () => {
        return `
            DECLARE @Have INT = (SELECT ISNULL(SUM(Quantity), 0) FROM dbo.MrStockLedger WITH (UPDLOCK, HOLDLOCK) WHERE UserId = @UserId AND BatchId = @BatchId AND VoidedOn IS NULL);
            IF @Have < @Quantity
            BEGIN
                DECLARE @Msg NVARCHAR(300) = CONCAT(N'Only ', @Have, N' of batch ', @BatchNumber, N' is in hand (asked for ', @Quantity, N').');
                THROW 50409, @Msg, 1;
            END
            INSERT INTO dbo.MrStockLedger (EntryId, UserId, ProductId, BatchId, EntryType, Quantity, UnitValue, Value, EntryDate, DeliveryId, ClearanceId, Remarks, CreatedBy, CreatedOn)
            VALUES (@EntryId, @UserId, @ProductId, @BatchId, @EntryType, -@Quantity, @UnitValue, -@Value, @EntryDate, @DeliveryId, @ClearanceId, @Remarks, @ActorId, @Now);
        `;
    },

    INSERT_TRANSFER_IN: () => {
        return `
            INSERT INTO dbo.MrStockLedger (EntryId, UserId, ProductId, BatchId, EntryType, Quantity, UnitValue, Value, EntryDate, ClearanceId, Remarks, CreatedBy, CreatedOn)
            VALUES (@EntryId, @UserId, @ProductId, @BatchId, 'TRANSFER_IN', @Quantity, @UnitValue, @Value, @EntryDate, @ClearanceId, @Remarks, @ActorId, @Now);
        `;
    },

    GET_STOCK_ENTRY: () => `SELECT * FROM dbo.MrStockLedger WHERE EntryId = @EntryId`,

    VOID_STOCK_ENTRY: () => {
        return `
            UPDATE dbo.MrStockLedger SET VoidedBy = @ActorId, VoidedOn = @Now, VoidReason = @Reason
            WHERE EntryId = @EntryId AND VoidedOn IS NULL AND DeliveryId IS NULL AND ClearanceId IS NULL AND EntryType IN ('ISSUE', 'RETURN');
            IF @@ROWCOUNT = 0 THROW 50409, 'This entry cannot be voided here (already voided, or part of a delivery or handover).', 1;
        `;
    },

    // Head office overview: stock value per MR.
    HOLDINGS: () => {
        return `
            SELECT l.UserId, ${displayName('u')} AS Name, SUM(l.Quantity) AS Quantity, SUM(l.Value) AS Value
            FROM dbo.MrStockLedger l INNER JOIN Users u ON u.UserId = l.UserId
            WHERE ${LIVE_STOCK}
            GROUP BY l.UserId, u.FirstName, u.LastName, u.UserName
            HAVING SUM(l.Quantity) <> 0
            ORDER BY Value DESC
        `;
    },

    // ---------------------------------------------------------
    // Direct supply to a chemist
    // ---------------------------------------------------------

    INSERT_DELIVERY: () => {
        return `
            INSERT INTO dbo.ChemistDeliveries (DeliveryId, UserId, PharmacyId, DeliveryDate, TotalValue, ReceiptStorageKey, ReceiptContentType, ReceiptSha256,
                                               Latitude, Longitude, Accuracy, DistanceFromChemistM, Remarks, CreatedOn)
            VALUES (@DeliveryId, @UserId, @PharmacyId, @DeliveryDate, @TotalValue, @ReceiptStorageKey, @ReceiptContentType, @ReceiptSha256,
                    @Latitude, @Longitude, @Accuracy, @DistanceFromChemistM, @Remarks, @Now);
        `;
    },

    INSERT_DELIVERY_LINE: () => {
        return `
            INSERT INTO dbo.ChemistDeliveryLines (LineId, DeliveryId, ProductId, BatchId, Quantity, UnitPrice, Value)
            VALUES (@LineId, @DeliveryId, @ProductId, @BatchId, @Quantity, @UnitPrice, @Value);
        `;
    },

    RECEIPT_REUSED: () => `SELECT TOP 1 DeliveryNumber FROM dbo.ChemistDeliveries WHERE ReceiptSha256 = @Sha AND VoidedOn IS NULL`,

    LIST_DELIVERIES: () => {
        return `
            SELECT TOP 300 d.DeliveryId, d.DeliveryNumber, CONVERT(VARCHAR(10), d.DeliveryDate, 23) AS DeliveryDate, d.UserId, ${displayName('u')} AS UserName,
                   d.PharmacyId, ph.PharmacyName, d.TotalValue, d.DistanceFromChemistM, d.CreatedOn, d.VoidedOn, d.VoidReason,
                   (SELECT STRING_AGG(CONCAT(p.ProductName, ' x', dl.Quantity), ', ') FROM dbo.ChemistDeliveryLines dl INNER JOIN dbo.Products p ON p.ProductId = dl.ProductId WHERE dl.DeliveryId = d.DeliveryId) AS Items
            FROM dbo.ChemistDeliveries d
            INNER JOIN Users u ON u.UserId = d.UserId
            INNER JOIN dbo.Pharmacy ph ON ph.PharmacyId = d.PharmacyId
            WHERE (@UserId IS NULL OR d.UserId = @UserId) AND (@PharmacyId IS NULL OR d.PharmacyId = @PharmacyId)
            ORDER BY d.DeliveryDate DESC, d.CreatedOn DESC
        `;
    },

    GET_DELIVERY: () => {
        return `
            SELECT d.*, u.ManagerId FROM dbo.ChemistDeliveries d INNER JOIN Users u ON u.UserId = d.UserId WHERE d.DeliveryId = @DeliveryId
        `;
    },

    // Head office void of a wrong delivery: the stock goes back to the MR and the due is removed.
    VOID_DELIVERY: () => {
        return `
            UPDATE dbo.ChemistDeliveries SET VoidedBy = @ActorId, VoidedOn = @Now, VoidReason = @Reason WHERE DeliveryId = @DeliveryId AND VoidedOn IS NULL;
            IF @@ROWCOUNT = 0 THROW 50409, 'This delivery was already voided.', 1;
            UPDATE dbo.MrStockLedger SET VoidedBy = @ActorId, VoidedOn = @Now, VoidReason = @Reason WHERE DeliveryId = @DeliveryId AND VoidedOn IS NULL;
            UPDATE dbo.ChemistLedger SET VoidedBy = @ActorId, VoidedOn = @Now, VoidReason = @Reason WHERE DeliveryId = @DeliveryId AND VoidedOn IS NULL;
        `;
    },

    // ---------------------------------------------------------
    // Chemist ledger
    // ---------------------------------------------------------

    INSERT_LEDGER: () => {
        return `
            INSERT INTO dbo.ChemistLedger (EntryId, PharmacyId, EntryType, Amount, EntryDate, UserId, DeliveryId, PaymentMode, PaymentRef, ReceiptStorageKey, ReceiptContentType,
                                           Latitude, Longitude, DepositStatus, Remarks, CreatedBy, CreatedOn)
            VALUES (@EntryId, @PharmacyId, @EntryType, @Amount, @EntryDate, @UserId, @DeliveryId, @PaymentMode, @PaymentRef, @ReceiptStorageKey, @ReceiptContentType,
                    @Latitude, @Longitude, @DepositStatus, @Remarks, @ActorId, @Now);
        `;
    },

    // Live entries of some chemists (for balances and ageing).
    DUE_ENTRIES: () => {
        return `
            SELECT c.EntryId, c.PharmacyId, CONVERT(VARCHAR(10), c.EntryDate, 23) AS EntryDate, c.Amount, c.EntryType, c.DeliveryId, d.UserId AS DeliveredBy
            FROM dbo.ChemistLedger c
            LEFT JOIN dbo.ChemistDeliveries d ON d.DeliveryId = c.DeliveryId
            WHERE c.VoidedOn IS NULL AND ${IN_LIST('c.PharmacyId', '@Pharmacies')}
        `;
    },

    CHEMIST_LEDGER: () => {
        return `
            SELECT c.EntryId, c.EntryType, CONVERT(VARCHAR(10), c.EntryDate, 23) AS EntryDate, c.Amount, c.UserId, ${displayName('u')} AS UserName,
                   c.DeliveryId, d.DeliveryNumber, c.PaymentMode, c.PaymentRef, CASE WHEN c.ReceiptStorageKey IS NULL THEN 0 ELSE 1 END AS HasReceipt,
                   c.DepositStatus, c.DepositConfirmedOn, c.Remarks, ${displayName('cb')} AS CreatedByName, c.CreatedOn, c.VoidedOn, c.VoidReason
            FROM dbo.ChemistLedger c
            LEFT JOIN Users u ON u.UserId = c.UserId
            LEFT JOIN Users cb ON cb.UserId = c.CreatedBy
            LEFT JOIN dbo.ChemistDeliveries d ON d.DeliveryId = c.DeliveryId
            WHERE c.PharmacyId = @PharmacyId
            ORDER BY c.EntryDate DESC, c.CreatedOn DESC
        `;
    },

    GET_LEDGER_ENTRY: () => `SELECT c.*, u.ManagerId FROM dbo.ChemistLedger c LEFT JOIN Users u ON u.UserId = c.UserId WHERE c.EntryId = @EntryId`,

    CREDIT_LIMITS: () => `SELECT PharmacyId, CreditLimit FROM dbo.ChemistCreditLimits WHERE ${IN_LIST('PharmacyId', '@Pharmacies')}`,

    UPSERT_CREDIT_LIMIT: () => {
        return `
            IF EXISTS (SELECT 1 FROM dbo.ChemistCreditLimits WHERE PharmacyId = @PharmacyId)
                UPDATE dbo.ChemistCreditLimits SET CreditLimit = @CreditLimit, ModifiedBy = @ActorId, ModifiedOn = @Now WHERE PharmacyId = @PharmacyId;
            ELSE
                INSERT INTO dbo.ChemistCreditLimits (PharmacyId, CreditLimit, ModifiedBy, ModifiedOn) VALUES (@PharmacyId, @CreditLimit, @ActorId, @Now);
        `;
    },

    CONFIRM_DEPOSIT: () => {
        return `
            UPDATE dbo.ChemistLedger SET DepositStatus = 'DEPOSITED', DepositConfirmedBy = @ActorId, DepositConfirmedOn = @Now
            WHERE EntryId = @EntryId AND EntryType = 'PAYMENT' AND DepositStatus = 'WITH_MR' AND VoidedOn IS NULL;
            IF @@ROWCOUNT = 0 THROW 50409, 'This payment is not waiting for deposit confirmation.', 1;
        `;
    },

    VOID_LEDGER_ENTRY: () => {
        return `
            UPDATE dbo.ChemistLedger SET VoidedBy = @ActorId, VoidedOn = @Now, VoidReason = @Reason
            WHERE EntryId = @EntryId AND VoidedOn IS NULL AND DeliveryId IS NULL;
            IF @@ROWCOUNT = 0 THROW 50409, 'This entry cannot be voided here (already voided, or part of a delivery: void the delivery instead).', 1;
        `;
    },

    // Payments an MR has collected that have not reached the company yet.
    PAYMENTS_WITH_MR: () => {
        return `
            SELECT c.EntryId, c.PharmacyId, ph.PharmacyName, CONVERT(VARCHAR(10), c.EntryDate, 23) AS EntryDate, -c.Amount AS Amount, c.PaymentMode, c.PaymentRef, c.UserId, ${displayName('u')} AS UserName
            FROM dbo.ChemistLedger c
            INNER JOIN dbo.Pharmacy ph ON ph.PharmacyId = c.PharmacyId
            LEFT JOIN Users u ON u.UserId = c.UserId
            WHERE c.EntryType = 'PAYMENT' AND c.DepositStatus = 'WITH_MR' AND c.VoidedOn IS NULL AND (@UserId IS NULL OR c.UserId = @UserId)
            ORDER BY c.EntryDate
        `;
    },

    // Chemists an MR delivered to (for exit clearance).
    CHEMISTS_DELIVERED_BY: () => `SELECT DISTINCT PharmacyId FROM dbo.ChemistDeliveries WHERE UserId = @UserId AND VoidedOn IS NULL`,

    PHARMACY_NAMES: () => `SELECT PharmacyId, PharmacyName FROM dbo.Pharmacy WHERE ${IN_LIST('PharmacyId', '@Pharmacies')}`,

    // ---------------------------------------------------------
    // Schemes and special prices (head office, from stockist billing)
    // ---------------------------------------------------------

    LIST_SCHEMES: () => {
        return `
            SELECT TOP 500 s.SchemeId, s.Kind, CONVERT(VARCHAR(10), s.BillingDate, 23) AS BillingDate, s.StockistId, st.StockistName, s.BillReference,
                   s.TerritoryId, t.TerritoryName, s.PharmacyId, ph.PharmacyName, s.DoctorId, dr.DoctorName, s.ProductId, p.ProductName,
                   s.Description, s.Value, ${displayName('cb')} AS CreatedByName, s.CreatedOn, s.VoidedOn, s.VoidReason
            FROM dbo.TradeSchemes s
            INNER JOIN dbo.Stockist st ON st.StockistId = s.StockistId
            INNER JOIN Territory t ON t.TerritoryId = s.TerritoryId
            LEFT JOIN dbo.Pharmacy ph ON ph.PharmacyId = s.PharmacyId
            LEFT JOIN dbo.Doctor dr ON dr.DoctorId = s.DoctorId
            LEFT JOIN dbo.Products p ON p.ProductId = s.ProductId
            LEFT JOIN Users cb ON cb.UserId = s.CreatedBy
            WHERE s.BillingDate BETWEEN @From AND @To
            ORDER BY s.BillingDate DESC, s.CreatedOn DESC
        `;
    },

    INSERT_SCHEME: () => {
        return `
            INSERT INTO dbo.TradeSchemes (SchemeId, Kind, BillingDate, StockistId, BillReference, TerritoryId, PharmacyId, DoctorId, ProductId, Description, Value, CreatedBy, CreatedOn)
            VALUES (@SchemeId, @Kind, @BillingDate, @StockistId, @BillReference, @TerritoryId, @PharmacyId, @DoctorId, @ProductId, @Description, @Value, @ActorId, @Now);
        `;
    },

    GET_SCHEME: () => `SELECT * FROM dbo.TradeSchemes WHERE SchemeId = @SchemeId`,

    VOID_SCHEME: () => {
        return `
            UPDATE dbo.TradeSchemes SET VoidedBy = @ActorId, VoidedOn = @Now, VoidReason = @Reason WHERE SchemeId = @SchemeId AND VoidedOn IS NULL;
            IF @@ROWCOUNT = 0 THROW 50409, 'This entry was already voided.', 1;
        `;
    },

    STOCKIST_EXISTS: () => `SELECT 1 AS Found FROM dbo.Stockist WHERE StockistId = @StockistId`,
    TERRITORY_EXISTS: () => `SELECT 1 AS Found FROM Territory WHERE TerritoryId = @TerritoryId`,
    DOCTOR: () => `SELECT DoctorId, DoctorName, TerritoryId, AreaId FROM dbo.Doctor WHERE DoctorId = @DoctorId`,
    PRODUCT: () => `SELECT ProductId, ProductName, UnitPrice FROM dbo.Products WHERE ProductId = @ProductId`,

    // ---------------------------------------------------------
    // Exit clearance
    // ---------------------------------------------------------

    LIST_CLEARANCES: () => {
        return `
            SELECT c.ClearanceId, c.UserId, ${displayName('u')} AS UserName, CONVERT(VARCHAR(10), c.LeavingDate, 23) AS LeavingDate,
                   c.SuccessorUserId, ${displayName('s')} AS SuccessorName, c.Reason, c.Status, c.HandedOverOn, c.CreatedOn, c.ClosedOn,
                   (SELECT COUNT(*) FROM dbo.ExitClearanceItems i WHERE i.ClearanceId = c.ClearanceId AND i.Status = 'OPEN') AS OpenItems,
                   (SELECT COUNT(*) FROM dbo.ExitClearanceItems i WHERE i.ClearanceId = c.ClearanceId) AS TotalItems
            FROM dbo.ExitClearances c
            INNER JOIN Users u ON u.UserId = c.UserId
            LEFT JOIN Users s ON s.UserId = c.SuccessorUserId
            WHERE (@UserId IS NULL OR c.UserId = @UserId)
            ORDER BY CASE WHEN c.Status = 'OPEN' THEN 0 ELSE 1 END, c.LeavingDate DESC
        `;
    },

    GET_CLEARANCE: () => `SELECT * FROM dbo.ExitClearances WHERE ClearanceId = @ClearanceId`,

    OPEN_CLEARANCE_OF: () => `SELECT ClearanceId FROM dbo.ExitClearances WHERE UserId = @UserId AND Status = 'OPEN'`,

    CLEARANCE_ITEMS: () => {
        return `
            SELECT i.ItemId, i.ItemType, i.RefId, i.Label, i.Quantity, i.Amount, i.Status, i.CreatedOn, i.ClosedOn, i.CloseNote, ${displayName('cb')} AS ClosedByName
            FROM dbo.ExitClearanceItems i LEFT JOIN Users cb ON cb.UserId = i.ClosedBy
            WHERE i.ClearanceId = @ClearanceId
            ORDER BY CASE WHEN i.Status = 'OPEN' THEN 0 ELSE 1 END, i.ItemType, i.Label
        `;
    },

    INSERT_CLEARANCE: () => {
        return `
            IF EXISTS (SELECT 1 FROM dbo.ExitClearances WHERE UserId = @UserId AND Status = 'OPEN')
                THROW 50409, 'This person already has an open exit clearance.', 1;
            INSERT INTO dbo.ExitClearances (ClearanceId, UserId, LeavingDate, SuccessorUserId, Reason, Status, CreatedBy, CreatedOn)
            VALUES (@ClearanceId, @UserId, @LeavingDate, @SuccessorUserId, @Reason, 'OPEN', @ActorId, @Now);
        `;
    },

    // Adds an item unless the same thing is already listed on this clearance.
    INSERT_ITEM: () => {
        return `
            IF NOT EXISTS (SELECT 1 FROM dbo.ExitClearanceItems WHERE ClearanceId = @ClearanceId AND ItemType = @ItemType AND RefId = @RefId)
                INSERT INTO dbo.ExitClearanceItems (ItemId, ClearanceId, ItemType, RefId, Label, Quantity, Amount, Status, CreatedOn)
                VALUES (@ItemId, @ClearanceId, @ItemType, @RefId, @Label, @Quantity, @Amount, 'OPEN', @Now);
        `;
    },

    GET_ITEM: () => `SELECT i.*, c.Status AS ClearanceStatus FROM dbo.ExitClearanceItems i INNER JOIN dbo.ExitClearances c ON c.ClearanceId = i.ClearanceId WHERE i.ItemId = @ItemId`,

    CLOSE_ITEM: () => {
        return `
            UPDATE dbo.ExitClearanceItems SET Status = 'CLOSED', ClosedBy = @ActorId, ClosedOn = @Now, CloseNote = @Note WHERE ItemId = @ItemId AND Status = 'OPEN';
            IF @@ROWCOUNT = 0 THROW 50409, 'This item is already closed.', 1;
        `;
    },

    // Full and final is released only when every item is closed.
    CLOSE_CLEARANCE: () => {
        return `
            IF EXISTS (SELECT 1 FROM dbo.ExitClearanceItems WHERE ClearanceId = @ClearanceId AND Status = 'OPEN')
                THROW 50409, 'Close every item first: full and final stays on hold until then.', 1;
            UPDATE dbo.ExitClearances SET Status = 'CLOSED', ClosedBy = @ActorId, ClosedOn = @Now WHERE ClearanceId = @ClearanceId AND Status = 'OPEN';
            IF @@ROWCOUNT = 0 THROW 50409, 'This clearance is already closed.', 1;
        `;
    },

    HANDOVER_DUE: () => `SELECT ClearanceId FROM dbo.ExitClearances WHERE Status = 'OPEN' AND HandedOverOn IS NULL AND LeavingDate <= @Today`,

    MARK_HANDED_OVER: () => {
        return `
            UPDATE dbo.ExitClearances SET HandedOverOn = @Now WHERE ClearanceId = @ClearanceId AND HandedOverOn IS NULL;
            IF @@ROWCOUNT = 0 THROW 50409, 'This handover was already done.', 1;
        `;
    },

    // Chemists and doctors move to the successor (or to head office when there is none).
    // The leaver's assignments are switched off, never deleted, so the history stays.
    HANDOVER_MAPPINGS: () => {
        return `
            DECLARE @Chemists TABLE (PharmacyId UNIQUEIDENTIFIER);
            INSERT INTO @Chemists SELECT DISTINCT PharmacyId FROM dbo.UserPharmacyMapping WHERE UserId = @UserId AND ISNULL(IsActive, 'Yes') <> 'No';
            UPDATE dbo.UserPharmacyMapping SET IsActive = 'No', ModifiedOn = @Now WHERE UserId = @UserId AND ISNULL(IsActive, 'Yes') <> 'No';
            IF @SuccessorUserId IS NOT NULL
                INSERT INTO dbo.UserPharmacyMapping (UserPharmacyMappingId, UserId, PharmacyId, IsActive, CreatedOn, ModifiedOn)
                SELECT NEWID(), @SuccessorUserId, c.PharmacyId, 'Yes', @Now, @Now FROM @Chemists c
                WHERE NOT EXISTS (SELECT 1 FROM dbo.UserPharmacyMapping m WHERE m.UserId = @SuccessorUserId AND m.PharmacyId = c.PharmacyId AND ISNULL(m.IsActive, 'Yes') <> 'No');

            DECLARE @Doctors TABLE (DoctorId UNIQUEIDENTIFIER);
            INSERT INTO @Doctors SELECT DISTINCT DoctorId FROM dbo.UserDoctorMapping WHERE UserId = @UserId AND ISNULL(IsActive, 'Yes') <> 'No';
            UPDATE dbo.UserDoctorMapping SET IsActive = 'No', ModifiedOn = @Now WHERE UserId = @UserId AND ISNULL(IsActive, 'Yes') <> 'No';
            IF @SuccessorUserId IS NOT NULL
                INSERT INTO dbo.UserDoctorMapping (UserDoctorMappingId, UserId, DoctorId, IsActive, CreatedOn, ModifiedOn)
                SELECT NEWID(), @SuccessorUserId, d.DoctorId, 'Yes', @Now, @Now FROM @Doctors d
                WHERE NOT EXISTS (SELECT 1 FROM dbo.UserDoctorMapping m WHERE m.DoctorId = d.DoctorId AND ISNULL(m.IsActive, 'Yes') <> 'No');

            SELECT (SELECT COUNT(*) FROM @Chemists) AS Chemists, (SELECT COUNT(*) FROM @Doctors) AS Doctors;
        `;
    },

    // Spend requests still in progress (doctor spend module; empty if that module is not installed yet).
    PENDING_SPEND: () => {
        return `
            SELECT r.RequestId, r.RequestNumber, r.Status, r.Amount, dr.DoctorName
            FROM dbo.SpendRequests r INNER JOIN dbo.Doctor dr ON dr.DoctorId = r.DoctorId
            WHERE r.UserId = @UserId AND r.Status IN ('REQUESTED', 'RECOMMENDED', 'NOT_RECOMMENDED', 'APPROVED')
        `;
    },

    // ---------------------------------------------------------
    // Unsupplied POB, fill rate
    // ---------------------------------------------------------

    // Per stockist per month; only orders booked by people the viewer may see.
    FILL_RATE: (scopeCte) => {
        return `
            ${scopeCte}
            SELECT o.StockistId, st.StockistName, DATEFROMPARTS(YEAR(o.OrderDate), MONTH(o.OrderDate), 1) AS Month,
                   COUNT(*) AS Raised, SUM(o.NetAmount) AS RaisedValue,
                   SUM(CASE WHEN o.Status = 'SUPPLIED' THEN 1 ELSE 0 END) AS Supplied,
                   ISNULL(SUM(CASE WHEN o.Status = 'SUPPLIED' THEN o.NetAmount END), 0) AS SuppliedValue,
                   SUM(CASE WHEN o.Status IN ('BOOKED', 'CONFIRMED') AND o.OrderDate <= DATEADD(DAY, -@Days, @Today) THEN 1 ELSE 0 END) AS Overdue
            FROM dbo.Orders o
            INNER JOIN dbo.Stockist st ON st.StockistId = o.StockistId
            WHERE o.Status <> 'CANCELLED' AND o.OrderDate BETWEEN @From AND @To AND o.UserId IN (SELECT UserId FROM Scope)
            GROUP BY o.StockistId, st.StockistName, DATEFROMPARTS(YEAR(o.OrderDate), MONTH(o.OrderDate), 1)
        `;
    },

    // ---------------------------------------------------------
    // Spend vs business and focus (sources; grouped in JavaScript)
    // ---------------------------------------------------------

    // Samples and gifts given to doctors, valued at the catalogue price.
    SAMPLE_SPEND: () => {
        return `
            SELECT s.DoctorId, dr.DoctorName, dr.TerritoryId, dr.AreaId, CASE WHEN s.ItemType = 'SAMPLE' THEN s.ItemId END AS ProductId,
                   SUM(-s.Quantity * COALESCE(p.UnitPrice, g.UnitValue, 0)) AS Value, SUM(-s.Quantity) AS Units
            FROM dbo.EngagementStock s
            INNER JOIN dbo.Doctor dr ON dr.DoctorId = s.DoctorId
            LEFT JOIN dbo.Products p ON s.ItemType = 'SAMPLE' AND p.ProductId = s.ItemId
            LEFT JOIN dbo.Gifts g ON s.ItemType = 'GIFT' AND g.GiftId = s.ItemId
            WHERE s.EntryType = 'DISTRIBUTION' AND s.EntryDate BETWEEN @From AND @To
            GROUP BY s.DoctorId, dr.DoctorName, dr.TerritoryId, dr.AreaId, CASE WHEN s.ItemType = 'SAMPLE' THEN s.ItemId END
        `;
    },

    SCHEME_SPEND: () => {
        return `
            SELECT s.TerritoryId, s.PharmacyId, s.DoctorId, s.ProductId, ph.AreaId AS PharmacyAreaId, dr.AreaId AS DoctorAreaId, SUM(s.Value) AS Value
            FROM dbo.TradeSchemes s
            LEFT JOIN dbo.Pharmacy ph ON ph.PharmacyId = s.PharmacyId
            LEFT JOIN dbo.Doctor dr ON dr.DoctorId = s.DoctorId
            WHERE s.VoidedOn IS NULL AND s.BillingDate BETWEEN @From AND @To
            GROUP BY s.TerritoryId, s.PharmacyId, s.DoctorId, s.ProductId, ph.AreaId, dr.AreaId
        `;
    },

    DOCTOR_SPEND_PAID: () => {
        return `
            SELECT r.DoctorId, r.TerritoryId, r.AreaId, SUM(r.DisbursedAmount) AS Value
            FROM dbo.SpendRequests r
            WHERE r.Status = 'DISBURSED' AND r.DisbursedDate BETWEEN @From AND @To
            GROUP BY r.DoctorId, r.TerritoryId, r.AreaId
        `;
    },

    NET_BY_TERRITORY: () => {
        return `
            SELECT x.TerritoryId, t.TerritoryName, SUM(x.Value) AS Net FROM (
                SELECT TerritoryId, Value FROM dbo.PrimaryDispatches WHERE VoidedOn IS NULL AND DispatchDate BETWEEN @From AND @To
                UNION ALL
                SELECT TerritoryId, -Value FROM dbo.StockReturns WHERE VoidedOn IS NULL AND ReturnDate BETWEEN @From AND @To
            ) x INNER JOIN Territory t ON t.TerritoryId = x.TerritoryId
            GROUP BY x.TerritoryId, t.TerritoryName
        `;
    },

    NET_BY_PRODUCT: () => {
        return `
            SELECT x.ProductId, p.ProductName, x.TerritoryId, SUM(x.Value) AS Net FROM (
                SELECT ProductId, TerritoryId, Value FROM dbo.PrimaryDispatches WHERE VoidedOn IS NULL AND DispatchDate BETWEEN @From AND @To
                UNION ALL
                SELECT ProductId, TerritoryId, -Value FROM dbo.StockReturns WHERE VoidedOn IS NULL AND ReturnDate BETWEEN @From AND @To
            ) x INNER JOIN dbo.Products p ON p.ProductId = x.ProductId
            GROUP BY x.ProductId, p.ProductName, x.TerritoryId
        `;
    },

    // Business per chemist: supplied POB + direct supply.
    CHEMIST_BUSINESS: () => {
        return `
            SELECT y.PharmacyId, ph.PharmacyName, ph.TerritoryId, ph.AreaId, SUM(y.Value) AS Business, SUM(y.Events) AS Events FROM (
                SELECT PharmacyId, NetAmount AS Value, 1 AS Events FROM dbo.Orders WHERE PharmacyId IS NOT NULL AND Status = 'SUPPLIED' AND OrderDate BETWEEN @From AND @To
                UNION ALL
                SELECT PharmacyId, TotalValue, 1 FROM dbo.ChemistDeliveries WHERE VoidedOn IS NULL AND DeliveryDate BETWEEN @From AND @To
            ) y INNER JOIN dbo.Pharmacy ph ON ph.PharmacyId = y.PharmacyId
            GROUP BY y.PharmacyId, ph.PharmacyName, ph.TerritoryId, ph.AreaId
        `;
    },

    // Business per doctor: supplied POB booked for the doctor.
    DOCTOR_BUSINESS: () => {
        return `
            SELECT o.DoctorId, SUM(o.NetAmount) AS Business
            FROM dbo.Orders o WHERE o.DoctorId IS NOT NULL AND o.Status = 'SUPPLIED' AND o.OrderDate BETWEEN @From AND @To
            GROUP BY o.DoctorId
        `;
    },

    DOCTOR_VISITS: () => {
        return `
            SELECT v.DoctorId, dr.DoctorName, dr.TerritoryId, dr.AreaId, COUNT(*) AS Visits
            FROM dbo.Visits v INNER JOIN dbo.Doctor dr ON dr.DoctorId = v.DoctorId
            WHERE v.VisitDate BETWEEN @From AND @To AND COALESCE(v.ValidityOverride, v.Validity, 'VALID') <> 'INVALID'
            GROUP BY v.DoctorId, dr.DoctorName, dr.TerritoryId, dr.AreaId
        `;
    },

    DOCTOR_NAMES: () => `SELECT DoctorId, DoctorName, TerritoryId, AreaId FROM dbo.Doctor WHERE ${IN_LIST('DoctorId', '@Doctors')}`,
    AREAS: () => `SELECT a.AreaId, a.AreaName, a.TerritoryId FROM dbo.Areas a`,
    TERRITORY_NAMES: () => `SELECT TerritoryId, TerritoryName FROM Territory`,

    // Head office pick lists for schemes / special prices.
    LOOKUP_STOCKISTS: () => `SELECT StockistId, StockistName FROM dbo.Stockist WHERE ISNULL(IsActive, 'Yes') <> 'No' ORDER BY StockistName`,
    LOOKUP_CHEMISTS: () => `SELECT PharmacyId, PharmacyName, TerritoryId FROM dbo.Pharmacy WHERE ISNULL(IsActive, 'Yes') <> 'No' ORDER BY PharmacyName`,
    LOOKUP_DOCTORS: () => `SELECT DoctorId, DoctorName, TerritoryId FROM dbo.Doctor WHERE ISNULL(IsActive, 'Yes') <> 'No' AND MergedIntoDoctorId IS NULL ORDER BY DoctorName`,
    LOOKUP_PRODUCTS: () => `SELECT ProductId, ProductName FROM dbo.Products WHERE IsActive = 1 ORDER BY ProductName`,

    // Territories of a set of users (current assignments).
    TERRITORIES_OF_USERS: () => {
        return `
            SELECT DISTINCT TerritoryId FROM (
                SELECT UserId, TerritoryId FROM dbo.UserTerritoryMapping
                UNION SELECT UserId, TerritoryId FROM Users WHERE TerritoryId IS NOT NULL
            ) x WHERE ${IN_LIST('x.UserId', '@Users')}
        `;
    },
};
