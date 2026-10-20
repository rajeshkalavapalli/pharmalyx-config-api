// Organisations: the company travels with each request; sign-in across companies.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const argon2 = require('argon2');

const orgContext = require('../utils/orgContext');

const TORRENT = 'aaaaaaaa-0000-4000-8000-000000000001';
const MEDRICH = 'bbbbbbbb-0000-4000-8000-000000000002';

test('context: inside a company every query names it; across companies is explicit; nothing outside', async () => {
    assert.deepEqual(orgContext.contextInputs(), { __OrganisationId: null, __AllOrganisations: null });

    await orgContext.runInOrganisation(MEDRICH.toUpperCase(), async () => {
        await new Promise((resolve) => setTimeout(resolve, 5)); // survives awaits
        assert.deepEqual(orgContext.contextInputs(), { __OrganisationId: MEDRICH, __AllOrganisations: null });
        assert.equal(orgContext.currentOrganisationId(), MEDRICH);
    });

    orgContext.runAcrossOrganisations(() => {
        assert.deepEqual(orgContext.contextInputs(), { __OrganisationId: null, __AllOrganisations: 1 });
    });

    assert.equal(orgContext.currentOrganisationId(), null, 'nothing leaks out of a run');
    assert.match(orgContext.CONTEXT_SQL, /sp_set_session_context @key = N'OrganisationId'/);
    assert.match(orgContext.CONTEXT_SQL, /sp_set_session_context @key = N'AllOrganisations'/);
});

test('background jobs run once per active company, each inside that company; one failure does not stop the rest', async () => {
    const query = async (sql) => {
        if (sql.includes('OBJECT_ID')) return [{ on_: 1 }];
        return [{ OrganisationId: TORRENT }, { OrganisationId: MEDRICH }];
    };
    const seen = [];
    await orgContext.forEachOrganisation(query, async () => {
        seen.push(orgContext.currentOrganisationId());
        if (seen.length === 1) throw new Error('boom');
    }, 'Test job');
    assert.deepEqual(seen, [TORRENT, MEDRICH]);
});

// ---------- sign-in across companies ----------

const root = path.join(__dirname, '..');
const stub = (rel, exports) => {
    const file = require.resolve(path.join(root, rel));
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
};

test('sign-in: the same username in two companies; the password decides, a tie asks which company, paused companies refuse', async () => {
    const torrentHash = await argon2.hash('torrent-pass');
    const medrichHash = await argon2.hash('medrich-pass');
    const sharedHash = await argon2.hash('same-pass');
    let rows = [];

    stub('controllers/Users/userDA.js', { getLoginUsersAllOrgs: async () => rows });
    stub('utils/dbFunctions.js', { customQuery: async () => [{ on_: 1 }], runInTransaction: async () => [] });
    delete require.cache[require.resolve(path.join(root, 'controllers/Users/userService.js'))];
    const userService = require('../controllers/Users/userService');

    const rajesh = (org, name, hash, status = 'ACTIVE') => ({
        UserId: `${org.slice(0, 8)}-user`, UserName: 'RajeshK', Name: 'Rajesh K', PasswordHash: hash, DesignationName: 'BDE',
        OrganisationId: org.toUpperCase(), OrganisationName: name, OrganisationStatus: status,
    });

    rows = [rajesh(TORRENT, 'Torrent', torrentHash), rajesh(MEDRICH, 'Medrich', medrichHash)];
    const medrich = await userService.login('RajeshK', 'medrich-pass');
    assert.equal(medrich.organisation.OrganisationId, MEDRICH);
    assert.equal(medrich.organisation.Name, 'Medrich');
    assert.equal(medrich.user.PasswordHash, undefined, 'the hash never leaves the server');

    await assert.rejects(userService.login('RajeshK', 'wrong'), /Incorrect username or password/);

    rows = [rajesh(TORRENT, 'Torrent', sharedHash), rajesh(MEDRICH, 'Medrich', sharedHash)];
    const both = await userService.login('RajeshK', 'same-pass');
    assert.deepEqual(both.choices.map((c) => c.organisation.Name), ['Torrent', 'Medrich']);

    rows = [rajesh(TORRENT, 'Torrent', torrentHash, 'PAUSED')];
    await assert.rejects(userService.login('RajeshK', 'torrent-pass'), /account is paused/);
});

test('choice ticket: signed, short-lived, never accepted as a session', () => {
    process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test-secret-that-is-at-least-32-characters-long';
    delete require.cache[require.resolve(path.join(root, 'utils/auth.js'))];
    const auth = require('../utils/auth');

    const ticket = auth.issueChoiceTicket([{ u: { UserId: 'u1' }, o: { OrganisationId: TORRENT, Name: 'Torrent' } }]);
    assert.equal(auth.verifyChoiceTicket(ticket).choices[0].o.Name, 'Torrent');
    assert.equal(auth.verifyChoiceTicket(ticket.slice(0, -2) + 'xx'), null, 'tampering breaks it');

    const session = auth.issueToken('u1', MEDRICH.toUpperCase());
    assert.equal(auth.verifyToken(session.token).org, MEDRICH);
    assert.equal(auth.verifyChoiceTicket(session.token), null, 'a session is not a ticket');
});
