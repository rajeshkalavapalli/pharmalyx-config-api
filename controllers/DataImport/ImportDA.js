const db = require('../../db');
const { customQuery } = require('../../utils/dbFunctions');
const { CONTEXT_SQL, contextInputs } = require('../../utils/orgContext');
const { buildContext } = require('./context');
const sql = require('./sql');

const lower = (id) => (id == null ? null : String(id).toLowerCase());

// Everything validate.js needs, for one import type.
const loadContext = async (entityType) => {
    const linksOf = (EntityType) => customQuery(sql.LIST_LINKS(), { EntityType });
    const [states, divisions, designations, roles, territories, areas, users, territoryLinks, areaLinks, userLinks, ownLinks, featureRows] = await Promise.all([
        customQuery(sql.LIST_STATES()),
        customQuery(sql.LIST_DIVISIONS()),
        customQuery(sql.LIST_DESIGNATIONS()),
        customQuery(sql.LIST_ROLES()),
        customQuery(sql.LIST_TERRITORIES()),
        customQuery(sql.LIST_AREAS()),
        customQuery(sql.LIST_USERS()),
        linksOf('TERRITORY'),
        linksOf('AREA'),
        linksOf('USER'),
        linksOf(entityType),
        loadFeatures(),
    ]);
    const features = featureRows;

    const doctors = entityType === 'DOCTOR' ? await customQuery(sql.LIST_DOCTORS()) : [];
    const outlets =
        entityType === 'CHEMIST' ? await customQuery(sql.LIST_PHARMACIES()) : ['STOCKIST', 'STATEMENT'].includes(entityType) ? await customQuery(sql.LIST_STOCKISTS()) : [];
    const [products, statements, stockistOwners] =
        entityType === 'STATEMENT'
            ? await Promise.all([customQuery(sql.LIST_PRODUCTS()), customQuery(sql.LIST_STATEMENTS()), customQuery(sql.LIST_STOCKIST_OWNERS())])
            : [[], [], []];

    return buildContext(entityType, {
        states, divisions, designations, roles, territories, areas, users, doctors, outlets, features, products, statements, stockistOwners,
        links: { TERRITORY: territoryLinks, AREA: areaLinks, USER: userLinks, [entityType]: ownLinks },
    });
};

// Optional database columns (added by later scripts) that exist right now.
const loadFeatures = async () => {
    const [row] = await customQuery(sql.FEATURES());
    return { clinicAddress: Boolean(row?.clinicAddress) };
};

// Options for the value-matching step: everything a file value can be matched to.
const loadChoices = async (refs) => {
    const want = new Set(refs);
    const out = {};
    if (want.has('STATE')) out.STATE = (await customQuery(sql.LIST_STATES())).map((s) => ({ id: lower(s.id), label: s.name }));
    if (want.has('DIVISION')) out.DIVISION = (await customQuery(sql.LIST_DIVISIONS())).map((d) => ({ id: lower(d.id), label: d.name }));
    if (want.has('DESIGNATION')) out.DESIGNATION = (await customQuery(sql.LIST_DESIGNATIONS())).map((d) => ({ id: lower(d.id), label: d.name }));
    if (want.has('ROLE')) out.ROLE = (await customQuery(sql.LIST_ROLES())).map((r) => ({ id: lower(r.id), label: r.name }));
    if (want.has('TERRITORY')) out.TERRITORY = (await customQuery(sql.LIST_TERRITORIES())).map((t) => ({ id: lower(t.id), label: t.name }));
    if (want.has('AREA')) out.AREA = (await customQuery(sql.LIST_AREAS())).map((a) => ({ id: lower(a.id), label: `${a.name} · ${a.TerritoryName || ''}` }));
    Object.values(out).forEach((list) => list.sort((a, b) => String(a.label).localeCompare(String(b.label))));
    return out;
};

// Runs `work(run)` in one transaction; run(sqlText, inputs) returns the recordset.
// Anything thrown inside rolls everything back.
const inTransaction = async (work) => {
    const pool = await db.poolPromise;
    const transaction = pool.transaction();
    await transaction.begin();
    try {
        // Name the company for the database policy once; the transaction keeps one connection.
        const context = new db.sql.Request(transaction);
        Object.entries(contextInputs()).forEach(([name, value]) => context.input(name, value));
        await context.query(CONTEXT_SQL);

        const run = async (sqlText, inputs = {}) => {
            const request = new db.sql.Request(transaction);
            Object.entries(inputs).forEach(([name, value]) => request.input(name, value));
            const result = await request.query(sqlText);
            return result.recordset || [];
        };
        const result = await work(run);
        await transaction.commit();
        return result;
    } catch (error) {
        await transaction.rollback().catch(() => null);
        throw error;
    }
};

module.exports = { loadContext, loadChoices, loadFeatures, inTransaction, customQuery };
