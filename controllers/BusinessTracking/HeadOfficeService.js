// Head office data entry: batches, stockist territories, primary dispatch, returns, joining dates,
// salaries, ramp-up milestones and incentive slabs. Nothing is deleted: corrections are voids with a
// reason, and every change is written to the audit log.

const sql = require('./sql');
const rules = require('./rules');

const { customQuery, runInTransaction } = require('../../utils/dbFunctions');
const { generateUUID } = require('../../utils/commonUtils');
const { auditQuery } = require('../../utils/audit');
const { fail, isGuid, optionalText, requireActingUser, toDateKey, toMonthStart } = require('../../utils/access');

const q = (name, inputs = {}) => customQuery(sql[name](), inputs);
const run = async (steps) => {
    try {
        return await runInTransaction(steps);
    } catch (error) {
        if (error.number === 50409) throw fail(409, error.message);
        throw error;
    }
};
const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const REASONS = ['EXPIRED', 'DAMAGED', 'OTHER'];
const MAX_QTY = 1000000;
const MAX_VALUE = 100000000;

const requireReason = (value, label = 'Reason') => {
    const text = optionalText(value, 300, label);
    if (!text || text.length < 10) throw fail(400, `${label} is required (at least 10 characters).`);
    return text;
};

// =========================================================
// Batches
// =========================================================

exports.listBatches = async (query) => ({ batches: await q('LIST_BATCHES', { ProductId: isGuid(query.productId) ? query.productId : null }) });

exports.createBatch = async (actingUserId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(payload.ProductId) || !(await q('PRODUCT_EXISTS', { ProductId: payload.ProductId })).length) throw fail(400, 'Choose the product.');
    const batchNumber = optionalText(payload.BatchNumber, 50, 'Batch number');
    if (!batchNumber) throw fail(400, 'Batch number is required.');
    const mfg = toDateKey(payload.MfgDate, 'Manufacture date');
    const expiry = toDateKey(payload.ExpiryDate, 'Expiry date');
    if (expiry <= mfg) throw fail(400, 'Expiry date must be after the manufacture date.');
    if (mfg > today()) throw fail(400, 'Manufacture date cannot be in the future.');

    const row = { BatchId: generateUUID(), ProductId: payload.ProductId, BatchNumber: batchNumber.toUpperCase(), MfgDate: mfg, ExpiryDate: expiry, ActorId: actingUserId, Now: new Date() };
    await run([{ sqlQuery: sql.INSERT_BATCH(), inputs: row }, auditQuery({ entityType: 'BATCH', entityId: row.BatchId, action: 'CREATE', actorId: actingUserId, after: row })]);
    return { message: `Batch ${row.BatchNumber} added.`, BatchId: row.BatchId };
};

// =========================================================
// Stockist <-> territory
// =========================================================

exports.listStockists = async () => {
    const [stockists, territories] = await Promise.all([q('STOCKIST_TERRITORIES'), q('TERRITORIES')]);
    return {
        stockists: stockists.map((s) => ({ ...s, TerritoryIds: s.TerritoryIds ? s.TerritoryIds.split(',') : [] })),
        territories,
    };
};

exports.setStockistTerritories = async (actingUserId, stockistId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(stockistId)) throw fail(400, 'Stockist is invalid.');
    const add = (payload.Add || []).filter(isGuid);
    const remove = (payload.Remove || []).filter(isGuid);
    if (!add.length && !remove.length) throw fail(400, 'Nothing was changed.');
    const now = new Date();
    await run([
        ...add.map((TerritoryId) => ({ sqlQuery: sql.ADD_STOCKIST_TERRITORY(), inputs: { StockistId: stockistId, TerritoryId, Now: now } })),
        ...remove.map((TerritoryId) => ({ sqlQuery: sql.REMOVE_STOCKIST_TERRITORY(), inputs: { StockistId: stockistId, TerritoryId, Now: now } })),
        auditQuery({ entityType: 'STOCKIST', entityId: stockistId, action: 'TERRITORIES', actorId: actingUserId, after: { add, remove } }),
    ]);
    return { message: 'Stockist territories updated.' };
};

// =========================================================
// Dispatch and returns
// =========================================================

