// Doctor spend services with an in-memory database. Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { root, createFake, rejects } = require('./helpers/fakeDb');

const sql = require(path.join(root, 'controllers/DoctorSpend/sql.js'));
const db = createFake([sql]);
const Spend = require(path.join(root, 'controllers/DoctorSpend/SpendService.js'));

const MR = '11111111-1111-1111-1111-111111111111';
const MGR = '22222222-2222-2222-2222-222222222222';
const HO = '44444444-4444-4444-4444-444444444444';
const DR = 'dddddddd-0000-0000-0000-000000000001';
const T1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const TYPE = '77777777-0000-0000-0000-000000000001';
const REQ = '88888888-0000-0000-0000-000000000001';
const DOC = '0f0f0f0f-0000-0000-0000-000000000001.pdf';

const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const daysAgo = (n) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
};

// An earlier request for the same doctor: paid 200 days ago, promised Rs 3,00,000 in 3 months.
const oldRequest = (over = {}) => ({
    RequestId: '88888888-0000-0000-0000-0000000000aa',
    RequestNumber: 'SR-000001',
    UserId: MR,
    UserName: 'Ravi',
    ManagerId: MGR,
    ManagerName: 'Meena',
    DoctorId: DR,
    DoctorName: 'Rao',
    TerritoryId: T1,
    TerritoryName: 'Ongole',
    AreaId: null,
    TypeName: 'CME sponsorship',
    Amount: 20000,
    ExpectedBusiness: 300000,
    PeriodMonths: 3,
    Status: 'DISBURSED',
    ManagerRecommendation: 'RECOMMEND',
    DisbursedAmount: 20000,
    DisbursedDate: daysAgo(200),
    ...over,
});

const setup = ({ requests = [], net = [] } = {}) => {
    db.reset();
    db.perms = {
        [MR.toLowerCase()]: new Set(['spend.view', 'spend.create']),
        [MGR.toLowerCase()]: new Set(['spend.view', 'spend.edit']),
        [HO.toLowerCase()]: new Set(['spend.view', 'spend.approve']),
    };
    db.scope = { [MGR.toLowerCase()]: [{ UserId: MGR }, { UserId: MR }] };
    db.settings = [];
    db.files = new Set([`spend/${HO}/${DOC}`]);
    db.answers = {
        MY_DOCTORS: [{ DoctorId: DR, DoctorName: 'Rao', TerritoryId: T1, AreaId: null }],
        GET_TYPE: [{ TypeId: TYPE, TypeName: 'CME sponsorship', MaxAmount: 25000, IsActive: true }],
        USER: [{ UserId: MR, Name: 'Ravi', ManagerId: MGR, TerritoryId: T1 }],
        REQUESTS: requests,
        NET_DAILY: net,
        'INSERT_REQUEST:result': [{ RequestNumber: 'SR-000002' }],
    };
};

const newRequest = (over = {}) => ({ DoctorId: DR, TypeId: TYPE, Amount: 15000, Purpose: 'CME on diabetes for 40 GPs', ExpectedBusiness: 250000, PeriodMonths: 3, ...over });

test('MR raises a request for an allowed activity within its limit; it goes to the manager', async () => {
    setup();
    const r = await Spend.createRequest(MR, newRequest());
    assert.match(r.message, /SR-000002 sent to your manager/);
    const [row] = db.step('INSERT_REQUEST');
    assert.strictEqual(row.ManagerId, MGR);
    assert.strictEqual(row.TerritoryId, T1);
    assert.strictEqual(row.PriorFailedClaims, 0);
    assert.strictEqual(db.step('INSERT_FLAG').length, 0);

    await rejects(() => Spend.createRequest(MR, newRequest({ Amount: 30000 })), 400, /most allowed/);
    await rejects(() => Spend.createRequest(MR, newRequest({ PeriodMonths: 4 })), 400, /3 or 6/);
    await rejects(() => Spend.createRequest(MR, newRequest({ DoctorId: 'dddddddd-0000-0000-0000-000000000099' })), 400, /not assigned/);
    db.answers.GET_TYPE = [{ TypeId: TYPE, TypeName: 'Gifts', MaxAmount: 25000, IsActive: false }];
    await rejects(() => Spend.createRequest(MR, newRequest()), 400, /allowed by head office/);
});

test('a claim whose period ended with too little business is "Claim failed", and the score shows it', async () => {
    setup({ requests: [oldRequest()], net: [{ TerritoryId: T1, Day: daysAgo(190), Value: 60000 }] });
    const { requests } = await Spend.listRequests(HO, {});
    const [r] = requests;
    assert.strictEqual(r.outcome.final, true);
    assert.strictEqual(r.outcome.status, 'CLAIM_FAILED');
    assert.strictEqual(r.outcome.actual, 60000);
    assert.deepStrictEqual(r.requesterScore, { claims: 1, met: 0, partly: 0, failed: 1, pct: 0 });
    assert.deepStrictEqual(r.managerScore, { claims: 1, met: 0, partly: 0, failed: 1, pct: 0 });
});

