// Pure rules of the field ledger. Run: npm test
const test = require('node:test');
const assert = require('node:assert');

const rules = require('../controllers/FieldLedger/rules');

test('stock totals: issued, delivered, returned and the balance in hand', () => {
    const t = rules.stockTotals([
        { EntryType: 'ISSUE', Quantity: 100, Value: 10000 },
        { EntryType: 'DELIVERY', Quantity: -30, Value: -3000 },
        { EntryType: 'RETURN', Quantity: -10, Value: -1000 },
        { EntryType: 'TRANSFER_IN', Quantity: 5, Value: 500 },
    ]);
    assert.deepStrictEqual(t, { issued: 100, transferredIn: 5, delivered: 30, returned: 10, transferredOut: 0, balanceQty: 65, balanceValue: 6500 });
});

test('stock leaving the MR is valued at the average unit value, and the last units take the rest', () => {
    assert.strictEqual(rules.outflowValue(3, 100, 1), 33.33);
    assert.strictEqual(rules.outflowValue(3, 100, 3), 100);
    assert.strictEqual(rules.outflowValue(0, 0, 2), 0);
});

test('open lots: deliveries use the oldest stock first', () => {
    const lots = rules.openLots([
        { EntryDate: '2026-09-01', Quantity: 10 },
        { EntryDate: '2026-09-20', Quantity: 10 },
        { EntryDate: '2026-09-25', Quantity: -12 },
    ]);
    assert.deepStrictEqual(lots, [{ date: '2026-09-20', quantity: 8 }]);
});

test('held too long: only lots older than the limit are flagged', () => {
    const lots = [
        { date: '2026-09-01', quantity: 5 },
        { date: '2026-10-10', quantity: 5 },
    ];
    const held = rules.heldTooLong(lots, '2026-10-18', 15);
    assert.strictEqual(held.length, 1);
    assert.strictEqual(held[0].ageDays, 47);
});

test('issue limit: allowed up to the limit, blocked above it', () => {
    assert.strictEqual(rules.issueCheck(20000, 5000, 25000).allowed, true);
    const blocked = rules.issueCheck(20000, 5001, 25000);
    assert.strictEqual(blocked.allowed, false);
    assert.strictEqual(blocked.after, 25001);
});

test('dues ageing: payments settle the oldest dues first; buckets 0-30, 31-60, 61-90, 90+', () => {
    const a = rules.dueAgeing(
        [
            { EntryDate: '2026-06-01', Amount: 1000, DeliveryId: 'd1' }, // 139 days
            { EntryDate: '2026-08-01', Amount: 2000, DeliveryId: 'd2' }, // 78 days
            { EntryDate: '2026-09-10', Amount: 3000, DeliveryId: 'd3' }, // 38 days
            { EntryDate: '2026-10-10', Amount: 4000, DeliveryId: 'd4' }, // 8 days
            { EntryDate: '2026-10-15', Amount: -1500 }, // pays d1 fully and 500 of d2
        ],
        '2026-10-18'
    );
    assert.strictEqual(a.balance, 8500);
    assert.deepStrictEqual(a.buckets, { d0_30: 4000, d31_60: 3000, d61_90: 1500, d90_plus: 0 });
    assert.strictEqual(a.oldestDays, 78);
    assert.strictEqual(a.unpaid[0].ref, 'd2');
});

test('dues ageing: paying everything leaves nothing old', () => {
    const a = rules.dueAgeing([{ EntryDate: '2026-01-01', Amount: 500 }, { EntryDate: '2026-02-01', Amount: -500 }], '2026-10-18');
    assert.strictEqual(a.balance, 0);
    assert.strictEqual(a.oldestDays, 0);
});

test('credit rule: blocks over the limit, when a delivery would cross it, or when dues are too old', () => {
    assert.strictEqual(rules.creditCheck({ balance: 900, oldestDays: 10, limit: 1000, addAmount: 0, blockDays: 60 }).blocked, false);
    assert.strictEqual(rules.creditCheck({ balance: 900, oldestDays: 10, limit: 1000, addAmount: 200, blockDays: 60 }).blocked, true);
    assert.strictEqual(rules.creditCheck({ balance: 1200, oldestDays: 10, limit: 1000, blockDays: 60 }).blocked, true);
    const old = rules.creditCheck({ balance: 100, oldestDays: 61, limit: null, blockDays: 60 });
    assert.strictEqual(old.blocked, true);
    assert.match(old.reasons[0], /61 days old/);
    assert.strictEqual(rules.creditCheck({ balance: 50000, oldestDays: 60, limit: null, blockDays: 60 }).blocked, false);
});

test('fill rate: supplied / raised by count and value; flagged under the minimum', () => {
    const ok = rules.fillRate({ raised: 10, raisedValue: 10000, supplied: 9, suppliedValue: 9500 }, 80);
    assert.deepStrictEqual(ok, { countPct: 90, valuePct: 95, flagged: false });
    assert.strictEqual(rules.fillRate({ raised: 10, raisedValue: 10000, supplied: 9, suppliedValue: 7000 }, 80).flagged, true);
    assert.strictEqual(rules.fillRate({ raised: 0, raisedValue: 0, supplied: 0, suppliedValue: 0 }, 80).flagged, false);
});

test('spend ratio: flagged above the maximum %, or spend with no sales', () => {
    assert.deepStrictEqual(rules.spendRatio(3000, 10000, 30), { pct: 30, flagged: false });
    assert.deepStrictEqual(rules.spendRatio(3100, 10000, 30), { pct: 31, flagged: true });
    assert.deepStrictEqual(rules.spendRatio(500, 0, 30), { pct: null, flagged: true });
    assert.deepStrictEqual(rules.spendRatio(0, 0, 30), { pct: null, flagged: false });
});

test('focus: business per rupee of effort, most responsive first', () => {
    const ranked = rules.rankByFocus(
        [
            { name: 'A', business: 10000, spend: 5000, visits: 10 }, // effort 10000 -> 1
            { name: 'B', business: 9000, spend: 1000, visits: 2 }, // effort 2000 -> 4.5
            { name: 'C', business: 0, spend: 2000, visits: 4 }, // 0
        ],
        500
    );
    assert.deepStrictEqual(ranked.map((r) => r.name), ['B', 'A', 'C']);
    assert.strictEqual(ranked[0].score, 4.5);
});
