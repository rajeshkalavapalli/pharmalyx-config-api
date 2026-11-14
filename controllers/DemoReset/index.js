const express = require('express');
const db = require('../../db');
const { requirePermission } = require('../../utils/permissions');
const { currentOrganisationId } = require('../../utils/orgContext');

// TEMPORARY (remove after the demo company is cleaned): empties the DEMO company's data for manual testing.
// Keeps users, roles, reporting managers, locations and settings; deletes doctors, chemists, stockists, products,
// visits, orders, stock, DCR, expenses, audits, tour plans ...; then adds today's approved Tirupathi plan for
// testmanager@123 and testbde@gmail.com. Only the demo admin login (testdemo@123) can call it.
// Dry run unless ?commit=1 (the transaction is rolled back and only the counts come back).

const router = express.Router();
const DEMO_ADMIN = 'testdemo@123';

const RESET_SQL = `
SET NOCOUNT ON;
SET XACT_ABORT OFF;
DECLARE @Out TABLE (Kind VARCHAR(20), Name NVARCHAR(200), Rows INT NULL);
DECLARE @Wipe TABLE (Name SYSNAME PRIMARY KEY, Done BIT NOT NULL DEFAULT 0, Deleted INT NULL);
INSERT INTO @Wipe (Name)
SELECT v.Name FROM (VALUES
 ('VisitVoiceNotes'),('VisitJointWorkers'),('VisitExplanations'),('VisitCheckIns'),('Visits'),
 ('DoctorPlanProducts'),('DoctorPlanDoctors'),('DoctorPlans'),('DoctorBusiness'),('DoctorEvidence'),
 ('DoctorDuplicateFlags'),('DoctorVerifications'),('DoctorRequests'),('UserDoctorMapping'),('Doctor'),('Hospitals'),
 ('PreCallPlanProducts'),('PreCallPlans'),('RcpaLines'),('RcpaEntries'),
 ('OrderLines'),('Orders'),('TradeSchemes'),
 ('SecondaryStatementLines'),('SecondaryStatements'),('SalesTargets'),
 ('ChemistDeliveryLines'),('ChemistDeliveries'),('ChemistLedger'),('ChemistCreditLimits'),('ChemistAvailability'),
 ('UserPharmacyMapping'),('Pharmacy'),('StockistTerritories'),('UserStockistMapping'),('Stockist'),
 ('StockCounts'),('StockReturns'),('MrStockLedger'),('EngagementStock'),('PrimaryDispatches'),
 ('ProductBatches'),('Products'),('Gifts'),
 ('TourPlanDetails'),('TourPlan'),('TourPlanDeviation'),('StpDays'),('StpPatches'),('Stp'),
 ('JointAudits'),('JointWorkDays'),('BiometricDevices'),
 ('DailyCallReports'),('ExpenseClaimItems'),('ExpenseClaimDays'),('ExpenseClaims'),('AllowanceDayReviews'),('SpendRequests'),
 ('LeaveRequests'),('WorkDays'),('AttendanceLogs'),('LocationPings'),('LocationConsents'),('PolicyAcceptances'),
 ('FraudFlags'),('InsightAlertActions'),('ImportLinks'),('ImportRows'),('ImportBatches'),
 ('ExitClearanceItems'),('ExitClearances'),('Appraisals'),('AuditLog'),('FileBlobs')
) v(Name)
WHERE OBJECT_ID('dbo.' + v.Name, 'U') IS NOT NULL;

BEGIN TRANSACTION;
DECLARE @Pass INT = 0, @Name SYSNAME, @Sql NVARCHAR(400), @N INT, @Failed NVARCHAR(2000) = NULL;
WHILE @Pass < 20 AND @Failed IS NULL AND EXISTS (SELECT 1 FROM @Wipe WHERE Done = 0)
BEGIN
    SET @Pass += 1;
    DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT Name FROM @Wipe WHERE Done = 0;
    OPEN c; FETCH NEXT FROM c INTO @Name;
    WHILE @@FETCH_STATUS = 0 AND @Failed IS NULL
    BEGIN
        BEGIN TRY
            SET @Sql = N'DELETE FROM dbo.' + QUOTENAME(@Name) + N'; SET @N = @@ROWCOUNT;';
            EXEC sp_executesql @Sql, N'@N INT OUTPUT', @N = @N OUTPUT;
            UPDATE @Wipe SET Done = 1, Deleted = @N WHERE Name = @Name;
        END TRY
        BEGIN CATCH
            IF ERROR_NUMBER() <> 547 OR XACT_STATE() = -1 SET @Failed = @Name + ': ' + ERROR_MESSAGE();
        END CATCH
        FETCH NEXT FROM c INTO @Name;
    END
    CLOSE c; DEALLOCATE c;
END

IF @Failed IS NULL AND EXISTS (SELECT 1 FROM @Wipe WHERE Done = 0)
    INSERT INTO @Out SELECT 'BLOCKED', Name, NULL FROM @Wipe WHERE Done = 0;

DECLARE @Today DATE = CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'India Standard Time' AS DATE);
DECLARE @Month DATE = DATEFROMPARTS(YEAR(@Today), MONTH(@Today), 1);
DECLARE @Now DATETIME2 = SYSUTCDATETIME();
DECLARE @Approved UNIQUEIDENTIFIER = (SELECT TOP 1 SystemLovDetailId FROM dbo.SystemLovDetails
    WHERE UPPER(SystemLovDetailCode) = 'APPROVED' OR UPPER(SystemLovDetailName) = 'APPROVED');
DECLARE @AreaId UNIQUEIDENTIFIER, @TerritoryId UNIQUEIDENTIFIER, @AreaName NVARCHAR(200);
SELECT TOP 1 @AreaId = AreaId, @TerritoryId = TerritoryId, @AreaName = AreaName FROM dbo.Areas WHERE AreaName LIKE N'%Tirupat%' ORDER BY AreaName;
DECLARE @People TABLE (UserId UNIQUEIDENTIFIER, Login NVARCHAR(100), PlanId UNIQUEIDENTIFIER DEFAULT NEWID());
INSERT INTO @People (UserId, Login)
SELECT UserId, COALESCE(UserName, EmailId) FROM dbo.Users
WHERE UserName IN ('testmanager@123', 'testbde@gmail.com') OR EmailId IN ('testmanager@123', 'testbde@gmail.com');

IF @Failed IS NULL AND NOT EXISTS (SELECT 1 FROM @Out WHERE Kind = 'BLOCKED')
BEGIN
    IF @AreaId IS NULL SET @Failed = 'No area named like Tirupathi.';
    ELSE IF @Approved IS NULL SET @Failed = 'Tour plan status APPROVED missing.';
    ELSE IF (SELECT COUNT(*) FROM @People) <> 2 SET @Failed = 'testmanager@123 / testbde@gmail.com not both found.';
    ELSE
    BEGIN
        INSERT INTO dbo.TourPlan (TourPlanId, UserId, PlanMonth, StatusId, SubmittedOn, CreatedOn, ModifiedOn)
        SELECT PlanId, UserId, @Month, @Approved, @Now, @Now, @Now FROM @People;
        INSERT INTO dbo.TourPlanDetails (TourPlanId, PlanDate, DayType, TerritoryId, AreaId, Remarks, CreatedOn, ModifiedOn)
        SELECT PlanId, @Today, 'working', @TerritoryId, @AreaId, N'Manual testing', @Now, @Now FROM @People;
        INSERT INTO @Out SELECT 'PLAN', p.Login + ' -> ' + @AreaName + ' on ' + CONVERT(VARCHAR(10), @Today, 23)
            + CASE WHEN EXISTS (SELECT 1 FROM dbo.UserAreaMapping m WHERE m.UserId = p.UserId AND m.AreaId = @AreaId) THEN '' ELSE ' (NOT mapped to this area)' END, NULL
        FROM @People p;
    END
END

INSERT INTO @Out SELECT 'DELETED', Name, Deleted FROM @Wipe WHERE Done = 1;
IF @Failed IS NOT NULL INSERT INTO @Out VALUES ('FAILED', @Failed, NULL);

IF @Commit = 1 AND @Failed IS NULL AND NOT EXISTS (SELECT 1 FROM @Out WHERE Kind = 'BLOCKED')
BEGIN COMMIT; INSERT INTO @Out VALUES ('RESULT', 'COMMITTED', NULL); END
ELSE BEGIN IF XACT_STATE() <> 0 ROLLBACK; INSERT INTO @Out VALUES ('RESULT', 'ROLLED BACK (dry run or problem)', NULL); END

SELECT Kind, Name, Rows FROM @Out ORDER BY Kind, Rows DESC, Name;
`;