const recordInput = async (payload, kind) => {
    for (const [field, label] of [['StockistId', 'stockist'], ['TerritoryId', 'territory'], ['ProductId', 'product'], ['BatchId', 'batch']]) {
        if (!isGuid(payload[field])) throw fail(400, `Choose the ${label}.`);
    }
    if (!(await q('STOCKIST_HAS_TERRITORY', { StockistId: payload.StockistId, TerritoryId: payload.TerritoryId })).length) {
        throw fail(400, 'This stockist is not linked to that territory. Link it first under Stockists.');
    }
    const batch = (await q('GET_BATCH', { BatchId: payload.BatchId }))[0];
    if (!batch || String(batch.ProductId).toLowerCase() !== String(payload.ProductId).toLowerCase()) throw fail(400, 'This batch is not of the chosen product.');

    const quantity = Number(payload.Quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) throw fail(400, 'Quantity must be a whole number, 1 or more.');
    const value = Number(payload.Value);
    if (!Number.isFinite(value) || value <= 0 || value > MAX_VALUE) throw fail(400, 'Value (Rs) must be more than 0.');

    const date = toDateKey(payload.Date, kind === 'return' ? 'Return date' : 'Dispatch date');
    if (date > today()) throw fail(400, 'The date cannot be in the future.');

    const row = {
        RecordId: generateUUID(),
        StockistId: payload.StockistId,
        TerritoryId: payload.TerritoryId,
        ProductId: payload.ProductId,
        BatchId: payload.BatchId,
        Quantity: quantity,
        Value: Math.round(value * 100) / 100,
        RecordDate: date,
        Remarks: optionalText(payload.Remarks, 300, 'Remarks'),
    };
    if (kind === 'return') {
        const reason = String(payload.Reason || '').toUpperCase();
        if (!REASONS.includes(reason)) throw fail(400, 'Reason must be Expired, Damaged or Other.');
        row.Reason = reason;
    }
    return row;
};

const monthRange = (query) => {
    const month = toMonthStart(query.month || today().slice(0, 7));
    return { From: month, To: rules.monthEnd(month), TerritoryId: isGuid(query.territoryId) ? query.territoryId : null };
};

exports.listDispatches = async (query) => ({ dispatches: await q('LIST_DISPATCHES', monthRange(query)) });
exports.listReturns = async (query) => ({ returns: await q('LIST_RETURNS', monthRange(query)) });

exports.createDispatch = async (actingUserId, payload) => {
    requireActingUser(actingUserId);
    const row = { ...(await recordInput(payload, 'dispatch')), ActorId: actingUserId, Now: new Date() };
    await run([{ sqlQuery: sql.INSERT_DISPATCH(), inputs: row }, auditQuery({ entityType: 'DISPATCH', entityId: row.RecordId, action: 'CREATE', actorId: actingUserId, after: row })]);
    return { message: 'Dispatch recorded.' };
};

exports.createReturn = async (actingUserId, payload) => {
    requireActingUser(actingUserId);
    const row = { ...(await recordInput(payload, 'return')), ActorId: actingUserId, Now: new Date() };
    await run([{ sqlQuery: sql.INSERT_RETURN(), inputs: row }, auditQuery({ entityType: 'RETURN', entityId: row.RecordId, action: 'CREATE', actorId: actingUserId, after: row })]);
    return { message: 'Return recorded. It is deducted from that territory\'s net sales.' };
};

// A wrong entry is voided (kept for the record), never deleted.
exports.voidRecord = async (actingUserId, kind, recordId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(recordId)) throw fail(400, 'Record is invalid.');
    const isReturn = kind === 'returns';
    const before = (await q(isReturn ? 'GET_RETURN' : 'GET_DISPATCH', { RecordId: recordId }))[0];
    if (!before) throw fail(404, 'Record not found.');
    const reason = requireReason(payload.Reason);
    await run([
        { sqlQuery: isReturn ? sql.VOID_RETURN() : sql.VOID_DISPATCH(), inputs: { RecordId: recordId, ActorId: actingUserId, Reason: reason, Now: new Date() } },
        auditQuery({ entityType: isReturn ? 'RETURN' : 'DISPATCH', entityId: recordId, action: 'VOID', actorId: actingUserId, reason, before }),
    ]);
    return { message: 'Voided. It no longer counts in net sales.' };
};

// =========================================================
// People: joining date and salary
// =========================================================

exports.listPeople = async () => ({ people: await q('PEOPLE_COSTS', { Today: today() }) });

exports.salaryHistory = async (userId) => {
    if (!isGuid(userId)) throw fail(400, 'User is invalid.');
    return { salaries: await q('SALARIES', { UserId: userId }) };
};

exports.setJoining = async (actingUserId, userId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(userId)) throw fail(400, 'User is invalid.');
    const joining = toDateKey(payload.JoiningDate, 'Joining date');
    if (joining > today()) throw fail(400, 'Joining date cannot be in the future.');
    const before = (await q('PROFILE', { UserId: userId }))[0];
    await run([
        { sqlQuery: sql.SET_JOINING(), inputs: { UserId: userId, JoiningDate: joining, ActorId: actingUserId, Now: new Date() } },
        auditQuery({ entityType: 'EMPLOYEE', entityId: userId, action: 'JOINING_DATE', actorId: actingUserId, before: { joiningDate: before?.JoiningDate }, after: { joiningDate: joining } }),
    ]);
    return { message: 'Joining date saved.' };
};

