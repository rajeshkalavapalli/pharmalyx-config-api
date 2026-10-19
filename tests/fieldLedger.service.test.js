// Field ledger services with an in-memory database. Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { root, createFake, rejects } = require('./helpers/fakeDb');

const sql = require(path.join(root, 'controllers/FieldLedger/sql.js'));
const db = createFake([sql]);

const Ledger = require(path.join(root, 'controllers/FieldLedger/LedgerService.js'));
const HeadOffice = require(path.join(root, 'controllers/FieldLedger/HeadOfficeService.js'));
const Checks = require(path.join(root, 'controllers/FieldLedger/checks.js'));

const MR = '11111111-1111-1111-1111-111111111111';
const NEW_MR = '33333333-3333-3333-3333-333333333333';
const HO = '44444444-4444-4444-4444-444444444444';
const PH = 'ffffffff-0000-0000-0000-000000000001';
const P1 = 'cccccccc-0000-0000-0000-000000000001';
const B1 = 'bbbbbbbb-0000-0000-0000-000000000001';
const PHOTO = '0f0f0f0f-0000-0000-0000-000000000001.jpg';
const CHEMIST = { PharmacyId: PH, PharmacyName: 'Sri Medicals', TerritoryId: 'aaaaaaaa-0000-0000-0000-000000000001', AreaId: null, Latitude: 15.8238, Longitude: 80.3522 };

const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const daysAgo = (n) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
};

const here = (dLat = 0, extra = {}) => ({ status: 'CAPTURED', latitude: CHEMIST.Latitude + dLat, longitude: CHEMIST.Longitude, accuracy: 15, ...extra });
const delivery = (over = {}) => ({ PharmacyId: PH, ReceiptPhotoId: PHOTO, Location: here(), Lines: [{ BatchId: B1, Quantity: 10, UnitPrice: 1 }], ...over });

const setup = ({ dues = [], limit = null } = {}) => {
    db.reset();
    db.perms = { [HO.toLowerCase()]: new Set(['ledger.approve', 'ledger.view']), [MR.toLowerCase()]: new Set(['ledger.view', 'ledger.create']) };
    db.settings = [];
    db.products = [{ ProductId: P1, UnitPrice: 100 }];
    db.files = new Set([`ledger/${MR}/${PHOTO}`]);
    db.answers = {
        MY_CHEMISTS: [CHEMIST],
        STOCK_BALANCES: [{ ProductId: P1, ProductName: 'Alpha 10', BatchId: B1, BatchNumber: 'A1', ExpiryDate: '2027-12-31', Quantity: 50, Value: 4000 }],
        DUE_ENTRIES: dues,
        CREDIT_LIMITS: limit == null ? [] : [{ PharmacyId: PH, CreditLimit: limit }],
        RECEIPT_REUSED: [],
        USER: (inputs) => [{ UserId: inputs.UserId, Name: inputs.UserId === MR ? 'Ravi' : 'Kiran', ManagerId: null, IsActive: true }],
        OPEN_CLEARANCE_OF: [],
        BATCH: [{ BatchId: B1, ProductId: P1, BatchNumber: 'A1', ExpiryDate: '2027-12-31', ProductName: 'Alpha 10' }],
    };
};

test('MR delivers stock at the chemist: receipt photo, GPS, catalogue price; stock goes down and dues go up', async () => {
    setup();
    const result = await Ledger.createDelivery(MR, delivery());
    assert.match(result.message, /Rs 1,000/);
    const [d] = db.step('INSERT_DELIVERY');
    assert.strictEqual(d.TotalValue, 1000); // 10 x Rs 100 from the catalogue, not the Rs 1 sent by the app
    assert.ok(d.ReceiptStorageKey.endsWith(PHOTO));
    assert.strictEqual(d.ReceiptSha256.length, 64);
    assert.ok(d.DistanceFromChemistM < 20);
    const [out] = db.step('INSERT_OUTFLOW');
    assert.strictEqual(out.EntryType, 'DELIVERY');
    assert.strictEqual(out.Quantity, 10);
    assert.strictEqual(out.Value, 800); // stock value at the MR's average (4000 / 50 x 10)
    const [due] = db.step('INSERT_LEDGER');
    assert.strictEqual(due.EntryType, 'DELIVERY');
    assert.strictEqual(due.Amount, 1000);
    assert.ok(db.stepNames().includes('AUDIT'));
});

test('delivery is refused away from the chemist, without the receipt photo, with fake GPS, or with a reused receipt', async () => {
    setup();
    await rejects(() => Ledger.createDelivery(MR, delivery({ Location: here(0.01) })), 400, /from Sri Medicals/);
    await rejects(() => Ledger.createDelivery(MR, delivery({ ReceiptPhotoId: undefined })), 400, /stamped receipt/);
    await rejects(() => Ledger.createDelivery(MR, delivery({ Location: here(0, { isMock: true }) })), 400, /mock/);
    await rejects(() => Ledger.createDelivery(MR, delivery({ Location: { status: 'DENIED' } })), 400, /location/);
    db.answers.RECEIPT_REUSED = [{ DeliveryNumber: 'DL-000004' }];
    await rejects(() => Ledger.createDelivery(MR, delivery()), 409, /DL-000004/);
    assert.strictEqual(db.steps.length, 0);
});

