const USER_NAME = (alias) => `COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(${alias}.FirstName, ' ', ${alias}.LastName))), ''), ${alias}.UserName)`;

const RATE_COLUMNS = `r.DaHq, r.DaExHq, r.DaOutstation, r.KmBike, r.KmCar, r.KmBus, r.KmTrain, r.KmAuto, r.KmOther, r.OtherMonthlyLimit`;

const CLAIM_COLUMNS = `
    c.ClaimId,
    c.UserId,
    ${USER_NAME('u')} AS UserName,
    sld.SystemLovDetailName AS DesignationName,
    u.ManagerId,
    CONVERT(VARCHAR(10), c.ClaimMonth, 23) AS ClaimMonth,
    c.Status,
    c.DaTotal,
    c.TaTotal,
    c.OtherTotal,
    c.ClaimedAmount,
    c.ApprovedAmount,
    c.SubmittedOn,
    ${USER_NAME('mr')} AS ManagerReviewedByName,
    c.ManagerReviewedOn,
    c.ManagerRemarks,
    ${USER_NAME('fr')} AS FinanceReviewedByName,
    c.FinanceReviewedOn,
    c.FinanceRemarks,
    c.PaymentRef,
    c.PaidOn
`;

const CLAIM_JOINS = `
    FROM dbo.ExpenseClaims c
    INNER JOIN Users u ON u.UserId = c.UserId
    LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = u.DesignationId
    LEFT JOIN Users mr ON mr.UserId = c.ManagerReviewedBy
    LEFT JOIN Users fr ON fr.UserId = c.FinanceReviewedBy
`;

// Recomputes the header totals from the day and item rows.
const RECALC = `
    UPDATE dbo.ExpenseClaims
    SET DaTotal    = (SELECT ISNULL(SUM(DaAmount), 0) FROM dbo.ExpenseClaimDays WHERE ClaimId = @ClaimId),
        TaTotal    = (SELECT ISNULL(SUM(TaAmount), 0) FROM dbo.ExpenseClaimDays WHERE ClaimId = @ClaimId),
        OtherTotal = (SELECT ISNULL(SUM(Amount), 0) FROM dbo.ExpenseClaimItems WHERE ClaimId = @ClaimId),
        ModifiedOn = @Now
    WHERE ClaimId = @ClaimId;

    UPDATE dbo.ExpenseClaims SET ClaimedAmount = DaTotal + TaTotal + OtherTotal WHERE ClaimId = @ClaimId;
`;

