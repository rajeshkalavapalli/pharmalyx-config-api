const crypto = require('crypto');

// Signed session tokens (HMAC-SHA256, JWT-compatible layout) using Node's crypto,
// so no extra dependency is needed. The secret lives in .env as AUTH_SECRET.

const TOKEN_TTL_SECONDS = Number(process.env.AUTH_TOKEN_TTL_SECONDS) || 12 * 60 * 60;

// Routes reachable without a session. Paths are relative to the /app mount.
const PUBLIC_ROUTES = new Set(['POST /login']);

const base64url = (input) => Buffer.from(input).toString('base64url');

const getSecret = () => {
    const secret = process.env.AUTH_SECRET;

    // Fail closed: without a strong secret no token can be issued or accepted.
    if (!secret || secret.length < 32) {
        throw new Error('AUTH_SECRET is missing or shorter than 32 characters.');
    }

    return secret;
};

const sign = (data) => crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');

const issueToken = (userId) => {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify({ sub: String(userId), iat: now, exp: now + TOKEN_TTL_SECONDS }));

    return {
        token: `${header}.${payload}.${sign(`${header}.${payload}`)}`,
        expiresAt: new Date((now + TOKEN_TTL_SECONDS) * 1000).toISOString(),
    };
};

// Returns the payload for a valid, unexpired token, otherwise null.
const verifyToken = (token) => {
    const parts = String(token || '').split('.');

    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const expected = Buffer.from(sign(`${header}.${payload}`));
    const actual = Buffer.from(signature);

    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;

    try {
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

        if (!claims.sub || !claims.exp || claims.exp <= Math.floor(Date.now() / 1000)) return null;

        return claims;
    } catch {
        return null;
    }
};

// Establishes the verified identity for every protected request.
// Existing handlers read the acting user from the x-user-id header, so the
// header is overwritten with the verified id: a client-supplied value is never trusted.
const authenticate = (req, res, next) => {
    if (req.method === 'OPTIONS' || PUBLIC_ROUTES.has(`${req.method} ${req.path}`)) {
        return next();
    }

    const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
    const claims = match ? verifyToken(match[1].trim()) : null;

    if (!claims) {
        return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
    }

    req.user = { userId: claims.sub };
    req.headers['x-user-id'] = claims.sub;

    return next();
};

module.exports = { issueToken, verifyToken, authenticate, TOKEN_TTL_SECONDS };
