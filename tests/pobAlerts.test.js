// Unsupplied POB alert (to head office) and the chemist credit hold on new POBs. Run: npm test
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { root, stub, createFake, rejects } = require('./helpers/fakeDb');

const ledgerSql = require(path.join(root, 'controllers/FieldLedger/sql.js'));
const db = createFake([ledgerSql]);

const MR = '11111111-1111-1111-1111-111111111111';
const PH = 'ffffffff-0000-0000-0000-000000000001';
const ST = 'bbbbbbbb-0000-0000-0000-000000000001';
const P1 = 'cccccccc-0000-0000-0000-000000000001';
const PHOTO = '0f0f0f0f-0000-0000-0000-000000000001.jpg';
const CHEMIST = { PharmacyId: PH, PharmacyName: 'Sri Medicals', Latitude: 15.8238, Longitude: 80.3522 };

let created = null;
stub('controllers/Orders/OrdersDA.js', {
    getMyDoctors: async () => [],
    getMyPharmacies: async () => [CHEMIST],
    getMyStockists: async () => [{ StockistId: ST }],
    getOrderableProducts: async () => [{ ProductId: P1, ProductName: 'Alpha 10', UnitPrice: 100 }],
    createOrder: async (order) => {
        created = order;
    },
    getOrder: async () => ({ OrderNumber: 'POB-000123', CreatedOn: new Date(), CustomerName: 'Sri Medicals' }),
    pinPharmacyQuery: (inputs) => ({ pin: inputs }),
    followUpDue: async () => [],
    hasTeam: async () => false,
});

const OrderChecks = require(path.join(root, 'controllers/BusinessTracking/orderChecks.js'));
const Orders = require(path.join(root, 'controllers/Orders/OrdersService.js'));

const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const daysAgo = (n) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
};

const pob = () => ({
    CustomerType: 'CHEMIST',
    PharmacyId: PH,
    StockistId: ST,
    Lines: [{ ProductId: P1, Quantity: 10 }],
    SlipPhotoId: PHOTO,
    Location: { status: 'CAPTURED', latitude: CHEMIST.Latitude, longitude: CHEMIST.Longitude, accuracy: 15 },
});

test('a POB not supplied within 4 days is flagged to head office, once per order', async () => {
    db.reset();
    const saved = [];
    const deps = {
        query: async (text, inputs) => {
            if (text === OrderChecks._sql.UNSUPPLIED) {
                assert.strictEqual(inputs.Days, 4);
                return [{ OrderId: 'o1', OrderNumber: 'POB-000045', UserId: MR, OrderDate: daysAgo(6), NetAmount: 4200, Status: 'BOOKED', CustomerName: 'Sri Medicals', StockistName: 'Lakshmi Agencies' }];
            }
            return [];
        },
        save: async (flags) => {
            saved.push(...flags);
            return flags.length;
        },
    };
    await OrderChecks.sweep(new Date(), deps);
    const flag = saved.find((f) => f.FlagType === 'POB_UNSUPPLIED');
    assert.ok(flag, 'unsupplied flag raised');
    assert.strictEqual(flag.UserId, MR);
    assert.strictEqual(flag.SubjectKey, 'UNSUPPLIED|o1');
    assert.match(flag.Details, /not supplied after 6 days/);
});

test('the unsupplied alert uses the company setting', async () => {
    db.settings = [{ SettingKey: 'UNSUPPLIED_ALERT_DAYS', SettingValue: 7 }];
    let days = null;
    await OrderChecks.sweep(new Date(), {
        query: async (text, inputs) => {
            if (text === OrderChecks._sql.UNSUPPLIED) days = inputs.Days;
            return [];
        },
        save: async () => 0,
    });
    assert.strictEqual(days, 7);
    db.settings = [];
});

test('a new POB is refused for a chemist whose dues are older than 60 days, and allowed once paid', async () => {
    db.reset();
    db.files = new Set([`pob/${MR}/${PHOTO}`]);
    db.answers = { DUE_ENTRIES: [{ EntryId: 'e1', PharmacyId: PH, EntryDate: daysAgo(70), Amount: 2500 }], CREDIT_LIMITS: [] };
    created = null;
    await rejects(() => Orders.createOrder(MR, pob()), 409, /on hold: dues are 70 days old/);
    assert.strictEqual(created, null);

    db.answers.DUE_ENTRIES = [{ EntryId: 'e1', PharmacyId: PH, EntryDate: daysAgo(70), Amount: 2500 }, { EntryId: 'e2', PharmacyId: PH, EntryDate: daysAgo(1), Amount: -2500 }];
    await Orders.createOrder(MR, pob());
    assert.ok(created, 'order booked');
});

test('a new POB is refused for a chemist over the credit limit', async () => {
    db.reset();
    db.answers = { DUE_ENTRIES: [{ EntryId: 'e1', PharmacyId: PH, EntryDate: daysAgo(3), Amount: 12000 }], CREDIT_LIMITS: [{ PharmacyId: PH, CreditLimit: 10000 }] };
    await rejects(() => Orders.createOrder(MR, pob()), 409, /over the credit limit/);
});
