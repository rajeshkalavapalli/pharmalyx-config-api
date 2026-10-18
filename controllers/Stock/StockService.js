const StockDA = require('./StockDA');

const { generateUUID } = require('../../utils/commonUtils');
const { auditQuery } = require('../../utils/audit');
const { getPermissions } = require('../../utils/permissions');
const VerifiedWorkDA = require('../VerifiedWork/VerifiedWorkDA');
const {
    fail,
    isGuid,
    optionalText,
    requireActingUser,
    requireManagerOf,
    resolveViewUser,
    todayKey,
    toDateKey,
} = require('../../utils/access');

const ITEM_TYPES = ['SAMPLE', 'GIFT'];
const MAX_QUANTITY = 10000;
const MAX_ITEMS_PER_VISIT = 20;

const toItemType = (value, required = true) => {
    if (!value && !required) return null;

    const type = String(value ?? '').toUpperCase();

    if (!ITEM_TYPES.includes(type)) throw fail(400, 'Item type must be SAMPLE or GIFT.');

    return type;
};

const toQuantity = (value, max = MAX_QUANTITY) => {
    const quantity = Number(value);

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > max) {
        throw fail(400, `Quantity must be a whole number between 1 and ${max}.`);
    }

    return quantity;
};

const requireItem = async (itemType, itemId) => {
    if (!isGuid(itemId)) throw fail(400, 'Item is invalid.');

    if (!(await StockDA.itemExists(itemType, itemId))) {
        throw fail(400, itemType === 'SAMPLE' ? 'This product is not available as a sample.' : 'This gift is not available.');
    }
};

const mapDbError = (error) => (error.number === 50021 ? fail(409, error.message) : error);

const monthStart = () => `${todayKey().slice(0, 8)}01`;

const number = (value) => Number(value) || 0;

// =========================================================
// READS
// =========================================================

exports.getBalances = async (actingUserId, query) => {
    const userId = await resolveViewUser(actingUserId, query.userId, 'stock');
    const rows = await StockDA.getBalances(userId, toItemType(query.itemType, false), monthStart());

    return {
        balances: rows.map((row) => ({
            ...row,
            Balance: number(row.Balance),
            TotalIssued: number(row.TotalIssued),
            TotalGiven: number(row.TotalGiven),
            GivenThisMonth: number(row.GivenThisMonth),
        })),
    };
};

exports.getLedger = async (actingUserId, query) => {
    const userId = await resolveViewUser(actingUserId, query.userId, 'stock');
    const today = todayKey();

    const ledger = await StockDA.getLedger({
        UserId: userId,
        ItemType: toItemType(query.itemType, false),
        FromDate: query.from ? toDateKey(query.from, 'From date') : `${today.slice(0, 4)}-01-01`,
        ToDate: query.to ? toDateKey(query.to, 'To date') : today,
    });

    return { ledger };
};

// =========================================================
// WRITES
// =========================================================

// A manager hands stock to a direct report.
exports.issueStock = async (actingUserId, payload) => {
    requireActingUser(actingUserId);
    await requireManagerOf(actingUserId, payload.UserId, 'issue stock to this user');

    const itemType = toItemType(payload.ItemType);
    await requireItem(itemType, payload.ItemId);

    const entry = {
        EntryId: generateUUID(),
        UserId: payload.UserId,
        ItemType: itemType,
        ItemId: payload.ItemId,
        EntryType: 'ISSUE',
        Quantity: toQuantity(payload.Quantity),
        DoctorId: null,
        VisitId: null,
        BatchNumber: optionalText(payload.BatchNumber, 50, 'Batch number'),
        Remarks: optionalText(payload.Remarks, 300, 'Remarks'),
        EntryDate: todayKey(),
        CreatedBy: actingUserId,
        CreatedOn: new Date(),
    };

    await StockDA.addEntry(entry);

    return { message: `${entry.Quantity} unit(s) issued.`, EntryId: entry.EntryId };
};

// The holder hands unused stock back (expired, damaged, surplus).
exports.returnStock = async (actingUserId, payload) => {
    requireActingUser(actingUserId);

    const itemType = toItemType(payload.ItemType);

    if (!isGuid(payload.ItemId)) throw fail(400, 'Item is invalid.');

    const entry = {
        EntryId: generateUUID(),
        UserId: actingUserId,
        ItemType: itemType,
        ItemId: payload.ItemId,
        EntryType: 'RETURN',
        Quantity: toQuantity(payload.Quantity),
        DoctorId: null,
        VisitId: null,
        Remarks: optionalText(payload.Remarks, 300, 'Reason'),
        EntryDate: todayKey(),
        CreatedBy: actingUserId,
        CreatedOn: new Date(),
    };

    try {
        await StockDA.removeEntry(entry);
    } catch (error) {
        throw mapDbError(error);
    }

    return { message: `${entry.Quantity} unit(s) returned.`, EntryId: entry.EntryId };
};

// =========================================================
// FOR VISITS
// =========================================================