exports.addSalary = async (actingUserId, userId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(userId)) throw fail(400, 'User is invalid.');
    const from = toMonthStart(payload.EffectiveFrom, 'Effective month');
    const salary = Number(payload.MonthlySalary);
    if (!Number.isFinite(salary) || salary < 0 || salary > 10000000) throw fail(400, 'Monthly salary is invalid.');
    const row = { SalaryId: generateUUID(), UserId: userId, EffectiveFrom: from, MonthlySalary: Math.round(salary * 100) / 100, ActorId: actingUserId, Now: new Date() };
    await run([{ sqlQuery: sql.ADD_SALARY(), inputs: row }, auditQuery({ entityType: 'EMPLOYEE', entityId: userId, action: 'SALARY', actorId: actingUserId, after: { effectiveFrom: from, monthlySalary: row.MonthlySalary } })]);
    return { message: 'Salary saved.' };
};

// =========================================================
// Milestones and incentive slabs
// =========================================================

exports.getConfig = async () => {
    const [milestones, slabs] = await Promise.all([q('MILESTONES'), q('SLABS')]);
    return {
        metrics: Object.entries(rules.METRICS).map(([value, meta]) => ({ value, ...meta })),
        milestones: milestones.map((m) => ({ ...m, Target: Number(m.Target), IsActive: Boolean(m.IsActive) })),
        slabs: slabs.map((s) => ({ FromAmount: Number(s.FromAmount), RatePercent: Number(s.RatePercent) })),
    };
};

exports.saveMilestones = async (actingUserId, payload) => {
    requireActingUser(actingUserId);
    const items = Array.isArray(payload.Milestones) ? payload.Milestones : [];
    if (!items.length) throw fail(400, 'Nothing to save.');
    const reason = requireReason(payload.Reason);
    const now = new Date();
    const rows = items.map((m) => {
        const month = Number(m.MonthNumber);
        const target = Number(m.Target);
        if (!Number.isInteger(month) || month < 1 || month > 24) throw fail(400, 'Month must be 1 to 24.');
        if (!rules.METRICS[m.Metric]) throw fail(400, 'Unknown milestone measure.');
        if (!Number.isFinite(target) || target < 0 || target > 100000) throw fail(400, 'Target is invalid.');
        return { MilestoneId: isGuid(m.MilestoneId) ? m.MilestoneId : generateUUID(), MonthNumber: month, Metric: m.Metric, Target: target, IsActive: m.IsActive === false ? 0 : 1, ActorId: actingUserId, Now: now };
    });
    const before = await q('MILESTONES');
    await run([...rows.map((inputs) => ({ sqlQuery: sql.UPSERT_MILESTONE(), inputs })), auditQuery({ entityType: 'SETTINGS', entityId: 'RAMP_MILESTONES', action: 'UPDATE', actorId: actingUserId, reason, before, after: rows })]);
    return { message: 'Milestones saved.' };
};

exports.saveSlabs = async (actingUserId, payload) => {
    requireActingUser(actingUserId);
    const reason = requireReason(payload.Reason);
    const slabs = (Array.isArray(payload.Slabs) ? payload.Slabs : []).map((s) => ({ FromAmount: Number(s.FromAmount), RatePercent: Number(s.RatePercent) }));
    if (!slabs.length) throw fail(400, 'Add at least one slab.');
    if (slabs.some((s) => !Number.isFinite(s.FromAmount) || s.FromAmount < 0 || !Number.isFinite(s.RatePercent) || s.RatePercent < 0 || s.RatePercent > 50)) {
        throw fail(400, 'Each slab needs a starting amount (0 or more) and a rate between 0 and 50%.');
    }
    if (new Set(slabs.map((s) => s.FromAmount)).size !== slabs.length) throw fail(400, 'Two slabs start at the same amount.');
    if (!slabs.some((s) => s.FromAmount === 0)) throw fail(400, 'One slab must start at 0.');

    const now = new Date();
    const before = await q('SLABS');
    await run([
        { sqlQuery: sql.RETIRE_SLABS(), inputs: { Now: now } },
        ...slabs.map((s) => ({ sqlQuery: sql.INSERT_SLAB(), inputs: { SlabId: generateUUID(), ...s, ActorId: actingUserId, Now: now } })),
        auditQuery({ entityType: 'SETTINGS', entityId: 'INCENTIVE_SLABS', action: 'UPDATE', actorId: actingUserId, reason, before, after: slabs }),
    ]);
    return { message: 'Incentive slabs saved.' };
};
