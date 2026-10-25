// Day checks: which work days go on hold for review (never cut automatically).
const test = require('node:test');
const assert = require('node:assert/strict');

const { findingsForDay } = require('../controllers/VerifiedWork/dayChecks');
const { DEFAULTS } = require('../controllers/VerifiedWork/rules');

const at = (minute, second = 0) => new Date(Date.UTC(2026, 9, 23, 4, 0) + minute * 60000 + second * 1000).toISOString();
const visit = (minute, extra = {}) => ({ CheckInAt: at(minute), Latitude: 13.3, Longitude: 79.5, HospitalId: null, AreaId: 'A1', DoctorName: 'Dr', ...extra });
const codes = (findings) => findings.map((f) => f.code);

test('8 visits in one minute: on hold (rapid visits)', () => {
    const visits = Array.from({ length: 8 }, (_, i) => visit(0, { CheckInAt: at(0, i * 7) }));
    assert.deepEqual(codes(findingsForDay(visits, { station: 'HQ', km: 0, points: 10 }, DEFAULTS)), ['RAPID_VISITS']);
});

test('quick calls spread over the day at different places: nothing unusual', () => {
    const visits = [0, 35, 80, 130, 190, 240].map((m, i) => visit(m, { Latitude: 13.3 + i * 0.02, AreaId: `A${i}` }));
    assert.deepEqual(findingsForDay(visits, { station: 'EX_HQ', km: 42, points: 30 }, DEFAULTS), []);
});

test('several doctors in one hospital within minutes: nothing unusual', () => {
    const visits = Array.from({ length: 5 }, (_, i) => visit(i, { HospitalId: 'H1' }));
    assert.deepEqual(findingsForDay(visits, { station: 'HQ', km: 2, points: 8 }, DEFAULTS), []);
});

test('doctors of different areas all reported from one place: on hold (one spot)', () => {
    const visits = [0, 40, 90, 150, 210].map((m, i) => visit(m, { AreaId: `A${i % 3}` }));
    assert.ok(codes(findingsForDay(visits, { station: 'HQ', km: 1, points: 12 }, DEFAULTS)).includes('ONE_SPOT'));
});

test('Ex-HQ day with almost no travel on the location trail: on hold', () => {
    const visits = [visit(0, { AreaId: 'A1' }), visit(60, { Latitude: 13.31, AreaId: 'A2' })];
    assert.deepEqual(codes(findingsForDay(visits, { station: 'EX_HQ', km: 2.3, points: 20 }, DEFAULTS)), ['NO_FIELD_TRAVEL']);
});

test('no location trail at all: not held for travel (nothing to judge)', () => {
    assert.deepEqual(findingsForDay([visit(0)], { station: 'OUTSTATION', km: 0, points: 0 }, DEFAULTS), []);
});