router.post('/demo-reset', requirePermission('masters.edit'), async (req, res) => {
    try {
        const pool = await db.poolPromise;
        const orgId = currentOrganisationId();
        const who = await pool.request()
            .input('UserId', req.user?.userId)
            .input('Org', orgId)
            .query(`EXEC sp_set_session_context @key = N'OrganisationId', @value = @Org;
                    EXEC sp_set_session_context @key = N'AllOrganisations', @value = NULL;
                    SELECT UserName, EmailId FROM dbo.Users WHERE UserId = @UserId`);
        const me = who.recordset[0];
        if (!orgId || !me || ![me.UserName, me.EmailId].includes(DEMO_ADMIN)) {
            return res.status(403).json({ message: 'Only the demo admin can reset the demo company.' });
        }
        const result = await pool.request()
            .input('Org', orgId)
            .input('Commit', req.query.commit === '1' ? 1 : 0)
            .query(`EXEC sp_set_session_context @key = N'OrganisationId', @value = @Org;
                    EXEC sp_set_session_context @key = N'AllOrganisations', @value = NULL;
                    ${RESET_SQL}`);
        return res.json({ organisationId: orgId, rows: result.recordset });
    } catch (error) {
        console.error('Demo reset failed:', error);
        return res.status(500).json({ message: 'Demo reset failed.', error: error.message });
    }
});

module.exports = router;