test('delivery cannot exceed the stock in hand or go to a chemist that is not assigned', async () => {
    setup();
    await rejects(() => Ledger.createDelivery(MR, delivery({ Lines: [{ BatchId: B1, Quantity: 51 }] })), 400, /hold only 50/);
    await rejects(() => Ledger.createDelivery(MR, delivery({ PharmacyId: 'ffffffff-0000-0000-0000-000000000099' })), 400, /not assigned/);
});

test('chemist over the credit limit: delivery blocked, and a delivery that would cross the limit is blocked too', async () => {
    setup({ dues: [{ EntryId: 'e1', PharmacyId: PH, EntryDate: daysAgo(5), Amount: 9500 }], limit: 10000 });
    await rejects(() => Ledger.createDelivery(MR, delivery()), 409, /over the credit limit/);
    setup({ dues: [{ EntryId: 'e1', PharmacyId: PH, EntryDate: daysAgo(5), Amount: 12000 }], limit: 10000 });
    await rejects(() => Ledger.createDelivery(MR, delivery({ Lines: [{ BatchId: B1, Quantity: 1 }] })), 409, /over the credit limit/);
    assert.strictEqual(db.steps.length, 0);
});

test('chemist with dues older than 60 days: delivery and new POB are blocked', async () => {
    setup({ dues: [{ EntryId: 'e1', PharmacyId: PH, EntryDate: daysAgo(61), Amount: 500 }] });
    await rejects(() => Ledger.createDelivery(MR, delivery()), 409, /61 days old/);
    await rejects(() => Ledger.assertChemistCanOrder(PH), 409, /on hold/);
    setup({ dues: [{ EntryId: 'e1', PharmacyId: PH, EntryDate: daysAgo(61), Amount: 500 }, { EntryId: 'e2', PharmacyId: PH, EntryDate: daysAgo(1), Amount: -500 }] });
    await Ledger.assertChemistCanOrder(PH); // paid up: allowed again
});

test('payment: cash needs a receipt photo, others a reference; never more than owed; stays with the MR until head office confirms', async () => {
    setup({ dues: [{ EntryId: 'e1', PharmacyId: PH, EntryDate: daysAgo(10), Amount: 3000 }] });
    await rejects(() => Ledger.createPayment(MR, { PharmacyId: PH, Amount: 1000, Mode: 'CASH' }), 400, /payment receipt/);
    await rejects(() => Ledger.createPayment(MR, { PharmacyId: PH, Amount: 1000, Mode: 'UPI' }), 400, /reference/);
    await rejects(() => Ledger.createPayment(MR, { PharmacyId: PH, Amount: 3500, Mode: 'UPI', Reference: 'UTR123' }), 400, /owes Rs 3,000/);
    await Ledger.createPayment(MR, { PharmacyId: PH, Amount: 1000, Mode: 'CASH', ReceiptPhotoId: PHOTO });
    const [row] = db.step('INSERT_LEDGER');
    assert.strictEqual(row.Amount, -1000);
    assert.strictEqual(row.DepositStatus, 'WITH_MR');
    assert.strictEqual(row.PaymentMode, 'CASH');
});

test('only head office issues stock; issues above the MR stock limit (Rs 25,000) are blocked', async () => {
    setup();
    await rejects(() => HeadOffice.issueStock(MR, { UserId: MR, BatchId: B1, Quantity: 1, Value: 100 }), 403, /head office/);
    // MR already holds Rs 4,000.
    await rejects(() => HeadOffice.issueStock(HO, { UserId: MR, BatchId: B1, Quantity: 100, Value: 21001 }), 409, /over the limit of Rs 25,000/);
    await HeadOffice.issueStock(HO, { UserId: MR, BatchId: B1, Quantity: 100, Value: 21000 });
    const [row] = db.step('INSERT_ISSUE');
    assert.strictEqual(row.Limit, 25000);
    assert.strictEqual(row.UnitValue, 210);
    db.answers.OPEN_CLEARANCE_OF = [{ ClearanceId: 'x' }];
    await rejects(() => HeadOffice.issueStock(HO, { UserId: MR, BatchId: B1, Quantity: 1, Value: 100 }), 409, /leaving/);
});

