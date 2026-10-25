// Visit results: counted / needs a look (still counts) / not counted.
const test = require('node:test');
const assert = require('node:assert/strict');

const rules = require('../controllers/VerifiedWork/rules');

const settings = { GEOFENCE_METERS: 200, MIN_DWELL_MINUTES: 3, MAX_WALK_KMH: 12, UNPINNED_CLINIC_VALID: 0, REQUIRE_BOUNDARY: 0 };
const at = (minute) => new Date(Date.UTC(2026, 9, 20, 5, minute)).toISOString();
const fix = (minute, extra = {}) => ({ at: at(minute), lat: 12.9, lng: 77.6, accuracy: 10, isMock: false, activity: 'STILL', ...extra });
const clinic = { lat: 12.9, lng: 77.6, radius: 200 };
const territory = { polygons: [], exception: null };
const judge = (extra) => rules.judgeVisit({ checkIn: fix(0), checkOut: fix(5), clinic, territory, settings, ...extra });

test('a normal visit is counted', () => {
    assert.equal(judge({}).validity, 'VALID');
});

test('soft reasons only: needs a look, and it still counts', () => {
    assert.equal(judge({ checkOut: fix(2) }).validity, 'REVIEW'); // short but real stop (2 min)
    assert.equal(judge({ clinic: { lat: 12.905, lng: 77.6, radius: 200 } }).validity, 'REVIEW'); // ~550 m away
    assert.equal(judge({ clinic: null }).validity, 'REVIEW'); // clinic not pinned
    assert.ok(rules.COUNTED.includes('REVIEW'));
});

test('a quick call of seconds still counts (needs a look); patterns are caught per day', () => {
    const seconds = { at: new Date(Date.parse(at(0)) + 10000).toISOString(), lat: 12.9, lng: 77.6, accuracy: 10, isMock: false, activity: 'STILL' };
    const result = judge({ checkOut: seconds });
    assert.equal(result.validity, 'REVIEW');
    assert.ok(result.reasons.includes('NO_REAL_STOP'));
});

test('hard evidence: not counted', () => {
    assert.equal(judge({ checkIn: fix(0, { isMock: true }) }).validity, 'INVALID');
    assert.equal(judge({ overlaps: true }).validity, 'INVALID');
    assert.equal(judge({ onLeave: true }).validity, 'INVALID');
    assert.equal(judge({ checkIn: null }).validity, 'INVALID');
});

test('one hard reason outweighs soft ones', () => {
    assert.equal(rules.validityFor(['SHORT_STOP', 'OVERLAP']), 'INVALID');
    assert.equal(rules.validityFor(['SHORT_STOP', 'AWAY_FROM_CLINIC', 'IN_VEHICLE']), 'REVIEW');
    assert.equal(rules.validityFor([]), 'VALID');
});
