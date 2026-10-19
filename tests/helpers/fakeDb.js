// Test helper: replaces the database, permissions, audit and file store with in-memory fakes.
// Queries are matched to the module's sql.js by their exact text, so a test answers "LIST_X" by name.
const path = require('path');

const root = path.join(__dirname, '..', '..');

const stub = (rel, exports) => {
    const file = require.resolve(path.join(root, rel));
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

const createFake = (sqlModules) => {
    const state = { answers: {}, settings: [], perms: {}, scope: {}, steps: [], audits: [], files: new Set(), throwOnRun: null };

    // Exact text of every named query -> name.
    const names = new Map();
    sqlModules.forEach((mod) =>
        Object.entries(mod).forEach(([name, fn]) => {
            try {
                names.set(fn(''), name);
            } catch {
                // queries that need arguments are matched by `includes` answers instead
            }
        })
    );

    const answer = (sql, inputs) => {
        const name = names.get(sql);
        if (name && name in state.answers) {
            const a = state.answers[name];
            return typeof a === 'function' ? a(inputs) : a;
        }
        for (const [needle, a] of Object.entries(state.answers)) {
            if (!names.has(sql) && sql.includes(needle)) return typeof a === 'function' ? a(inputs) : a;
        }
        if (sql.includes('FROM Scope s INNER JOIN Users')) return state.scope[String(inputs.ActingUserId).toLowerCase()] || [{ UserId: inputs.ActingUserId, Name: 'Me' }];
        if (sql.includes('AntiFraudSettings')) return state.settings;
        if (sql.includes('FROM dbo.Products')) return state.products || [];
        return [];
    };

    stub('utils/dbFunctions.js', {
        customQuery: async (sql, inputs = {}) => answer(sql, inputs),
        runInTransaction: async (steps) => {
            state.steps.push(...steps);
            if (state.throwOnRun) {
                const error = new Error(state.throwOnRun);
                error.number = 50409;
                throw error;
            }
            return steps.map((step) => ({ recordset: names.has(step.sqlQuery) && state.answers[`${names.get(step.sqlQuery)}:result`] ? state.answers[`${names.get(step.sqlQuery)}:result`] : [] }));
        },
    });
    stub('utils/permissions.js', {
        getPermissions: async (userId) => state.perms[String(userId).toLowerCase()] || new Set(),
        requirePermission: () => (req, res, next) => next(),
        requireAnyPermission: () => (req, res, next) => next(),
    });
    stub('utils/audit.js', { auditQuery: (entry) => ({ audit: entry }), writeAudit: async (entry) => state.audits.push(entry) });
    stub('utils/fileStore.js', {
        get: async (key) => {
            if (!state.files.has(key)) throw new Error('missing');
            return Buffer.from(`file:${key}`);
        },
        put: async (key) => {
            state.files.add(key);
            return { key };
        },
        sniffImage: () => ({ contentType: 'image/jpeg', ext: 'jpg' }),
        DRIVER: 'local',
    });

    // Names of the queries written in the last transaction(s).
    state.stepNames = () => state.steps.map((step) => (step.audit ? 'AUDIT' : names.get(step.sqlQuery) || 'OTHER'));
    state.step = (name) => state.steps.filter((step) => !step.audit && names.get(step.sqlQuery) === name).map((step) => step.inputs);
    state.reset = () => {
        state.steps.length = 0;
        state.audits.length = 0;
        state.throwOnRun = null;
    };
    return state;
};

// Expects a rejection with an HTTP status (and optional message pattern).
const rejects = async (fn, status, pattern) => {
    try {
        await fn();
    } catch (error) {
        if (error.status !== status) throw new Error(`expected ${status}, got ${error.status}: ${error.message}`);
        if (pattern && !pattern.test(error.message)) throw new Error(`message "${error.message}" does not match ${pattern}`);
        return error;
    }
    throw new Error(`expected a ${status} rejection`);
};

module.exports = { root, stub, createFake, rejects };
