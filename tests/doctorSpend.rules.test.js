// Pure rules of doctor-related spend. Run: npm test
const test = require('node:test');
const assert = require('node:assert');

const rules = require('../controllers/DoctorSpend/rules');

const outcome = (actual, today, expected = 300000) =>
    rules.evaluateOutcome({ expected, actual, from: '2026-01-01', to: '2026-03-31', today, onTrackPct: 90, partlyPct: 50 });

test('only head office decides, and only after the manager has recommended (unless there is no manager)', () => {
    assert.strictEqual(rules.canRecommend('REQUESTED'), true);
    assert.strictEqual(rules.canRecommend('RECOMMENDED'), false);
    assert.strictEqual(rules.canDecide('REQUESTED', true), false);
    assert.strictEqual(rules.canDecide('REQUESTED', false), true);
    assert.strictEqual(rules.canDecide('RECOMMENDED', true), true);
    assert.strictEqual(rules.canDecide('NOT_RECOMMENDED', true), true);
    assert.strictEqual(rules.canDecide('APPROVED', true), false);
    assert.strictEqual(rules.canDisburse('APPROVED'), true);
    assert.strictEqual(rules.canDisburse('DISBURSED'), false);
});

test('request checks: within the type limit, expected business, 3 or 6 months, a purpose', () => {
    assert.deepStrictEqual(rules.validateRequest({ amount: 20000, maxAmount: 25000, expected: 200000, periodMonths: 3, purpose: 'CME on diabetes care' }), []);
    assert.match(rules.validateRequest({ amount: 30000, maxAmount: 25000, expected: 1, periodMonths: 3, purpose: 'CME on diabetes care' })[0], /most allowed/);
    assert.match(rules.validateRequest({ amount: 100, maxAmount: 25000, expected: 0, periodMonths: 3, purpose: 'CME on diabetes care' })[0], /business you expect/);
    assert.match(rules.validateRequest({ amount: 100, maxAmount: 25000, expected: 10, periodMonths: 4, purpose: 'CME on diabetes care' })[0], /3 or 6/);
    assert.match(rules.validateRequest({ amount: 100, maxAmount: 25000, expected: 10, periodMonths: 6, purpose: 'short' })[0], /purpose/);
});

test('outcome window: from the payment date for 3 or 6 months', () => {
    assert.deepStrictEqual(rules.outcomeWindow('2026-01-15', 3), { from: '2026-01-15', to: '2026-04-14' });
    assert.deepStrictEqual(rules.outcomeWindow('2026-08-31', 6), { from: '2026-08-31', to: '2027-02-27' });
});

test('final outcome: on track, partly met, claim failed', () => {
    assert.strictEqual(outcome(280000, '2026-04-10').status, 'ON_TRACK'); // 93%
    assert.strictEqual(outcome(200000, '2026-04-10').status, 'PARTLY_MET'); // 67%
    const failed = outcome(100000, '2026-04-10'); // 33%
    assert.strictEqual(failed.status, 'CLAIM_FAILED');
    assert.strictEqual(failed.final, true);
    assert.strictEqual(failed.pct, 33.3);
});

test('during the period the target is pro-rated by the days gone, and the result is not final', () => {
    const mid = outcome(100000, '2026-01-30'); // 30 of 90 days -> target 100000
    assert.strictEqual(mid.final, false);
    assert.strictEqual(mid.target, 100000);
    assert.strictEqual(mid.status, 'ON_TRACK');
    assert.strictEqual(outcome(0, '2025-12-31').status, 'NOT_STARTED');
});

test('recommendation score: share of finished claims that were met', () => {
    const s = rules.recommendationScore([
        { final: true, status: 'ON_TRACK' },
        { final: true, status: 'CLAIM_FAILED' },
        { final: true, status: 'PARTLY_MET' },
        { final: true, status: 'ON_TRACK' },
        { final: false, status: 'CLAIM_FAILED' }, // still running: not counted
        null,
    ]);
    assert.deepStrictEqual(s, { claims: 4, met: 2, partly: 1, failed: 1, pct: 50 });
    assert.strictEqual(rules.recommendationScore([]).pct, null);
});

test('window sum counts only days inside the period', () => {
    const rows = [
        { Day: '2025-12-31', Value: 999 },
        { Day: '2026-01-01', Value: 100 },
        { Day: new Date('2026-03-31T00:00:00Z'), Value: 50 },
        { Day: '2026-04-01', Value: 999 },
    ];
    assert.strictEqual(rules.sumWindow(rows, '2026-01-01', '2026-03-31'), 150);
});
