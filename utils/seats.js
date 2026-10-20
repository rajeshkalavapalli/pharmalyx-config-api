// User limit per company ("seats"): the platform owner sets Organisations.MaxUsers;
// active users (the admin included) may not go above it. Deactivating someone frees a seat.
//
// The check runs inside the same transaction as the save, after it: if the company is now
// over its limit the whole save is rolled back. Locking the company row first makes two
// saves at the same moment wait for each other instead of both slipping through.
// Does nothing until the organisations script has been run.
const { fail } = require('./access');
const { customQuery } = require('./dbFunctions');

const SEAT_LIMIT_ERROR = 50429;

const COMPANY = "TRY_CAST(SESSION_CONTEXT(N'OrganisationId') AS UNIQUEIDENTIFIER)";

// Run first inside the transaction.
const LOCK_SEATS_SQL = `
    IF OBJECT_ID('dbo.Organisations', 'U') IS NOT NULL
        EXEC sp_executesql N'SELECT MaxUsers FROM dbo.Organisations WITH (UPDLOCK, HOLDLOCK) WHERE OrganisationId = ${COMPANY.replace(/'/g, "''")}';`;

// Run last inside the transaction; THROWs (rolling back) when over the limit.
const CHECK_SEATS_SQL = `
    IF OBJECT_ID('dbo.Organisations', 'U') IS NOT NULL
        EXEC sp_executesql N'
            DECLARE @Max INT = (SELECT MaxUsers FROM dbo.Organisations WHERE OrganisationId = ${COMPANY.replace(/'/g, "''")});
            DECLARE @Used INT = (SELECT COUNT(*) FROM dbo.Users WHERE IsActive = 1);
            IF @Max IS NOT NULL AND @Used > @Max
            BEGIN
                DECLARE @Message NVARCHAR(300) = CONCAT(N''Your plan allows '', @Max, N'' active users and this would make '', @Used, N''. Deactivate someone or contact Pharmalyx to add more.'');
                THROW ${SEAT_LIMIT_ERROR}, @Message, 1;
            END';`;

// For screens: "7 of 10 users". null while company mode is off.
const getSeats = async () => {
    const [row] = await customQuery(`
        IF OBJECT_ID('dbo.Organisations', 'U') IS NULL
            SELECT CAST(NULL AS INT) AS MaxUsers, CAST(NULL AS INT) AS ActiveUsers;
        ELSE
            EXEC sp_executesql N'SELECT o.MaxUsers, (SELECT COUNT(*) FROM dbo.Users WHERE IsActive = 1) AS ActiveUsers
                                 FROM dbo.Organisations o WHERE o.OrganisationId = ${COMPANY.replace(/'/g, "''")}';`);
    if (!row || row.MaxUsers == null) return null;
    return { max: row.MaxUsers, used: row.ActiveUsers, free: Math.max(0, row.MaxUsers - row.ActiveUsers) };
};

// Turns the database's limit error into a clear 403 for the screen.
const seatError = (error) => (error && (error.number === SEAT_LIMIT_ERROR || error.originalError?.info?.number === SEAT_LIMIT_ERROR) ? fail(403, error.message) : null);

module.exports = { LOCK_SEATS_SQL, CHECK_SEATS_SQL, getSeats, seatError, SEAT_LIMIT_ERROR };
