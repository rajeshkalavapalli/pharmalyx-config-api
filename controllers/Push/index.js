const express = require('express');

const { customQuery } = require('../../utils/dbFunctions');
const { handle, actingUser } = require('../../utils/http');
const { fail, requireActingUser } = require('../../utils/access');

const router = express.Router();

// The phone's Expo push token for the signed-in person. A phone belongs to whoever signed in last.
const TOKEN = /^(Exponent|Expo)PushToken\[[A-Za-z0-9_-]{10,200}\]$/;
const noTable = (error) => /Invalid object name 'dbo\.PushTokens'/i.test(error?.message || '');

const SQL = {
    save: `
        UPDATE dbo.PushTokens SET UserId = @UserId, Platform = @Platform, LastSeenOn = @Now WHERE Token = @Token;
        IF @@ROWCOUNT = 0
            INSERT INTO dbo.PushTokens (Token, UserId, Platform, CreatedOn, LastSeenOn) VALUES (@Token, @UserId, @Platform, @Now, @Now);`,
    remove: `DELETE FROM dbo.PushTokens WHERE Token = @Token AND UserId = @UserId`,
};

const checkToken = (value) => {
    const token = String(value || '').trim();
    if (!TOKEN.test(token)) throw fail(400, 'Push token is invalid.');
    return token;
};

router.post(
    '/push/token',
    handle('save the push token', async (req) => {
        const userId = actingUser(req);
        requireActingUser(userId);
        const token = checkToken(req.body?.Token);
        const platform = ['android', 'ios'].includes(req.body?.Platform) ? req.body.Platform : 'android';
        try {
            await customQuery(SQL.save, { Token: token, UserId: userId, Platform: platform, Now: new Date() });
        } catch (error) {
            if (noTable(error)) return { saved: false }; // notifications not set up yet: the app works without them
            throw error;
        }
        return { saved: true };
    })
);

router.delete(
    '/push/token',
    handle('remove the push token', async (req) => {
        const userId = actingUser(req);
        requireActingUser(userId);
        const token = checkToken(req.body?.Token || req.query?.token);
        try {
            await customQuery(SQL.remove, { Token: token, UserId: userId });
        } catch (error) {
            if (!noTable(error)) throw error;
        }
        return { removed: true };
    })
);

module.exports = router;
