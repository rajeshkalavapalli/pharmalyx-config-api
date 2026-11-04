/*
    Joint work: a field person (e.g. a BDE) works the day with colleagues (e.g. their ASM, RSM).

    JointWorkDays      one row per person + colleague + date: the request, the colleague's answer
                       (PENDING / CONFIRMED / DECLINED) and the colleague's coaching feedback.
    VisitJointWorkers  which colleagues were on each visit (Visits.JointWorkUserId keeps the first one,
                       so older reports keep working).

    Run once per database in SSMS (local, then the Azure dev database). Safe to run again.
*/

IF OBJECT_ID('dbo.JointWorkDays') IS NULL
BEGIN
    CREATE TABLE dbo.JointWorkDays (
        JointWorkId     UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_JointWorkDays PRIMARY KEY,
        UserId          UNIQUEIDENTIFIER NOT NULL,  -- whose field day it is
        ColleagueUserId UNIQUEIDENTIFIER NOT NULL,  -- who joins them
        WorkDate        DATE NOT NULL,
        Status          VARCHAR(12) NOT NULL CONSTRAINT DF_JointWorkDays_Status DEFAULT ('PENDING'),
        RequestedBy     UNIQUEIDENTIFIER NOT NULL,
        ResponseNote    NVARCHAR(300) NULL,
        RespondedOn     DATETIME2 NULL,
        Rating          TINYINT NULL,
        CoachingNotes   NVARCHAR(1000) NULL,
        FeedbackOn      DATETIME2 NULL,
        CreatedOn       DATETIME2 NOT NULL,
        OrganisationId  UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_JointWorkDays_OrganisationId DEFAULT (TRY_CAST(SESSION_CONTEXT(N'OrganisationId') AS UNIQUEIDENTIFIER)),
        CONSTRAINT CK_JointWorkDays_Status CHECK (Status IN ('PENDING', 'CONFIRMED', 'DECLINED')),
        CONSTRAINT CK_JointWorkDays_Rating CHECK (Rating IS NULL OR Rating BETWEEN 1 AND 5),
        CONSTRAINT CK_JointWorkDays_NotSelf CHECK (UserId <> ColleagueUserId),
        CONSTRAINT UQ_JointWorkDays UNIQUE (UserId, ColleagueUserId, WorkDate),
        CONSTRAINT FK_JointWorkDays_User FOREIGN KEY (UserId) REFERENCES dbo.Users (UserId),
        CONSTRAINT FK_JointWorkDays_Colleague FOREIGN KEY (ColleagueUserId) REFERENCES dbo.Users (UserId),
        CONSTRAINT FK_JointWorkDays_Organisation FOREIGN KEY (OrganisationId) REFERENCES dbo.Organisations (OrganisationId)
    );

    CREATE INDEX IX_JointWorkDays_Colleague ON dbo.JointWorkDays (ColleagueUserId, WorkDate);
    CREATE INDEX IX_JointWorkDays_UserDate ON dbo.JointWorkDays (UserId, WorkDate);
END
GO

IF OBJECT_ID('dbo.VisitJointWorkers') IS NULL
BEGIN
    CREATE TABLE dbo.VisitJointWorkers (
        VisitId        UNIQUEIDENTIFIER NOT NULL,
        UserId         UNIQUEIDENTIFIER NOT NULL,   -- the colleague on the visit
        OrganisationId UNIQUEIDENTIFIER NOT NULL
            CONSTRAINT DF_VisitJointWorkers_OrganisationId DEFAULT (TRY_CAST(SESSION_CONTEXT(N'OrganisationId') AS UNIQUEIDENTIFIER)),
        CONSTRAINT PK_VisitJointWorkers PRIMARY KEY (VisitId, UserId),
        CONSTRAINT FK_VisitJointWorkers_Visit FOREIGN KEY (VisitId) REFERENCES dbo.Visits (VisitId),
        CONSTRAINT FK_VisitJointWorkers_User FOREIGN KEY (UserId) REFERENCES dbo.Users (UserId),
        CONSTRAINT FK_VisitJointWorkers_Organisation FOREIGN KEY (OrganisationId) REFERENCES dbo.Organisations (OrganisationId)
    );

    CREATE INDEX IX_VisitJointWorkers_User ON dbo.VisitJointWorkers (UserId);
END
GO

-- Existing joint visits (one colleague each) become rows of the new table.
INSERT INTO dbo.VisitJointWorkers (VisitId, UserId, OrganisationId)
SELECT v.VisitId, v.JointWorkUserId, v.OrganisationId
FROM dbo.Visits v
WHERE v.JointWorkUserId IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM dbo.VisitJointWorkers j WHERE j.VisitId = v.VisitId AND j.UserId = v.JointWorkUserId);
GO

-- Company isolation, same as every other company table.
IF NOT EXISTS (
    SELECT 1 FROM sys.security_predicates p
    WHERE p.target_object_id = OBJECT_ID('dbo.JointWorkDays')
)
    ALTER SECURITY POLICY [Security].[OrganisationIsolation]
        ADD FILTER PREDICATE [Security].[fn_InOrganisation]([OrganisationId]) ON dbo.JointWorkDays,
        ADD BLOCK PREDICATE [Security].[fn_InOrganisation]([OrganisationId]) ON dbo.JointWorkDays AFTER INSERT,
        ADD BLOCK PREDICATE [Security].[fn_InOrganisation]([OrganisationId]) ON dbo.JointWorkDays AFTER UPDATE;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.security_predicates p
    WHERE p.target_object_id = OBJECT_ID('dbo.VisitJointWorkers')
)
    ALTER SECURITY POLICY [Security].[OrganisationIsolation]
        ADD FILTER PREDICATE [Security].[fn_InOrganisation]([OrganisationId]) ON dbo.VisitJointWorkers,
        ADD BLOCK PREDICATE [Security].[fn_InOrganisation]([OrganisationId]) ON dbo.VisitJointWorkers AFTER INSERT,
        ADD BLOCK PREDICATE [Security].[fn_InOrganisation]([OrganisationId]) ON dbo.VisitJointWorkers AFTER UPDATE;
GO
