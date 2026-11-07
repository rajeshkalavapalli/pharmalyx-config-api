const { customQuery } = require('./dbFunctions');

// Phone notifications through the Expo push service (free; Android delivery goes through FCM).
// notify() never fails the request that triggered it: a missing table, no tokens or a network
// problem only log. Tokens that Expo reports as no longer registered are removed.

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH = 100; // Expo accepts up to 100 messages per request

const noTable = (error) => /Invalid object name 'dbo\.PushTokens'/i.test(error?.message || '');

const SQL = {
    tokensFor: `
        SELECT Token, UserId FROM dbo.PushTokens
        WHERE UserId IN (SELECT TRY_CONVERT(UNIQUEIDENTIFIER, value) FROM OPENJSON(@UserIds))`,
    remove: `DELETE FROM dbo.PushTokens WHERE Token IN (SELECT value FROM OPENJSON(@Tokens))`,
};

const send = async (messages) => {
    const response = await fetch(EXPO_URL, {
        method: 'POST',
        headers: { accept: 'application/json', 'accept-encoding': 'gzip, deflate', 'content-type': 'application/json' },
        body: JSON.stringify(messages),
    });
    if (!response.ok) throw new Error(`Expo push returned ${response.status}`);
    return (await response.json())?.data || [];
};

/**
 * Sends one notification to every phone of the given people.
 * message: { title, body, data } where data = { screen, params } opens that app screen on tap.
 */
const notify = async (userIds, message) => {
    const ids = [...new Set((userIds || []).filter(Boolean).map((id) => String(id).toLowerCase()))];
    if (!ids.length) return;
    try {
        const tokens = await customQuery(SQL.tokensFor, { UserIds: JSON.stringify(ids) });
        if (!tokens.length) return;
        const messages = tokens.map((row) => ({
            to: row.Token,
            title: String(message.title || 'Pharmalyx').slice(0, 120),
            body: String(message.body || '').slice(0, 300),
            data: message.data || {},
            sound: 'default',
            channelId: 'default',
            priority: 'high',
        }));
        const dead = [];
        for (let i = 0; i < messages.length; i += BATCH) {
            const chunk = messages.slice(i, i + BATCH);
            const tickets = await send(chunk);
            tickets.forEach((ticket, index) => {
                if (ticket?.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') dead.push(chunk[index].to);
            });
        }
        if (dead.length) await customQuery(SQL.remove, { Tokens: JSON.stringify(dead) });
    } catch (error) {
        if (!noTable(error)) console.error('Push notification not sent:', error.message);
    }
};

// Fire and forget: the caller's response doesn't wait for the phone notification.
const notifyLater = (userIds, message) => {
    notify(userIds, message).catch(() => {});
};

module.exports = { notify, notifyLater };
