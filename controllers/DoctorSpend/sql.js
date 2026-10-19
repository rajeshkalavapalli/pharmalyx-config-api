const { displayName } = require('../../utils/reportScope');

const IN_LIST = (column, param) => `${column} IN (SELECT TRY_CONVERT(UNIQUEIDENTIFIER, value) FROM OPENJSON(${param}))`;

module.exports = {
    // ---------------------------------------------------------
    // Activity types (head office)
    // ---------------------------------------------------------

    TYPES: () => `SELECT TypeId, TypeName, Description, MaxAmount, IsActive, CreatedOn, ModifiedOn FROM dbo.SpendActivityTypes ORDER BY IsActive DESC, TypeName`,

    GET_TYPE: () => `SELECT * FROM dbo.SpendActivityTypes WHERE TypeId = @TypeId`,

    INSERT_TYPE: () => {
        return `
            IF EXISTS (SELECT 1 FROM dbo.SpendActivityTypes WHERE TypeName = @TypeName)
                THROW 50409, 'An activity type with this name already exists.', 1;
            INSERT INTO dbo.SpendActivityTypes (TypeId, TypeName, Description, MaxAmount, IsActive, CreatedBy, CreatedOn)
            VALUES (@TypeId, @TypeName, @Description, @MaxAmount, @IsActive, @ActorId, @Now);
        `;
    },

    UPDATE_TYPE: () => {
        return `
            IF EXISTS (SELECT 1 FROM dbo.SpendActivityTypes WHERE TypeName = @TypeName AND TypeId <> @TypeId)
                THROW 50409, 'An activity type with this name already exists.', 1;
            UPDATE dbo.SpendActivityTypes SET TypeName = @TypeName, Description = @Description, MaxAmount = @MaxAmount, IsActive = @IsActive, ModifiedBy = @ActorId, ModifiedOn = @Now
            WHERE TypeId = @TypeId;
        `;
    },

    // ---------------------------------------------------------
    // Requests
    // ---------------------------------------------------------

    MY_DOCTORS: () => {
        return `
            SELECT d.DoctorId, d.DoctorName, d.TerritoryId, d.AreaId, t.TerritoryName
            FROM dbo.UserDoctorMapping m
            INNER JOIN dbo.Doctor d ON d.DoctorId = m.DoctorId
            LEFT JOIN Territory t ON t.TerritoryId = d.TerritoryId
            WHERE m.UserId = @UserId AND ISNULL(m.IsActive, 'Yes') <> 'No' AND ISNULL(d.IsActive, 'Yes') <> 'No'
            ORDER BY d.DoctorName
        `;
    },

    USER: () => `SELECT u.UserId, ${displayName('u')} AS Name, u.ManagerId, u.TerritoryId FROM Users u WHERE u.UserId = @UserId`,

    INSERT_REQUEST: () => {
        return `
            INSERT INTO dbo.SpendRequests (RequestId, UserId, ManagerId, DoctorId, TerritoryId, AreaId, TypeId, Amount, Purpose, ExpectedBusiness, PeriodMonths, Status, PriorFailedClaims, CreatedOn)
            VALUES (@RequestId, @UserId, @ManagerId, @DoctorId, @TerritoryId, @AreaId, @TypeId, @Amount, @Purpose, @ExpectedBusiness, @PeriodMonths, 'REQUESTED', @PriorFailedClaims, @Now);
            SELECT RequestNumber FROM dbo.SpendRequests WHERE RequestId = @RequestId;
        `;
    },

    // Every request (filtered in JavaScript by who may see it), with names for display.
    REQUESTS: () => {
        return `
            SELECT r.RequestId, r.RequestNumber, r.UserId, ${displayName('u')} AS UserName, r.ManagerId, ${displayName('m')} AS ManagerName,
                   r.DoctorId, dr.DoctorName, r.TerritoryId, t.TerritoryName, r.AreaId, r.TypeId, ty.TypeName, r.Amount, r.Purpose, r.ExpectedBusiness, r.PeriodMonths,
                   r.Status, r.PriorFailedClaims, r.ManagerRecommendation, r.ManagerNote, r.ManagerOn, r.Decision, r.DecisionNote, r.ComplianceConfirmed,
                   ${displayName('dby')} AS DecidedByName, r.DecidedOn, r.DisbursedAmount, CONVERT(VARCHAR(10), r.DisbursedDate, 23) AS DisbursedDate,
                   r.DisbursementMethod, r.DisbursementRef, CASE WHEN r.DocStorageKey IS NULL THEN 0 ELSE 1 END AS HasDocument, r.DisbursedOn, r.CreatedOn
            FROM dbo.SpendRequests r
            INNER JOIN Users u ON u.UserId = r.UserId
            LEFT JOIN Users m ON m.UserId = r.ManagerId
            LEFT JOIN Users dby ON dby.UserId = r.DecidedBy
            INNER JOIN dbo.Doctor dr ON dr.DoctorId = r.DoctorId
            INNER JOIN Territory t ON t.TerritoryId = r.TerritoryId
            INNER JOIN dbo.SpendActivityTypes ty ON ty.TypeId = r.TypeId
            ORDER BY r.CreatedOn DESC
        `;
    },

    GET_REQUEST: () => `SELECT r.*, u.ManagerId AS CurrentManagerId FROM dbo.SpendRequests r INNER JOIN Users u ON u.UserId = r.UserId WHERE r.RequestId = @RequestId`,

    RECOMMEND: () => {
        return `
            UPDATE dbo.SpendRequests
            SET ManagerRecommendation = @Recommendation, ManagerNote = @Note, ManagerBy = @ActorId, ManagerOn = @Now,
                Status = CASE WHEN @Recommendation = 'RECOMMEND' THEN 'RECOMMENDED' ELSE 'NOT_RECOMMENDED' END, ModifiedOn = @Now
            WHERE RequestId = @RequestId AND Status = 'REQUESTED';
            IF @@ROWCOUNT = 0 THROW 50409, 'This request is no longer waiting for a recommendation.', 1;
        `;
    },

    DECIDE: () => {
        return `
            UPDATE dbo.SpendRequests
            SET Decision = @Decision, DecisionNote = @Note, ComplianceConfirmed = @Compliance, DecidedBy = @ActorId, DecidedOn = @Now,
                Status = @Decision, ModifiedOn = @Now
            WHERE RequestId = @RequestId AND Status = @FromStatus;
            IF @@ROWCOUNT = 0 THROW 50409, 'This request was updated by someone else. Refresh and try again.', 1;
        `;
    },

    DISBURSE: () => {
        return `
            UPDATE dbo.SpendRequests
            SET DisbursedAmount = @Amount, DisbursedDate = @DisbursedDate, DisbursementMethod = @Method, DisbursementRef = @Reference,
                DocStorageKey = @DocKey, DocContentType = @DocType, DisbursedBy = @ActorId, DisbursedOn = @Now, Status = 'DISBURSED', ModifiedOn = @Now
            WHERE RequestId = @RequestId AND Status = 'APPROVED';
            IF @@ROWCOUNT = 0 THROW 50409, 'Only an approved request can be paid, and only once.', 1;
        `;
    },

    // ---------------------------------------------------------
    // Outcome sources: daily territory net sales and nearby chemists' business
    // ---------------------------------------------------------

    NET_DAILY: () => {
        return `
            SELECT x.TerritoryId, x.Day, SUM(x.Value) AS Value FROM (
                SELECT TerritoryId, DispatchDate AS Day, Value FROM dbo.PrimaryDispatches WHERE VoidedOn IS NULL AND DispatchDate BETWEEN @From AND @To AND ${IN_LIST('TerritoryId', '@Territories')}
                UNION ALL
                SELECT TerritoryId, ReturnDate, -Value FROM dbo.StockReturns WHERE VoidedOn IS NULL AND ReturnDate BETWEEN @From AND @To AND ${IN_LIST('TerritoryId', '@Territories')}
            ) x
            GROUP BY x.TerritoryId, x.Day
        `;
    },

    // Chemists in the doctor's area: supplied POB plus direct supply.
    AREA_CHEMISTS_DAILY: () => {
        return `
            SELECT ph.AreaId, y.Day, SUM(y.Value) AS Value FROM (
                SELECT PharmacyId, OrderDate AS Day, NetAmount AS Value FROM dbo.Orders WHERE PharmacyId IS NOT NULL AND Status = 'SUPPLIED' AND OrderDate BETWEEN @From AND @To
                UNION ALL
                SELECT PharmacyId, DeliveryDate, TotalValue FROM dbo.ChemistDeliveries WHERE VoidedOn IS NULL AND DeliveryDate BETWEEN @From AND @To
            ) y INNER JOIN dbo.Pharmacy ph ON ph.PharmacyId = y.PharmacyId
            WHERE ${IN_LIST('ph.AreaId', '@Areas')}
            GROUP BY ph.AreaId, y.Day
        `;
    },

    AREA_CHEMISTS_DAILY_POB_ONLY: () => {
        return `
            SELECT ph.AreaId, o.OrderDate AS Day, SUM(o.NetAmount) AS Value
            FROM dbo.Orders o INNER JOIN dbo.Pharmacy ph ON ph.PharmacyId = o.PharmacyId
            WHERE o.Status = 'SUPPLIED' AND o.OrderDate BETWEEN @From AND @To AND ${IN_LIST('ph.AreaId', '@Areas')}
            GROUP BY ph.AreaId, o.OrderDate
        `;
    },

    INSERT_FLAG: () => {
        return `
            IF NOT EXISTS (SELECT 1 FROM dbo.FraudFlags WHERE SubjectKey = @SubjectKey)
                INSERT INTO dbo.FraudFlags (FlagId, FlagType, Severity, UserId, DoctorId, VisitId, OrderId, Details, Data, Status, SubjectKey, CreatedOn)
                VALUES (@FlagId, @FlagType, @Severity, @UserId, @DoctorId, NULL, NULL, @Details, @Data, 'OPEN', @SubjectKey, @Now)
        `;
    },
};
