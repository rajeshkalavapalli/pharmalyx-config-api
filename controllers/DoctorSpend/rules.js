// Pure rules for doctor-related spend (no database).
// Flow: MR requests -> reporting manager recommends (or not) -> head office approves / rejects
// (with a compliance confirmation) -> head office records the disbursement -> outcome is tracked.
// Managers never approve; only head office does.

const PERIODS = [3, 6];
const METHODS = ['BANK', 'CHEQUE', 'UPI', 'VENDOR'];

const dateKey = (value) => (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
const daysBetween = (from, to) => Math.round((new Date(`${dateKey(to)}T00:00:00Z`) - new Date(`${dateKey(from)}T00:00:00Z`)) / 86400000);
const addDays = (key, n) => {
    const d = new Date(`${dateKey(key)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
};
const addMonths = (key, n) => {
    const d = new Date(`${dateKey(key)}T00:00:00Z`);
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------
// Who may move a request, and when
// ---------------------------------------------------------------------

const canRecommend = (status) => status === 'REQUESTED';

// Head office decides after the manager's recommendation; straight away only when the MR has no manager.
const canDecide = (status, hasManager) => status === 'RECOMMENDED' || status === 'NOT_RECOMMENDED' || (status === 'REQUESTED' && !hasManager);

const canDisburse = (status) => status === 'APPROVED';

// The request itself: allowed type, within its limit, a purpose, the business expected and the period.
const validateRequest = ({ amount, maxAmount, expected, periodMonths, purpose }) => {
    const errors = [];
    if (!(amount > 0)) errors.push('Enter the amount.');
    else if (amount > maxAmount) errors.push(`The most allowed for this activity is Rs ${Number(maxAmount).toLocaleString('en-IN')}.`);
    if (!(expected > 0)) errors.push('Enter the business you expect from the territory.');
    if (!PERIODS.includes(Number(periodMonths))) errors.push('Choose 3 or 6 months for the expected business.');
    if (!purpose || String(purpose).trim().length < 10) errors.push('Describe the purpose (at least 10 characters).');
    return errors;
};

// ---------------------------------------------------------------------
// Outcome: expected business vs actual territory net sales
// ---------------------------------------------------------------------

// The period starts on the disbursement date and runs for 3 or 6 months.
const outcomeWindow = (disbursedDate, months) => {
    const from = dateKey(disbursedDate);
    return { from, to: addDays(addMonths(from, months), -1) };
};

/**
 * expected: business the MR promised for the whole period; actual: territory net sales so far in it.
 * Before the period ends the target is pro-rated by the days gone. Status:
 *   ON_TRACK      actual >= onTrackPct % of the target
 *   PARTLY_MET    actual >= partlyPct %
 *   CLAIM_FAILED  below that
 * `final` is true once the period is over: only final results count in the recommendation score.
 */
const evaluateOutcome = ({ expected, actual, from, to, today, onTrackPct, partlyPct }) => {
    const total = daysBetween(from, to) + 1;
    if (dateKey(today) < dateKey(from)) return { status: 'NOT_STARTED', final: false, pct: null, target: 0, elapsedPct: 0 };
    const final = dateKey(today) > dateKey(to);
    const elapsed = final ? total : Math.min(total, daysBetween(from, today) + 1);
    const target = Math.round(((Number(expected) || 0) * elapsed) / total);
    const pct = target > 0 ? Math.round(((Number(actual) || 0) / target) * 1000) / 10 : null;
    const partly = Math.min(Number(partlyPct), Number(onTrackPct));
    const status = pct == null ? 'NOT_STARTED' : pct >= Number(onTrackPct) ? 'ON_TRACK' : pct >= partly ? 'PARTLY_MET' : 'CLAIM_FAILED';
    return { status, final, pct, target, elapsedPct: Math.round((elapsed / total) * 100) };
};

// Sum of daily values that fall inside a window. rows: [{ Day, Value }]
const sumWindow = (rows, from, to) => rows.reduce((sum, row) => (dateKey(row.Day) >= from && dateKey(row.Day) <= to ? sum + (Number(row.Value) || 0) : sum), 0);

// Share of an MR's / manager's finished claims that were met (On track). Partly met is not "met".
const recommendationScore = (outcomes) => {
    const finals = outcomes.filter((o) => o && o.final);
    const met = finals.filter((o) => o.status === 'ON_TRACK').length;
    const partly = finals.filter((o) => o.status === 'PARTLY_MET').length;
    const failed = finals.filter((o) => o.status === 'CLAIM_FAILED').length;
    return { claims: finals.length, met, partly, failed, pct: finals.length ? Math.round((met / finals.length) * 100) : null };
};

module.exports = {
    PERIODS,
    METHODS,
    dateKey,
    daysBetween,
    addDays,
    addMonths,
    canRecommend,
    canDecide,
    canDisburse,
    validateRequest,
    outcomeWindow,
    evaluateOutcome,
    sumWindow,
    recommendationScore,
};
