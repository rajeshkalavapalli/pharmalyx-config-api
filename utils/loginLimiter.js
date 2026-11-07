// Slows down password guessing on POST /app/login (and /app/login/choose).
//   - per login name: 5 wrong passwords in a row lock that name for 15 minutes
//   - per IP address: 20 wrong passwords in 15 minutes block that address for 15 minutes
// Kept in memory: one API instance today; a restart clears it, which only gives a guesser a fresh start.

const MAX_PER_LOGIN = 5;
const MAX_PER_IP = 20;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

const byLogin = new Map();
const byIp = new Map();

const loginKey = (login) => String(login || '').trim().toLowerCase();

const minutesLeft = (until) => Math.max(1, Math.ceil((until - Date.now()) / 60000));
const lockText = (until) => {
    const minutes = minutesLeft(until);
    return `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
};

// Entries are { count, first, until }; an old window or an expired lock starts over.
const fresh = (entry) => {
    const now = Date.now();
    if (!entry) return { count: 0, first: now, until: 0 };
    if (entry.until && entry.until <= now) return { count: 0, first: now, until: 0 };
    if (!entry.until && now - entry.first > WINDOW_MS) return { count: 0, first: now, until: 0 };
    return entry;
};

// Message to answer with (429) when the name or the address is locked, else null.
const checkLogin = (login, ip) => {
    const now = Date.now();
    const ipEntry = byIp.get(ip);
    if (ipEntry?.until > now) return lockText(ipEntry.until);
    const loginEntry = byLogin.get(loginKey(login));
    if (loginEntry?.until > now) return lockText(loginEntry.until);
    return null;
};

const recordFailure = (login, ip) => {
    const key = loginKey(login);
    const entry = fresh(byLogin.get(key));
    entry.count += 1;
    if (entry.count >= MAX_PER_LOGIN) entry.until = Date.now() + LOCK_MS;
    byLogin.set(key, entry);

    const ipEntry = fresh(byIp.get(ip));
    ipEntry.count += 1;
    if (ipEntry.count >= MAX_PER_IP) ipEntry.until = Date.now() + LOCK_MS;
    byIp.set(ip, ipEntry);
};

// A correct password clears that name's count (the address keeps its count until the window ends).
const clearLogin = (login) => byLogin.delete(loginKey(login));

// Old entries are dropped now and then so the maps don't grow forever.
setInterval(() => {
    const now = Date.now();
    for (const map of [byLogin, byIp]) {
        for (const [key, entry] of map) {
            if ((entry.until && entry.until <= now) || (!entry.until && now - entry.first > WINDOW_MS)) map.delete(key);
        }
    }
}, 10 * 60 * 1000).unref();

module.exports = { checkLogin, recordFailure, clearLogin, MAX_PER_LOGIN, MAX_PER_IP };