// Validates items given during a visit and returns transaction queries for them.
// Each entry is stamped with who gave it (name, role), when and the visit's GPS. If the joint-work
// colleague (e.g. the manager) gave an item (GivenBy: 'JOINT'), it comes from their stock and is recorded as theirs.
exports.buildVisitDistribution = async ({ userId, doctorId, visitId, visitDate, items, jointWorkUserId = null, location = null }) => {
    if (items == null) return [];

    const givers = new Map();
    const giver = async (id) => {
        const key = String(id).toLowerCase();
        if (!givers.has(key)) givers.set(key, await VerifiedWorkDA.getUser(id));
        return givers.get(key);
    };
    const givenAt = new Date();

    if (!Array.isArray(items)) throw fail(400, 'Items given must be a list.');
    if (items.length > MAX_ITEMS_PER_VISIT) throw fail(400, `At most ${MAX_ITEMS_PER_VISIT} items per visit.`);

    const seen = new Set();
    const queries = [];

    for (const item of items) {
        const itemType = toItemType(item?.ItemType);
        const key = `${itemType}:${String(item.ItemId).toLowerCase()}`;

        if (seen.has(key)) throw fail(400, 'Each item can only be listed once per visit.');
        seen.add(key);

        if (!isGuid(item.ItemId)) throw fail(400, 'Item is invalid.');

        const byJoint = String(item.GivenBy || '').toUpperCase() === 'JOINT';
        if (byJoint && !jointWorkUserId) throw fail(400, 'Choose the joint-work colleague before marking an item as given by them.');
        const holderId = byJoint ? jointWorkUserId : userId;
        const person = await giver(holderId);

        queries.push(
            StockDA.giveEntryQuery({
                EntryId: generateUUID(),
                UserId: holderId,
                ItemType: itemType,
                ItemId: item.ItemId,
                Quantity: toQuantity(item.Quantity, 1000),
                DoctorId: doctorId,
                VisitId: visitId,
                Remarks: byJoint ? 'Given during joint work' : null,
                EntryDate: visitDate,
                CreatedBy: userId,
                CreatedOn: givenAt,
                GivenByUserId: holderId,
                GivenByName: person?.Name || null,
                GivenByRole: person?.DesignationName || person?.RoleName || null,
                GivenAt: givenAt,
                GivenLatitude: location?.Latitude ?? null,
                GivenLongitude: location?.Longitude ?? null,
            })
        );
    }

    return queries;
};

exports.mapDbError = mapDbError;

// =========================================================
// RECONCILIATION: issued vs given vs physical count
// =========================================================

// Lazy: VerifiedWorkService requires modules that require this one.
const resolveTarget = (...args) => require('../VerifiedWork/VerifiedWorkService').resolveTarget(...args);

exports.getReconciliation = async (actingUserId, query) => {
    const userId = await resolveTarget(actingUserId, query.userId);
    const [rows, history] = await Promise.all([StockDA.getReconciliation(userId), StockDA.getCountHistory(userId)]);

    return {
        userId,
        items: rows.map((row) => ({
            ...row,
            Issued: number(row.Issued),
            Given: number(row.Given),
            Returned: number(row.Returned),
            Expected: number(row.Expected),
            LastCountDifference: row.LastCounted == null ? null : number(row.LastCounted) - number(row.LastCountExpected),
        })),
        history,
    };
};

// Manager (of this MR) or head office records what is physically in the MR's bag.
exports.recordCount = async (actingUserId, payload) => {
    requireActingUser(actingUserId);
    const userId = await resolveTarget(actingUserId, payload.UserId);
    const permissions = await getPermissions(actingUserId);
    if (!permissions.has('stockcount.create')) throw fail(403, "You don't have permission to record stock counts.");
    if (String(userId).toLowerCase() === String(actingUserId).toLowerCase()) {
        throw fail(403, 'Your own stock must be counted by your manager or head office.');
    }

    const counts = Array.isArray(payload.Counts) ? payload.Counts : [];
    if (!counts.length) throw fail(400, 'Enter at least one counted item.');
    const remarks = optionalText(payload.Remarks, 500, 'Remarks');
    const now = new Date();

    const rows = [];
    for (const count of counts) {
        const itemType = toItemType(count.ItemType);
        if (!isGuid(count.ItemId)) throw fail(400, 'Item is invalid.');
        const counted = Number(count.CountedQty);
        if (!Number.isInteger(counted) || counted < 0 || counted > MAX_QUANTITY) throw fail(400, 'Counted quantity must be a whole number, 0 or more.');
        const expected = await StockDA.getItemBalance({ UserId: userId, ItemType: itemType, ItemId: count.ItemId });
        rows.push({ CountId: generateUUID(), UserId: userId, ItemType: itemType, ItemId: count.ItemId, ExpectedQty: expected, CountedQty: counted, CountedBy: actingUserId, CountedOn: now, Remarks: remarks });
    }

    await StockDA.insertCounts(
        rows,
        auditQuery({ entityType: 'STOCK_COUNT', entityId: userId, action: 'COUNT', actorId: actingUserId, reason: remarks, after: rows.map((r) => ({ item: r.ItemId, expected: r.ExpectedQty, counted: r.CountedQty })) })
    );

    const short = rows.filter((row) => row.CountedQty < row.ExpectedQty).length;
    return { message: short ? `Count saved. ${short} item(s) are short of the expected quantity.` : 'Count saved. Everything matches.' };
};

exports.getVisitItems = (visitId) => StockDA.getVisitItems(visitId);
