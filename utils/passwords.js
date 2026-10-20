// Password rules and the "must change password" flag (Users.MustChangePassword, added by
// controllers/Users/schema_password_change.sql). Someone else setting a password switches the
// flag on; the person changing their own password switches it off.
// Until the column exists every helper here is a no-op, so nothing breaks before the script runs.

// At least 8 characters with a letter and a digit.
const passwordProblem = (password) => {
    const value = String(password ?? '');
    if (value.length < 8 || !/[A-Za-z]/.test(value) || !/\d/.test(value)) return 'Use at least 8 characters, with a letter and a digit.';
    if (value.length > 128) return 'Use 128 characters or fewer.';
    return null;
};

const FLAG_COLUMN = "COL_LENGTH('dbo.Users', 'MustChangePassword') IS NOT NULL";

// Sets the flag for @UserId to @MustChangePassword (1 / 0).
const SET_MUST_CHANGE_SQL = `
    IF ${FLAG_COLUMN}
        EXEC sp_executesql N'UPDATE dbo.Users SET MustChangePassword = @Flag WHERE UserId = @Id',
             N'@Flag BIT, @Id UNIQUEIDENTIFIER', @Flag = @MustChangePassword, @Id = @UserId;`;

// { MustChangePassword } for @UserId (0 before the column exists).
const GET_MUST_CHANGE_SQL = `
    IF ${FLAG_COLUMN}
        EXEC sp_executesql N'SELECT MustChangePassword FROM dbo.Users WHERE UserId = @Id', N'@Id UNIQUEIDENTIFIER', @Id = @UserId;
    ELSE
        SELECT CAST(0 AS BIT) AS MustChangePassword;`;

// The person's own new password: new hash, flag off, date recorded.
const CHANGE_OWN_PASSWORD_SQL = `
    UPDATE dbo.Users SET PasswordHash = @PasswordHash, ModifiedOn = GETDATE() WHERE UserId = @UserId;
    IF ${FLAG_COLUMN}
        EXEC sp_executesql N'UPDATE dbo.Users SET MustChangePassword = 0, PasswordChangedOn = SYSUTCDATETIME() WHERE UserId = @Id',
             N'@Id UNIQUEIDENTIFIER', @Id = @UserId;`;

module.exports = { passwordProblem, SET_MUST_CHANGE_SQL, GET_MUST_CHANGE_SQL, CHANGE_OWN_PASSWORD_SQL };