module.exports = {
    GET_USER: () => {
        return `
            SELECT u.UserId, u.ManagerId, u.DesignationId, sld.SystemLovDetailName AS DesignationName, ${USER_NAME('u')} AS Name
            FROM Users u
            LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = u.DesignationId
            WHERE u.UserId = @UserId
        `;
    },

    // ---------- Rate card ----------

    GET_RATE: () => `SELECT ${RATE_COLUMNS} FROM dbo.ExpenseRates r WHERE r.DesignationId = @DesignationId`,

    GET_RATES: () => {
        return `
            SELECT sld.SystemLovDetailId AS DesignationId, sld.SystemLovDetailName AS DesignationName, sld.SystemLovDetailCode AS DesignationCode,
                   CASE WHEN r.DesignationId IS NULL THEN 0 ELSE 1 END AS HasRates, ${RATE_COLUMNS}, r.ModifiedOn,
                   (SELECT COUNT(*) FROM Users x WHERE x.DesignationId = sld.SystemLovDetailId AND ISNULL(x.IsActive, 1) = 1) AS Users
            FROM SystemLovDetails sld
            INNER JOIN SystemLov l ON l.SystemLovId = sld.SystemLovId AND l.SystemLovCode = 'EMPLOYEE_DESIGNATION'
            LEFT JOIN dbo.ExpenseRates r ON r.DesignationId = sld.SystemLovDetailId
            WHERE ISNULL(sld.IsActive, 1) = 1
            ORDER BY sld.SystemLovDetailName
        `;
    },

    IS_DESIGNATION: () => {
        return `
            SELECT 1 AS Found FROM SystemLovDetails sld
            INNER JOIN SystemLov l ON l.SystemLovId = sld.SystemLovId AND l.SystemLovCode = 'EMPLOYEE_DESIGNATION'
            WHERE sld.SystemLovDetailId = @DesignationId
        `;
    },

    UPSERT_RATE: () => {
        return `
            UPDATE dbo.ExpenseRates
            SET DaHq = @DaHq, DaExHq = @DaExHq, DaOutstation = @DaOutstation, KmBike = @KmBike, KmCar = @KmCar, KmBus = @KmBus,
                KmTrain = @KmTrain, KmAuto = @KmAuto, KmOther = @KmOther, OtherMonthlyLimit = @OtherMonthlyLimit,
                ModifiedBy = @ModifiedBy, ModifiedOn = @Now
            WHERE DesignationId = @DesignationId;

            IF @@ROWCOUNT = 0
                INSERT INTO dbo.ExpenseRates (DesignationId, DaHq, DaExHq, DaOutstation, KmBike, KmCar, KmBus, KmTrain, KmAuto, KmOther,
                                              OtherMonthlyLimit, ModifiedBy, ModifiedOn)
                VALUES (@DesignationId, @DaHq, @DaExHq, @DaOutstation, @KmBike, @KmCar, @KmBus, @KmTrain, @KmAuto, @KmOther,
                        @OtherMonthlyLimit, @ModifiedBy, @Now);
        `;
    },

    // ---------- Claims ----------

    GET_CLAIM: () => `SELECT ${CLAIM_COLUMNS} ${CLAIM_JOINS} WHERE c.UserId = @UserId AND c.ClaimMonth = @Month`,

    GET_CLAIM_BY_ID: () => `SELECT ${CLAIM_COLUMNS} ${CLAIM_JOINS} WHERE c.ClaimId = @ClaimId`,

    // Days the MR worked, from approved DCRs.
    GET_APPROVED_DCRS: () => {
        return `
            SELECT r.DcrId, CONVERT(VARCHAR(10), r.ReportDate, 23) AS ReportDate, r.TravelMode, r.DistanceKm, r.VisitCount
            FROM dbo.DailyCallReports r
            WHERE r.UserId = @UserId AND r.Status = 'APPROVED' AND r.ReportDate BETWEEN @Month AND @MonthEnd
            ORDER BY r.ReportDate
        `;
    },

    GET_DAYS: () => {
        return `
            SELECT d.DayId, d.DcrId, CONVERT(VARCHAR(10), d.ExpenseDate, 23) AS ExpenseDate, d.StationType, d.TravelMode, d.DistanceKm,
                   d.DaAmount, d.TaAmount, d.ApprovedDa, d.ApprovedTa, d.Remarks
            FROM dbo.ExpenseClaimDays d
            WHERE d.ClaimId = @ClaimId
            ORDER BY d.ExpenseDate
        `;
    },

    GET_ITEMS: () => {
        return `
            SELECT i.ItemId, CONVERT(VARCHAR(10), i.ExpenseDate, 23) AS ExpenseDate, i.ExpenseType, i.Description, i.BillNumber, i.Vendor,
                   i.Amount, i.ApprovedAmount, i.CreatedOn
            FROM dbo.ExpenseClaimItems i
            WHERE i.ClaimId = @ClaimId
            ORDER BY i.ExpenseDate, i.CreatedOn
        `;
    },

    CREATE_CLAIM: () => {
        return `
            INSERT INTO dbo.ExpenseClaims (ClaimId, UserId, ClaimMonth, Status, DaTotal, TaTotal, OtherTotal, ClaimedAmount, CreatedOn, ModifiedOn)
            VALUES (@ClaimId, @UserId, @Month, 'DRAFT', 0, 0, 0, 0, @Now, @Now)
        `;
    },

    // First statement of any MR edit: the claim must still be the MR's draft or returned claim.
    LOCK_EDITABLE: () => {
        return `
            IF NOT EXISTS (SELECT 1 FROM dbo.ExpenseClaims WHERE ClaimId = @ClaimId AND UserId = @UserId AND Status IN ('DRAFT', 'RETURNED'))
                THROW 50001, 'CLAIM_LOCKED', 1;
        `;
    },

    DELETE_DAYS: () => `DELETE FROM dbo.ExpenseClaimDays WHERE ClaimId = @ClaimId`,

    INSERT_DAY: () => {
        return `
            INSERT INTO dbo.ExpenseClaimDays (DayId, ClaimId, DcrId, ExpenseDate, StationType, TravelMode, DistanceKm, DaAmount, TaAmount, Remarks)
            VALUES (@DayId, @ClaimId, @DcrId, @ExpenseDate, @StationType, @TravelMode, @DistanceKm, @DaAmount, @TaAmount, @Remarks)
        `;
    },

    INSERT_ITEM: () => {
        return `
            INSERT INTO dbo.ExpenseClaimItems (ItemId, ClaimId, ExpenseDate, ExpenseType, Description, BillNumber, Vendor, Amount, CreatedOn)
            VALUES (@ItemId, @ClaimId, @ExpenseDate, @ExpenseType, @Description, @BillNumber, @Vendor, @Amount, @Now)
        `;
    },

    DELETE_ITEM: () => `DELETE FROM dbo.ExpenseClaimItems WHERE ItemId = @ItemId AND ClaimId = @ClaimId`,

    RECALC: () => RECALC,

    // Clears any earlier review figures when the MR (re)submits.
    SUBMIT: () => {
        return `
            UPDATE dbo.ExpenseClaimItems SET ApprovedAmount = NULL WHERE ClaimId = @ClaimId;

            UPDATE dbo.ExpenseClaims
            SET Status = @ToStatus, SubmittedOn = @Now, ApprovedAmount = NULL, ModifiedOn = @Now
            WHERE ClaimId = @ClaimId;
        `;
    },

    // First statement of a review: the claim must still be in the expected status.
    GUARD_STATUS: () => {
        return `
            IF NOT EXISTS (SELECT 1 FROM dbo.ExpenseClaims WHERE ClaimId = @ClaimId AND Status = @FromStatus)
                THROW 50002, 'CLAIM_CHANGED', 1;
        `;
    },

    APPROVE_DAY: () => `UPDATE dbo.ExpenseClaimDays SET ApprovedDa = @ApprovedDa, ApprovedTa = @ApprovedTa WHERE DayId = @DayId AND ClaimId = @ClaimId`,

    APPROVE_ITEM: () => `UPDATE dbo.ExpenseClaimItems SET ApprovedAmount = @ApprovedAmount WHERE ItemId = @ItemId AND ClaimId = @ClaimId`,

    MANAGER_DECISION: () => {
        return `
            UPDATE dbo.ExpenseClaims
            SET Status = @ToStatus, ApprovedAmount = @ApprovedAmount, ManagerReviewedBy = @ReviewedBy, ManagerReviewedOn = @Now,
                ManagerRemarks = @Remarks, ModifiedOn = @Now
            WHERE ClaimId = @ClaimId
        `;
    },

    FINANCE_DECISION: () => {
        return `
            UPDATE dbo.ExpenseClaims
            SET Status = @ToStatus, FinanceReviewedBy = @ReviewedBy, FinanceReviewedOn = @Now, FinanceRemarks = @Remarks, ModifiedOn = @Now
            WHERE ClaimId = @ClaimId
        `;
    },

    MARK_PAID: () => {
        return `
            UPDATE dbo.ExpenseClaims
            SET Status = 'PAID', PaymentRef = @PaymentRef, PaidBy = @PaidBy, PaidOn = @Now, ModifiedOn = @Now
            WHERE ClaimId = @ClaimId
        `;
    },

    GET_REVIEWS: () => `SELECT ${CLAIM_COLUMNS} ${CLAIM_JOINS} WHERE u.ManagerId = @UserId AND c.Status = 'SUBMITTED' ORDER BY c.SubmittedOn`,

    GET_FINANCE: () => {
        return `
            SELECT ${CLAIM_COLUMNS} ${CLAIM_JOINS}
            WHERE c.Status = @Status
            ORDER BY CASE WHEN c.Status = 'PAID' THEN c.PaidOn ELSE c.ManagerReviewedOn END DESC
        `;
    },

    HAS_TEAM: () => `SELECT TOP 1 1 AS Found FROM Users WHERE ManagerId = @UserId`,
};
