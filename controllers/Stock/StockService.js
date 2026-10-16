const StockDA = require('./StockDA');

const { generateUUID } = require('../../utils/commonUtils');
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
exports.buildVisitDistribution = async ({ userId, doctorId, visitId, visitDate, items }) => {
    if (items == null) return [];

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

        queries.push(
            StockDA.removeEntryQuery({
                EntryId: generateUUID(),
                UserId: userId,
                ItemType: itemType,
                ItemId: item.ItemId,
                EntryType: 'DISTRIBUTION',
                Quantity: toQuantity(item.Quantity, 1000),
                DoctorId: doctorId,
                VisitId: visitId,
                Remarks: null,
                EntryDate: visitDate,
                CreatedBy: userId,
                CreatedOn: new Date(),
            })
        );
    }

    return queries;
};

exports.mapDbError = mapDbError;

exports.getVisitItems = (visitId) => StockDA.getVisitItems(visitId);