test('exit clearance lists stock in hand, unpaid dues from the MR\'s deliveries, money with the MR and pending spend', async () => {
    setup({
        dues: [
            { EntryId: 'e1', PharmacyId: PH, EntryDate: daysAgo(20), Amount: 1000, DeliveryId: 'd-mine', DeliveredBy: MR },
            { EntryId: 'e2', PharmacyId: PH, EntryDate: daysAgo(10), Amount: 700, DeliveryId: 'd-other', DeliveredBy: NEW_MR },
            { EntryId: 'e3', PharmacyId: PH, EntryDate: daysAgo(2), Amount: -400 },
        ],
    });
    db.answers.CHEMISTS_DELIVERED_BY = [{ PharmacyId: PH }];
    db.answers.PHARMACY_NAMES = [{ PharmacyId: PH, PharmacyName: 'Sri Medicals' }];
    db.answers.PAYMENTS_WITH_MR = [{ EntryId: 'p1', PharmacyName: 'Sri Medicals', EntryDate: daysAgo(2), Amount: 400, PaymentMode: 'CASH' }];
    db.answers.PENDING_SPEND = [{ RequestId: 'r1', RequestNumber: 'SR-000001', Status: 'APPROVED', Amount: 15000, DoctorName: 'Rao' }];

    const items = await HeadOffice._test.buildItems(MR);
    const byType = Object.fromEntries(items.map((i) => [i.ItemType, i]));
    assert.strictEqual(byType.STOCK.Quantity, 50);
    assert.strictEqual(byType.CHEMIST_DUES.Amount, 600); // Rs 1,000 delivered by this MR, Rs 400 paid against the oldest due
    assert.strictEqual(byType.PAYMENT_WITH_MR.Amount, 400);
    assert.strictEqual(byType.PENDING_SPEND.Amount, 15000);

    await HeadOffice.createClearance(HO, { UserId: MR, LeavingDate: today, SuccessorUserId: NEW_MR, Reason: 'Resigned' });
    assert.strictEqual(db.step('INSERT_CLEARANCE').length, 1);
    assert.strictEqual(db.step('INSERT_ITEM').length, 4);
});

test('full and final stays on hold until head office closes every item; items need a note', async () => {
    setup();
    db.answers.GET_ITEM = [{ ItemId: 'i1', ClearanceStatus: 'OPEN', Label: 'Stock', Amount: 100 }];
    await rejects(() => HeadOffice.closeItem(HO, '99999999-9999-9999-9999-999999999999', { Note: 'ok' }), 400, /how it was settled/);
    await HeadOffice.closeItem(HO, '99999999-9999-9999-9999-999999999999', { Note: 'Stock returned to the depot' });
    assert.strictEqual(db.step('CLOSE_ITEM').length, 1);
    await rejects(() => HeadOffice.closeItem(MR, '99999999-9999-9999-9999-999999999999', { Note: 'Stock returned to the depot' }), 403);
    db.throwOnRun = 'Close every item first: full and final stays on hold until then.';
    await rejects(() => HeadOffice.closeClearance(HO, '99999999-9999-9999-9999-999999999999'), 409, /on hold/);
});

test('handover moves chemists and doctors and transfers stock in hand to the new MR', async () => {
    setup();
    db.answers.GET_CLEARANCE = [{ ClearanceId: 'c1', UserId: MR, SuccessorUserId: NEW_MR, HandedOverOn: null, CreatedBy: HO }];
    db.answers['HANDOVER_MAPPINGS:result'] = [{ Chemists: 3, Doctors: 12 }];
    const r = await HeadOffice.handoverNow(HO, '99999999-9999-9999-9999-999999999999');
    assert.match(r.message, /3 chemist\(s\), 12 doctor\(s\), 1 batch/);
    const [out] = db.step('INSERT_OUTFLOW');
    const [inn] = db.step('INSERT_TRANSFER_IN');
    assert.strictEqual(out.EntryType, 'TRANSFER_OUT');
    assert.strictEqual(out.UserId, MR);
    assert.strictEqual(inn.UserId, NEW_MR);
    assert.strictEqual(inn.Quantity, 50);
    assert.strictEqual(db.step('HANDOVER_MAPPINGS')[0].SuccessorUserId, NEW_MR);
});

test('automatic check flags stock held more than 15 days (once per lot) and hands over on the leaving date', async () => {
    setup();
    const queries = [];
    const handed = [];
    const rows = [
        { UserId: MR, UserName: 'Ravi', BatchId: B1, BatchNumber: 'A1', ProductName: 'Alpha 10', EntryDate: daysAgo(20), Quantity: 10 },
        { UserId: MR, UserName: 'Ravi', BatchId: B1, BatchNumber: 'A1', ProductName: 'Alpha 10', EntryDate: daysAgo(3), Quantity: 10 },
        { UserId: MR, UserName: 'Ravi', BatchId: B1, BatchNumber: 'A1', ProductName: 'Alpha 10', EntryDate: daysAgo(1), Quantity: -4 },
    ];
    const deps = {
        query: async (text, inputs) => {
            queries.push({ text, inputs });
            if (text === sql.LOT_ENTRIES()) return rows;
            if (text === sql.HANDOVER_DUE()) return [{ ClearanceId: 'c9' }];
            return [];
        },
        handover: async (id) => handed.push(id),
    };
    const raised = await Checks.sweep(new Date(), deps);
    assert.strictEqual(raised, 1);
    const flag = queries.find((x) => x.inputs.FlagType === 'STOCK_HELD_LONG').inputs;
    assert.match(flag.Details, /held 6 of Alpha 10/);
    assert.strictEqual(flag.SubjectKey, `HELD|${MR}|${B1}|${daysAgo(20)}`);
    assert.deepStrictEqual(handed, ['c9']);
});