test('a new request for a doctor whose earlier claim failed is flagged for head office', async () => {
    setup({ requests: [oldRequest()], net: [{ TerritoryId: T1, Day: daysAgo(190), Value: 60000 }] });
    const r = await Spend.createRequest(MR, newRequest());
    assert.match(r.message, /earlier claim for this doctor failed/);
    assert.strictEqual(db.step('INSERT_REQUEST')[0].PriorFailedClaims, 1);
    const [flag] = db.step('INSERT_FLAG');
    assert.strictEqual(flag.FlagType, 'SPEND_PRIOR_FAILED');
    assert.match(flag.Details, /SR-000001/);
});

test('a met claim is "On track" and counts towards the score', async () => {
    setup({ requests: [oldRequest()], net: [{ TerritoryId: T1, Day: daysAgo(150), Value: 290000 }] });
    const [r] = (await Spend.listRequests(HO, {})).requests;
    assert.strictEqual(r.outcome.status, 'ON_TRACK');
    assert.strictEqual(r.requesterScore.pct, 100);
});

test('the manager only recommends; only head office approves, with the compliance check', async () => {
    setup();
    db.answers.GET_REQUEST = [{ RequestId: REQ, UserId: MR, ManagerId: MGR, CurrentManagerId: MGR, Status: 'REQUESTED', Amount: 15000, PeriodMonths: 3 }];
    await rejects(() => Spend.recommend(HO, REQ, { Recommendation: 'RECOMMEND', Note: 'Good doctor, high potential' }), 403, /reporting manager/);
    await rejects(() => Spend.decide(MGR, REQ, { Decision: 'APPROVED', ComplianceConfirmed: true, Note: 'Looks fine to me' }), 403, /head office/);
    await rejects(() => Spend.decide(HO, REQ, { Decision: 'APPROVED', ComplianceConfirmed: true, Note: 'Looks fine to me' }), 409, /manager's recommendation/);

    await Spend.recommend(MGR, REQ, { Recommendation: 'RECOMMEND', Note: 'Doctor writes 30 Rx a week' });
    assert.strictEqual(db.step('RECOMMEND')[0].Recommendation, 'RECOMMEND');

    db.answers.GET_REQUEST = [{ RequestId: REQ, UserId: MR, ManagerId: MGR, Status: 'RECOMMENDED', Amount: 15000, PeriodMonths: 3 }];
    await rejects(() => Spend.decide(HO, REQ, { Decision: 'APPROVED', Note: 'Documented CME, agenda attached' }), 400, /compliance/);
    await Spend.decide(HO, REQ, { Decision: 'APPROVED', ComplianceConfirmed: true, Note: 'Documented CME, agenda attached' });
    const [d] = db.step('DECIDE');
    assert.strictEqual(d.Decision, 'APPROVED');
    assert.strictEqual(d.Compliance, 1);
    assert.strictEqual(d.FromStatus, 'RECOMMENDED');
});

test('head office records the payment once, not above the approved amount, with a supporting document', async () => {
    setup();
    db.answers.GET_REQUEST = [{ RequestId: REQ, UserId: MR, ManagerId: MGR, Status: 'APPROVED', Amount: 15000, PeriodMonths: 3 }];
    const pay = (over = {}) => ({ Amount: 14500, DisbursedDate: today, Method: 'BANK', Reference: 'NEFT123', DocumentId: DOC, ...over });
    await rejects(() => Spend.disburse(HO, REQ, pay({ Amount: 16000 })), 400, /more than the approved/);
    await rejects(() => Spend.disburse(HO, REQ, pay({ DocumentId: undefined })), 400, /supporting document/);
    await rejects(() => Spend.disburse(MGR, REQ, pay()), 403);
    await Spend.disburse(HO, REQ, pay());
    const [row] = db.step('DISBURSE');
    assert.strictEqual(row.Amount, 14500);
    assert.strictEqual(row.Method, 'BANK');
    assert.ok(row.DocKey.endsWith(DOC));
    db.answers.GET_REQUEST = [{ RequestId: REQ, UserId: MR, Status: 'DISBURSED', Amount: 15000 }];
    await rejects(() => Spend.disburse(HO, REQ, pay()), 409, /only once/);
});

test('activity types: head office only, with the UCPMP 2024 legal confirmation', async () => {
    setup();
    await rejects(() => Spend.saveType(MGR, null, { TypeName: 'CME sponsorship', MaxAmount: 25000, LegalConfirmed: true }), 403);
    await rejects(() => Spend.saveType(HO, null, { TypeName: 'CME sponsorship', MaxAmount: 25000 }), 400, /UCPMP 2024/);
    await Spend.saveType(HO, null, { TypeName: 'CME sponsorship', MaxAmount: 25000, LegalConfirmed: true });
    assert.strictEqual(db.step('INSERT_TYPE')[0].MaxAmount, 25000);
    assert.match((await Spend.getConfig(HO)).ucpmpNote, /UCPMP\) 2024/);
});

test('managers see their team\'s requests; an MR sees only their own', async () => {
    const other = oldRequest({ RequestId: '88888888-0000-0000-0000-0000000000bb', RequestNumber: 'SR-000009', UserId: '55555555-5555-5555-5555-555555555555' });
    setup({ requests: [oldRequest(), other] });
    assert.deepStrictEqual((await Spend.listRequests(MGR, {})).requests.map((r) => r.RequestNumber), ['SR-000001']);
    assert.deepStrictEqual((await Spend.listRequests(MR, {})).requests.map((r) => r.RequestNumber), ['SR-000001']);
    assert.strictEqual((await Spend.listRequests(HO, {})).requests.length, 2);
});
