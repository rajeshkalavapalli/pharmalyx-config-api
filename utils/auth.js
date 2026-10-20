const crypto = require('crypto');

const { customQuery } = require('./dbFunctions');
const orgContext = require('./orgContext');

// Signed session tokens (HMAC-SHA256, JWT-compatible layout) using Node's crypto,
// so no extra dependency is needed. The secret lives in .env as AUTH_SECRET.
//
// With organisations on, a session token also names the user's company (`org`), and
// every request runs inside that company (utils/orgContext.js).

const TOKEN_TTL_SECONDS = Number(process.env.AUTH_TOKEN_TTL_SECONDS) || 12 * 60 * 60;
const CHOICE_TTL_SECONDS = 5 * 60;

// Routes reachable without a session. Paths are relative to the /app mount.
const PUBLIC_ROUTES = new Set(['POST /login', 'POST /login/choose']);

// All a session may do while its user must choose their own password.
const ONLY_WHILE_CHANGING = new Set(['POST /change-password']);
const PASSWORD_CHANGE_REQUIRED = 'PASSWORD_CHANGE_REQUIRED';

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

const encode = (claims) => {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify(claims));
    return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
};

// mustChangePassword: the session only allows choosing a new password (ONLY_WHILE_CHANGING).
const issueToken = (userId, organisationId = null, { mustChangePassword = false } = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const claims = { sub: String(userId), iat: now, exp: now + TOKEN_TTL_SECONDS };
    if (organisationId) claims.org = String(organisationId).toLowerCase();
    if (mustChangePassword) claims.pwd = 1;

    return {
        token: encode(claims),
        expiresAt: new Date((now + TOKEN_TTL_SECONDS) * 1000).toISOString(),
    };
};

// After a password matched in several companies: proof of that, valid for 5 minutes,
// exchanged for a session once the person picks a company. Never accepted as a session.
const issueChoiceTicket = (choices) => {
    const now = Math.floor(Date.now() / 1000);
    return encode({ sub: 'org-choice', typ: 'org-choice', choices, iat: now, exp: now + CHOICE_TTL_SECONDS });
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

const verifyChoiceTicket = (ticket) => {
    const claims = verifyToken(ticket);
    return claims && claims.typ === 'org-choice' && Array.isArray(claims.choices) ? claims : null;
};

// ---------- company status (paused companies are signed out) ----------

const STATUS_TTL_MS = 30 * 1000;
const statusCache = new Map();

const organisationStatus = async (organisationId) => {
    const cached = statusCache.get(organisationId);
    if (cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.status;

    const [row] = await customQuery('SELECT Status FROM dbo.Organisations WHERE OrganisationId = @OrganisationId', { OrganisationId: organisationId });
    const status = row?.Status || null;
    statusCache.set(organisationId, { status, at: Date.now() });
    return status;
};

const PAUSED_MESSAGE = "Your company's Pharmalyx account is paused. Please contact your administrator.";

// Establishes the verified identity for every protected request.
// Existing handlers read the acting user from the x-user-id header, so the
// header is overwritten with the verified id: a client-supplied value is never trusted.
const authenticate = async (req, res, next) => {
    if (req.method === 'OPTIONS' || PUBLIC_ROUTES.has(`${req.method} ${req.path}`)) {
        return next();
    }

    const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
    const claims = match ? verifyToken(match[1].trim()) : null;

    if (!claims || claims.typ === 'org-choice') {
        return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
    }

    if (claims.pwd && !ONLY_WHILE_CHANGING.has(`${req.method} ${req.path}`)) {
        return res.status(403).json({ code: PASSWORD_CHANGE_REQUIRED, message: 'Please choose your own password to continue.' });
    }

    req.user = { userId: claims.sub, organisationId: claims.org || null };
    req.headers['x-user-id'] = claims.sub;

    try {
        if (!(await orgContext.isEnabled(customQuery))) return next();

        // Company mode: the session must name a company (older sessions sign in again).
        if (!claims.org) {
            return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
        }
        const status = await organisationStatus(claims.org);
        if (status !== 'ACTIVE') {
            return res.status(status === 'PAUSED' ? 403 : 401).json({ message: status === 'PAUSED' ? PAUSED_MESSAGE : 'Your session has expired. Please sign in again.' });
        }

        // Everything this request does now runs inside the user's company.
        return orgContext.runInOrganisation(claims.org, () => next());
    } catch (error) {
        console.error('Error checking the session:', error);
        return res.status(500).json({ message: 'Failed to check your session.' });
    }
};

module.exports = { PASSWORD_CHANGE_REQUIRED, issueToken, issueChoiceTicket, verifyToken, verifyChoiceTicket, authenticate, PAUSED_MESSAGE, TOKEN_TTL_SECONDS };
