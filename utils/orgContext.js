// Which company ("organisation") the current request works for.
//
// Every database call first tells SQL Server the company (sp_set_session_context);
// the database's Row-Level Security policy then shows and saves only that company's
// rows, and tags new rows with it automatically. See controllers/Organisations/schema.sql.
//
// The company travels with the request through AsyncLocalStorage, so services and
// data-access files don't pass it around: authenticate() starts the request "in" the
// signed-in user's company, and background jobs run once per company.
//
// Until the organisations script has been run (no dbo.Organisations table yet), company
// mode is off and everything behaves as before.
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

// Prefixed to every query: names this request's company for the database policy.
// Both keys are always set, because pooled connections keep values from earlier requests.
const CONTEXT_SQL = `EXEC sp_set_session_context @key = N'OrganisationId', @value = @__OrganisationId;
EXEC sp_set_session_context @key = N'AllOrganisations', @value = @__AllOrganisations;
`;

const current = () => storage.getStore() || {};

const contextInputs = () => {
    const ctx = current();
    return {
        __OrganisationId: ctx.organisationId || null,
        __AllOrganisations: ctx.allOrganisations ? 1 : null,
    };
};

// Runs fn with the database limited to one company.
const runInOrganisation = (organisationId, fn) =>
    storage.run({ organisationId: String(organisationId).toLowerCase(), allOrganisations: false }, fn);

// Runs fn across all companies: only for sign-in lookup and company administration.
const runAcrossOrganisations = (fn) => storage.run({ organisationId: null, allOrganisations: true }, fn);

const currentOrganisationId = () => current().organisationId || null;

// ---------- company mode on/off ----------

let enabled = null;
let checkedAt = 0;
const RECHECK_MS = 60 * 1000;

// True once dbo.Organisations exists. Checked again every minute until it does.
// `query` is dbFunctions.customQuery (passed in to avoid a require loop).
const isEnabled = async (query) => {
    if (enabled === true) return true;
    if (enabled === false && Date.now() - checkedAt < RECHECK_MS) return false;
    try {
        const [row] = await query("SELECT CASE WHEN OBJECT_ID('dbo.Organisations', 'U') IS NULL THEN 0 ELSE 1 END AS on_");
        enabled = Boolean(row?.on_);
    } catch {
        enabled = false;
    }
    checkedAt = Date.now();
    return enabled;
};

// Background jobs: run fn once per active company (each run sees only that company's data),
// or once as before while company mode is off. One company's failure doesn't stop the rest.
const forEachOrganisation = async (query, fn, label = 'Background job') => {
    if (!(await isEnabled(query))) return fn();
    const organisations = await query("SELECT OrganisationId FROM dbo.Organisations WHERE Status = 'ACTIVE'");
    for (const { OrganisationId } of organisations) {
        try {
            await runInOrganisation(OrganisationId, fn);
        } catch (error) {
            console.error(`${label} failed for organisation ${OrganisationId}:`, error.message);
        }
    }
    return null;
};

module.exports = {
    CONTEXT_SQL,
    forEachOrganisation,
    contextInputs,
    current,
    currentOrganisationId,
    runInOrganisation,
    runAcrossOrganisations,
    isEnabled,
};
