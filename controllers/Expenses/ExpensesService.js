const ExpensesDA = require('./ExpensesDA');
const Allowances = require('../VerifiedWork/allowances');
const DayReviews = require('./DayReviewService');

const { generateUUID } = require('../../utils/commonUtils');
const { getPermissions } = require('../../utils/permissions');
const { fail, isGuid, optionalText, requireActingUser, sameId, todayKey, toDateKey, toMonthStart } = require('../../utils/access');

// Claims can be prepared for the current month and the two before it.
const MONTHS_BACK = 2;
const MAX_ITEM_AMOUNT = 100000;
const MAX_RATE = 100000;

const ITEM_TYPES = { COURIER: 'Courier', STATIONERY: 'Stationery', MEETING_TRAVEL: 'Special meeting travel', MISC: 'Miscellaneous' };
// Lines the system adds (never typed by the MR, never counted in the other-expenses limit).
const SYSTEM_ITEM_TYPES = { HOLD_RELEASE: 'Released after review' };
const EDITABLE = ['DRAFT', 'RETURNED'];
const FINANCE_STATUSES = ['MANAGER_APPROVED', 'APPROVED', 'PAID'];

const DA_FIELD = { HQ: 'DaHq', EX_HQ: 'DaExHq', OUTSTATION: 'DaOutstation' };
const KM_FIELD = { BIKE: 'KmBike', CAR: 'KmCar', BUS: 'KmBus', TRAIN: 'KmTrain', AUTO: 'KmAuto', OTHER: 'KmOther' };
const RATE_FIELDS = ['DaHq', 'DaExHq', 'DaOutstation', ...Object.values(KM_FIELD)];
const RATE_LABELS = { DaHq: 'DA at HQ', DaExHq: 'DA Ex-HQ', DaOutstation: 'DA outstation', KmBike: 'Bike rate per km', KmCar: 'Car rate per km', KmBus: 'Bus rate per km', KmTrain: 'Train rate per km', KmAuto: 'Auto rate per km', KmOther: 'Other rate per km' };

const lower = (value) => String(value).toLowerCase();
const money = (value) => (value == null ? null : Number(value));
const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);
const toRupees = (paise) => paise / 100;

const currentMonth = () => `${todayKey().slice(0, 7)}-01`;

const shiftMonth = (monthStart, delta) => {
    const date = new Date(`${monthStart}T00:00:00`);
    return todayKey(new Date(date.getFullYear(), date.getMonth() + delta, 1));
};

const monthEnd = (monthStart) => {
    const date = new Date(`${monthStart}T00:00:00`);
    return todayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
};

const monthLabel = (monthStart) => new Date(`${monthStart}T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

const windowReason = (month) => {
    if (month > currentMonth()) return 'Claims for future months cannot be prepared.';
    if (month < shiftMonth(currentMonth(), -MONTHS_BACK)) return `Claims older than ${MONTHS_BACK} months can no longer be prepared.`;
    return null;
};

const toAmount = (value, label, max, { allowZero = false } = {}) => {
    const amount = Number(value);

    if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount === 0) || amount > max || Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) {
        throw fail(400, `${label} must be ${allowZero ? '0' : 'more than 0'} to ${max} with at most 2 decimals.`);
    }

    return Math.round(amount * 100) / 100;
};

const normalizeRate = (rate) => rate && Object.fromEntries([...RATE_FIELDS, 'OtherMonthlyLimit'].map((field) => [field, money(rate[field])]));

// DA for the station type plus TA for the distance at the travel mode's rate, in paise.
const priceDay = (rate, stationType, travelMode, distanceKm) => {
    const da = toPaise(rate[DA_FIELD[stationType]]);
    const kmRate = toPaise(rate[KM_FIELD[travelMode] || 'KmOther']);
    const ta = Math.round(kmRate * Number(distanceKm || 0));
    return { da, ta };
};

// One row per day of verified work (at least one valid visit). Nothing here comes from the MR's claim:
//   TA = km actually travelled in work hours x the company rate for the day's travel mode
//   DA = only when the day has enough valid visits; HQ / Ex-HQ / Outstation from the STP patches visited
// The MR may add remarks only.
// `holds`: Map(date -> day review). A day on hold or not payable carries no amount in the claim.
const buildDays = (facts, saved, rate, claimId, remarksByDate = new Map(), holds = new Map()) => {
    const savedByDate = new Map(saved.map((day) => [day.ExpenseDate, day]));

    return facts.map((fact) => {
        const previous = savedByDate.get(fact.date);
        const remarks = remarksByDate.has(fact.date) ? remarksByDate.get(fact.date) : previous?.Remarks || null;
        const held = DayReviews.isHeld(holds.get(fact.date));
        // DA granted by head office on a reviewed day counts as eligible.
        const daEligible = fact.daEligible || Boolean(holds.get(fact.date)?.DaGranted);
        const amounts = rate && !held ? priceDay(rate, fact.station, fact.travelMode, fact.km) : { da: 0, ta: 0 };

        return {
            DayId: generateUUID(),
            ClaimId: claimId,
            DcrId: fact.dcrId,
            ExpenseDate: fact.date,
            StationType: fact.station,
            TravelMode: fact.travelMode,
            DistanceKm: fact.km,
            DaAmount: daEligible ? toRupees(amounts.da) : 0,
            TaAmount: toRupees(amounts.ta),
            Remarks: remarks,
            VerifiedKm: fact.km,
            ValidVisits: fact.validVisits,
            DaEligible: daEligible ? 1 : 0,
            VisitCount: fact.validVisits,
        };
    });
};

const workFacts = (userId, month) => Allowances.dayFacts(userId, month, monthEnd(month));

// YYYY-MM-DD for a date that may come back from the database as a Date.
const dateKey = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value || "").slice(0, 10));

// What a day would pay (rupees), held or not: used for the amount on hold.
const priceFor = (rate) => (fact) => {
    if (!rate) return { da: 0, ta: 0 };
    const { da, ta } = priceDay(rate, fact.station, fact.travelMode, fact.km);
    return { da: fact.daEligible ? toRupees(da) : 0, ta: toRupees(ta) };
};

// Day reviews for the month (puts unusual days on hold the first time they are seen).
const holdsOf = (userId, month, facts, rate) => DayReviews.holdsFor(userId, month, monthEnd(month), facts, priceFor(rate));

// Payable days from earlier months whose claim was already submitted: paid with this claim.
const releasedLines = async (userId, month, claimId) =>
    (await DayReviews.releasable(userId, month)).map((row) => ({
        reviewId: row.ReviewId,
        item: {
            ItemId: generateUUID(),
            ClaimId: claimId,
            ExpenseDate: month,
            ExpenseType: 'HOLD_RELEASE',
            Description: `TA / DA for ${row.WorkDate}, released after review`,
            BillNumber: null,
            Vendor: null,
            Amount: Math.round((Number(row.DaAmount || 0) + Number(row.TaAmount || 0)) * 100) / 100,
            Now: new Date(),
        },
        workDate: row.WorkDate,
    }));

const normalizeDay = (day) => ({
    DayId: day.DayId,
    DcrId: day.DcrId,
    ExpenseDate: day.ExpenseDate,
    StationType: day.StationType,
    TravelMode: day.TravelMode,
    DistanceKm: Number(day.DistanceKm || 0),
    DaAmount: money(day.DaAmount),
    TaAmount: money(day.TaAmount),
    ApprovedDa: money(day.ApprovedDa),
    ApprovedTa: money(day.ApprovedTa),
    Remarks: day.Remarks,
    VisitCount: day.VisitCount ?? day.ValidVisits ?? null,
    VerifiedKm: day.VerifiedKm == null ? null : Number(day.VerifiedKm),
    ValidVisits: day.ValidVisits ?? null,
    DaEligible: day.DaEligible == null ? null : Boolean(day.DaEligible),
});

const normalizeItem = (item) => ({ ...item, Amount: money(item.Amount), ApprovedAmount: money(item.ApprovedAmount), TypeLabel: ITEM_TYPES[item.ExpenseType] || SYSTEM_ITEM_TYPES[item.ExpenseType], System: Boolean(SYSTEM_ITEM_TYPES[item.ExpenseType]) });

// Other expenses that count against the monthly limit (system lines do not).
const limitedOther = (items) => items.filter((item) => !SYSTEM_ITEM_TYPES[item.ExpenseType]).reduce((sum, item) => sum + toPaise(item.Amount), 0);

const normalizeClaim = (claim) =>
    claim && {
        ClaimId: claim.ClaimId,
        UserId: claim.UserId,
        UserName: claim.UserName,
        DesignationName: claim.DesignationName,
        ClaimMonth: claim.ClaimMonth,
        Status: claim.Status,
        DaTotal: money(claim.DaTotal),
        TaTotal: money(claim.TaTotal),
        OtherTotal: money(claim.OtherTotal),
        ClaimedAmount: money(claim.ClaimedAmount),
        ApprovedAmount: money(claim.ApprovedAmount),
        SubmittedOn: claim.SubmittedOn,
        ManagerReviewedByName: claim.ManagerReviewedOn ? claim.ManagerReviewedByName : null,
        ManagerReviewedOn: claim.ManagerReviewedOn,
        ManagerRemarks: claim.ManagerRemarks,
        FinanceReviewedByName: claim.FinanceReviewedOn ? claim.FinanceReviewedByName : null,
        FinanceReviewedOn: claim.FinanceReviewedOn,
        FinanceRemarks: claim.FinanceRemarks,
        PaymentRef: claim.PaymentRef,
        PaidOn: claim.PaidOn,
    };

const totalsOf = (days, items) => {
    const da = days.reduce((sum, day) => sum + toPaise(day.DaAmount), 0);
    const ta = days.reduce((sum, day) => sum + toPaise(day.TaAmount), 0);
    const other = items.reduce((sum, item) => sum + toPaise(item.Amount), 0);
    return { da: toRupees(da), ta: toRupees(ta), other: toRupees(other), total: toRupees(da + ta + other) };
};

// The MR's claim for a month, creating the draft row on first edit.
const ensureClaim = async (user, month) => {
    const existing = await ExpensesDA.getClaim(user.UserId, month);
    if (existing) return existing;

    try {
        await ExpensesDA.createClaim({ ClaimId: generateUUID(), UserId: user.UserId, Month: month, Now: new Date() });
    } catch (error) {
        if (error.number !== 2627 && error.number !== 2601) throw error;
    }

    return ExpensesDA.getClaim(user.UserId, month);
};

const requireEditable = (claim) => {
    if (!EDITABLE.includes(claim.Status)) throw fail(409, 'This claim has been submitted and can\'t be changed.');
};

const lockedError = (error) => {
    if (String(error.message).includes('CLAIM_LOCKED')) return fail(409, 'This claim was submitted meanwhile. Refresh to see it.');
    if (String(error.message).includes('CLAIM_CHANGED')) return fail(409, 'This claim was updated meanwhile. Refresh and try again.');
    return error;
};

const loadUser = async (actingUserId) => {
    requireActingUser(actingUserId);
    const user = await ExpensesDA.getUser(actingUserId);
    if (!user) throw fail(401, 'Acting user is required.');
    return user;
};

// =========================================================
// MR: read, edit, submit
// =========================================================

exports.getMyClaim = async (actingUserId, query) => {
    const user = await loadUser(actingUserId);
    const month = toMonthStart(query.month || currentMonth().slice(0, 7));

    const [claim, rate, facts, hasTeam, daMinValidVisits] = await Promise.all([
        ExpensesDA.getClaim(user.UserId, month),
        ExpensesDA.getRate(user.DesignationId),
        workFacts(user.UserId, month),
        ExpensesDA.hasTeam(user.UserId),
        Allowances.daMinValidVisits(),
    ]);

    const [saved, items] = claim ? await Promise.all([ExpensesDA.getDays(claim.ClaimId), ExpensesDA.getItems(claim.ClaimId)]) : [[], []];
    const status = claim?.Status || 'NOT_STARTED';
    const editable = !claim || EDITABLE.includes(claim.Status);

    // Unusual days go on hold (shown with the reason; paid only once decided payable).
    const holds = await holdsOf(user.UserId, month, facts, normalizeRate(rate));

    // While editable, days follow verified work live; afterwards they're the submitted snapshot.
    const days = (editable ? buildDays(facts, saved, normalizeRate(rate), claim?.ClaimId, new Map(), holds) : saved).map((day) => ({
        ...normalizeDay(day),
        Hold: holds.get(dateKey(day.ExpenseDate)) || null,
    }));
    const normalizedItems = items.map(normalizeItem);
    const totals = totalsOf(days, normalizedItems);
    const released = editable ? await releasedLines(user.UserId, month, claim?.ClaimId || null) : [];
    const reviews = [...holds.values()];
    const sum = (list) => Math.round(list.reduce((s, r) => s + r.Amount, 0) * 100) / 100;

    let blockedReason = windowReason(month);
    if (!blockedReason && !editable) blockedReason = status === 'PAID' ? 'This claim has been paid.' : 'This claim has been submitted.';
    if (!blockedReason && !rate) blockedReason = `No DA / TA rate card is set for your designation${user.DesignationName ? ` (${user.DesignationName})` : ''}. Ask your administrator.`;

    return {
        month,
        status,
        hasTeam,
        daMinValidVisits,
        verified: true,
        designation: user.DesignationName,
        rate: normalizeRate(rate),
        claim: normalizeClaim(claim),
        days,
        items: normalizedItems,
        totals,
        // TA / DA held for review, refused after review, and earlier days released into this claim.
        holds: {
            onHold: sum(reviews.filter((r) => DayReviews.OPEN.includes(r.Status))),
            notPayable: sum(reviews.filter((r) => r.Status === 'NOT_PAYABLE')),
            count: reviews.filter((r) => DayReviews.OPEN.includes(r.Status)).length,
            released: released.map((line) => ({ workDate: line.workDate, amount: line.item.Amount })),
            releasedTotal: Math.round(released.reduce((s, line) => s + line.item.Amount, 0) * 100) / 100,
        },
        otherLimit: money(rate?.OtherMonthlyLimit),
        itemTypes: Object.entries(ITEM_TYPES).map(([value, label]) => ({ value, label })),
        canEdit: !blockedReason,
        canSubmit: !blockedReason && (totals.total > 0 || released.length > 0),
        blockedReason,
    };
};

// Station type (and remarks) per DCR day; DA / TA are recalculated from the rate card.
exports.saveDays = async (actingUserId, payload) => {
    const user = await loadUser(actingUserId);
    const month = toMonthStart(payload.Month);
    const reason = windowReason(month);
    if (reason) throw fail(400, reason);

    const rate = normalizeRate(await ExpensesDA.getRate(user.DesignationId));
    if (!rate) throw fail(409, 'No DA / TA rate card is set for your designation. Ask your administrator.');

    // HQ / Ex-HQ / Outstation now come from the patches actually visited; the MR adds remarks only.
    const remarksByDate = new Map();
    (Array.isArray(payload.Days) ? payload.Days : []).forEach((day) => {
        const date = toDateKey(day?.ExpenseDate, 'Day');
        remarksByDate.set(date, optionalText(day.Remarks, 300, `${date} remarks`));
    });

    const claim = await ensureClaim(user, month);
    requireEditable(claim);

    const [facts, saved] = await Promise.all([workFacts(user.UserId, month), ExpensesDA.getDays(claim.ClaimId)]);
    const holds = await holdsOf(user.UserId, month, facts, rate);
    const days = buildDays(facts, saved, rate, claim.ClaimId, remarksByDate, holds).map(({ VisitCount, ...day }) => day);

    try {
        await ExpensesDA.replaceDays(claim.ClaimId, user.UserId, days, new Date());
    } catch (error) {
        throw lockedError(error);
    }

    return { message: 'Remarks saved.' };
};

exports.addItem = async (actingUserId, payload) => {
    const user = await loadUser(actingUserId);
    const month = toMonthStart(payload.Month);
    const reason = windowReason(month);
    if (reason) throw fail(400, reason);

    const date = toDateKey(payload.ExpenseDate, 'Expense date');
    if (date < month || date > monthEnd(month)) throw fail(400, `The expense date must be in ${monthLabel(month)}.`);
    if (date > todayKey()) throw fail(400, 'The expense date cannot be in the future.');

    const type = String(payload.ExpenseType || '').toUpperCase();
    if (!ITEM_TYPES[type]) throw fail(400, 'Choose an expense type.');

    const description = optionalText(payload.Description, 300, 'Description');
    if (!description) throw fail(400, 'Describe the expense.');

    const amount = toAmount(payload.Amount, 'Amount', MAX_ITEM_AMOUNT);
    const rate = normalizeRate(await ExpensesDA.getRate(user.DesignationId));
    if (!rate) throw fail(409, 'No DA / TA rate card is set for your designation. Ask your administrator.');

    const claim = await ensureClaim(user, month);
    requireEditable(claim);

    if (rate.OtherMonthlyLimit != null) {
        const items = await ExpensesDA.getItems(claim.ClaimId);
        const used = limitedOther(items);
        if (used + toPaise(amount) > toPaise(rate.OtherMonthlyLimit)) {
            throw fail(400, `Other expenses can't exceed ₹${rate.OtherMonthlyLimit.toLocaleString('en-IN')} a month. ₹${toRupees(toPaise(rate.OtherMonthlyLimit) - used).toLocaleString('en-IN')} left.`);
        }
    }

    try {
        await ExpensesDA.addItem(
            claim.ClaimId,
            user.UserId,
            {
                ItemId: generateUUID(),
                ClaimId: claim.ClaimId,
                ExpenseDate: date,
                ExpenseType: type,
                Description: description,
                BillNumber: optionalText(payload.BillNumber, 50, 'Bill number'),
                Vendor: optionalText(payload.Vendor, 150, 'Vendor'),
                Amount: amount,
                Now: new Date(),
            },
            new Date()
        );
    } catch (error) {
        throw lockedError(error);
    }

    return { message: `${ITEM_TYPES[type]} expense added.` };
};

exports.deleteItem = async (actingUserId, itemId, query) => {
    const user = await loadUser(actingUserId);
    if (!isGuid(itemId)) throw fail(400, 'Expense is invalid.');

    const month = toMonthStart(query.month);
    const claim = await ExpensesDA.getClaim(user.UserId, month);
    if (!claim) throw fail(404, 'Claim not found.');
    requireEditable(claim);
    const item = (await ExpensesDA.getItems(claim.ClaimId)).find((row) => lower(row.ItemId) === lower(itemId));
    if (item && SYSTEM_ITEM_TYPES[item.ExpenseType]) throw fail(400, 'This line was added after a review and cannot be removed.');

    try {
        await ExpensesDA.deleteItem(claim.ClaimId, user.UserId, itemId, new Date());
    } catch (error) {
        throw lockedError(error);
    }

    return { message: 'Expense removed.' };
};

exports.submit = async (actingUserId, payload) => {
    const user = await loadUser(actingUserId);
    const month = toMonthStart(payload.Month);
    const reason = windowReason(month);
    if (reason) throw fail(400, reason);

    const rate = normalizeRate(await ExpensesDA.getRate(user.DesignationId));
    if (!rate) throw fail(409, 'No DA / TA rate card is set for your designation. Ask your administrator.');

    const claim = await ensureClaim(user, month);
    requireEditable(claim);

    const [facts, saved, items] = await Promise.all([workFacts(user.UserId, month), ExpensesDA.getDays(claim.ClaimId), ExpensesDA.getItems(claim.ClaimId)]);

    const holds = await holdsOf(user.UserId, month, facts, rate);
    const days = buildDays(facts, saved, rate, claim.ClaimId, new Map(), holds).map(({ VisitCount, ...day }) => day);
    // Earlier days decided payable after their claim was submitted are paid with this one.
    const released = await releasedLines(user.UserId, month, claim.ClaimId);
    const allItems = [...items, ...released.map((line) => line.item)].map(normalizeItem);
    const totals = totalsOf(days, allItems);
    if (totals.total <= 0) throw fail(400, 'There is nothing to claim yet: no days with valid visits or expenses this month.');

    const other = limitedOther(allItems);
    if (rate.OtherMonthlyLimit != null && other > toPaise(rate.OtherMonthlyLimit)) {
        throw fail(400, `Other expenses (₹${toRupees(other).toLocaleString('en-IN')}) exceed the monthly limit of ₹${rate.OtherMonthlyLimit.toLocaleString('en-IN')}.`);
    }

    // Without a reporting manager the claim goes straight to finance.
    const toStatus = user.ManagerId ? 'SUBMITTED' : 'MANAGER_APPROVED';

    try {
        const now = new Date();
        await ExpensesDA.submit(claim.ClaimId, user.UserId, days, toStatus, now, released.flatMap((line) => [ExpensesDA.insertItemQuery(line.item), DayReviews.markReleasedQuery(line.reviewId, claim.ClaimId, now)]));
    } catch (error) {
        throw lockedError(error);
    }

    return {
        message: user.ManagerId
            ? `${monthLabel(month)} claim of ₹${totals.total.toLocaleString('en-IN')} sent to your manager.`
            : `${monthLabel(month)} claim of ₹${totals.total.toLocaleString('en-IN')} sent for final approval.`,
    };
};

// =========================================================
// Claim detail (owner, manager or finance)
// =========================================================

exports.getClaimById = async (actingUserId, claimId) => {
    requireActingUser(actingUserId);
    if (!isGuid(claimId)) throw fail(400, 'Claim is invalid.');

    const claim = await ExpensesDA.getClaimById(claimId);
    if (!claim) throw fail(404, 'Claim not found.');

    const permissions = await getPermissions(actingUserId);
    const isOwner = sameId(claim.UserId, actingUserId);
    const isManager = sameId(claim.ManagerId, actingUserId);
    const isFinance = permissions.has('expensefinance.view') && FINANCE_STATUSES.includes(claim.Status);

    if (!isOwner && !isManager && !isFinance) throw fail(403, 'You can\'t open this claim.');

    const [days, items] = await Promise.all([ExpensesDA.getDays(claimId), ExpensesDA.getItems(claimId)]);
    const canFinance = permissions.has('expensefinance.approve') && !isOwner;

    return {
        claim: normalizeClaim(claim),
        days: days.map(normalizeDay),
        items: items.map(normalizeItem),
        actions: {
            managerReview: isManager && !isOwner && claim.Status === 'SUBMITTED' && permissions.has('expenses.approve'),
            finalApprove: canFinance && claim.Status === 'MANAGER_APPROVED',
            markPaid: canFinance && claim.Status === 'APPROVED',
        },
    };
};

// =========================================================
// Manager review
// =========================================================

exports.getReviews = async (actingUserId) => {
    requireActingUser(actingUserId);
    return { reviews: (await ExpensesDA.getReviews(actingUserId)).map(normalizeClaim) };
};

// Approve, optionally reducing amounts per day / item (never increasing). A reduction needs a reason.
exports.managerApprove = async (actingUserId, claimId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(claimId)) throw fail(400, 'Claim is invalid.');

    const claim = await ExpensesDA.getClaimById(claimId);
    if (!claim) throw fail(404, 'Claim not found.');
    if (!sameId(claim.ManagerId, actingUserId) || sameId(claim.UserId, actingUserId)) throw fail(403, 'Only the reporting manager can review this claim.');
    if (claim.Status !== 'SUBMITTED') throw fail(409, 'Only a submitted claim can be reviewed.');

    const [days, items] = await Promise.all([ExpensesDA.getDays(claimId), ExpensesDA.getItems(claimId)]);
    if ((payload.Days || []).some((day) => day.ApprovedDa != null || day.ApprovedTa != null)) {
        throw fail(400, 'TA and DA are calculated from verified work. Managers cannot change them; ask head office if something is wrong.');
    }
    const dayAdjust = new Map();
    const itemAdjust = new Map((payload.Items || []).map((item) => [lower(item.ItemId), item]));

    let reduced = false;
    let approvedPaise = 0;

    const dayRows = days.map((day) => {
        const adjust = dayAdjust.get(lower(day.DayId));
        const da = adjust?.ApprovedDa == null ? money(day.DaAmount) : toAmount(adjust.ApprovedDa, `${day.ExpenseDate} DA`, money(day.DaAmount), { allowZero: true });
        const ta = adjust?.ApprovedTa == null ? money(day.TaAmount) : toAmount(adjust.ApprovedTa, `${day.ExpenseDate} TA`, money(day.TaAmount), { allowZero: true });

        if (toPaise(da) < toPaise(day.DaAmount) || toPaise(ta) < toPaise(day.TaAmount)) reduced = true;
        approvedPaise += toPaise(da) + toPaise(ta);

        return { DayId: day.DayId, ApprovedDa: da, ApprovedTa: ta };
    });

    const itemRows = items.map((item) => {
        const adjust = itemAdjust.get(lower(item.ItemId));
        const amount = adjust?.ApprovedAmount == null ? money(item.Amount) : toAmount(adjust.ApprovedAmount, `${item.Description} amount`, money(item.Amount), { allowZero: true });

        if (toPaise(amount) < toPaise(item.Amount)) reduced = true;
        approvedPaise += toPaise(amount);

        return { ItemId: item.ItemId, ApprovedAmount: amount };
    });

    const remarks = optionalText(payload.Remarks, 500, 'Remarks');
    if (reduced && !remarks) throw fail(400, 'Say why amounts were reduced.');

    try {
        await ExpensesDA.managerDecision(
            claimId,
            'SUBMITTED',
            { ToStatus: 'MANAGER_APPROVED', ApprovedAmount: toRupees(approvedPaise), ReviewedBy: actingUserId, Remarks: remarks, Now: new Date() },
            dayRows,
            itemRows
        );
    } catch (error) {
        throw lockedError(error);
    }

    return { message: `${claim.UserName}'s claim approved for ₹${toRupees(approvedPaise).toLocaleString('en-IN')}.` };
};

// Manager (submitted) or finance (manager-approved) sends the claim back to the MR.
exports.returnClaim = async (actingUserId, claimId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(claimId)) throw fail(400, 'Claim is invalid.');

    const claim = await ExpensesDA.getClaimById(claimId);
    if (!claim) throw fail(404, 'Claim not found.');

    const remarks = optionalText(payload.Remarks, 500, 'Remarks');
    if (!remarks) throw fail(400, 'Say what needs to be corrected.');

    const permissions = await getPermissions(actingUserId);
    const now = new Date();

    try {
        if (claim.Status === 'SUBMITTED') {
            if (!sameId(claim.ManagerId, actingUserId) || !permissions.has('expenses.approve')) throw fail(403, 'Only the reporting manager can return this claim.');
            await ExpensesDA.managerDecision(claimId, 'SUBMITTED', { ToStatus: 'RETURNED', ApprovedAmount: null, ReviewedBy: actingUserId, Remarks: remarks, Now: now });
        } else if (claim.Status === 'MANAGER_APPROVED') {
            if (!permissions.has('expensefinance.approve') || sameId(claim.UserId, actingUserId)) throw fail(403, 'Only finance can return this claim.');
            await ExpensesDA.financeDecision(claimId, 'MANAGER_APPROVED', { ToStatus: 'RETURNED', ReviewedBy: actingUserId, Remarks: remarks, Now: now });
        } else {
            throw fail(409, 'This claim can no longer be returned.');
        }
    } catch (error) {
        throw lockedError(error);
    }

    return { message: `${claim.UserName}'s claim returned for correction.` };
};

// =========================================================
// Finance: final approval and payment
// =========================================================

exports.getFinance = async (actingUserId, query) => {
    requireActingUser(actingUserId);

    const status = FINANCE_STATUSES.includes(String(query.status || '').toUpperCase()) ? String(query.status).toUpperCase() : 'MANAGER_APPROVED';
    const claims = (await ExpensesDA.getFinance(status)).map(normalizeClaim);

    return { status, claims };
};

exports.finalApprove = async (actingUserId, claimId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(claimId)) throw fail(400, 'Claim is invalid.');

    const claim = await ExpensesDA.getClaimById(claimId);
    if (!claim) throw fail(404, 'Claim not found.');
    if (sameId(claim.UserId, actingUserId)) throw fail(403, 'You can\'t approve your own claim.');
    if (claim.Status !== 'MANAGER_APPROVED') throw fail(409, 'Only a manager-approved claim can be given final approval.');

    try {
        await ExpensesDA.financeDecision(claimId, 'MANAGER_APPROVED', {
            ToStatus: 'APPROVED',
            ReviewedBy: actingUserId,
            Remarks: optionalText(payload.Remarks, 500, 'Remarks'),
            Now: new Date(),
        });
    } catch (error) {
        throw lockedError(error);
    }

    return { message: `${claim.UserName}'s ${monthLabel(claim.ClaimMonth)} claim approved for payment.` };
};

exports.markPaid = async (actingUserId, claimId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(claimId)) throw fail(400, 'Claim is invalid.');

    const claim = await ExpensesDA.getClaimById(claimId);
    if (!claim) throw fail(404, 'Claim not found.');
    if (sameId(claim.UserId, actingUserId)) throw fail(403, 'You can\'t mark your own claim paid.');
    if (claim.Status !== 'APPROVED') throw fail(409, 'Only an approved claim can be marked paid.');

    const paymentRef = optionalText(payload.PaymentRef, 100, 'Payment reference');
    if (!paymentRef) throw fail(400, 'Enter the payment reference (UTR / cheque / transaction id).');

    try {
        await ExpensesDA.markPaid(claimId, { PaymentRef: paymentRef, PaidBy: actingUserId, Now: new Date() });
    } catch (error) {
        throw lockedError(error);
    }

    return { message: `${claim.UserName}'s claim marked paid.` };
};

// =========================================================
// Rate card
// =========================================================

exports.getRates = async () => ({
    designations: (await ExpensesDA.getRates()).map((row) => ({
        DesignationId: row.DesignationId,
        DesignationName: row.DesignationName,
        DesignationCode: row.DesignationCode,
        Users: row.Users,
        HasRates: Boolean(row.HasRates),
        ModifiedOn: row.ModifiedOn,
        ...normalizeRate(row),
    })),
});

exports.saveRate = async (actingUserId, designationId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(designationId) || !(await ExpensesDA.isDesignation(designationId))) throw fail(400, 'Designation is invalid.');

    const values = Object.fromEntries(RATE_FIELDS.map((field) => [field, toAmount(payload[field] ?? 0, RATE_LABELS[field], MAX_RATE, { allowZero: true })]));
    const limit = payload.OtherMonthlyLimit === '' || payload.OtherMonthlyLimit == null ? null : toAmount(payload.OtherMonthlyLimit, 'Monthly limit', 10000000, { allowZero: true });

    await ExpensesDA.saveRate({ DesignationId: designationId, ...values, OtherMonthlyLimit: limit, ModifiedBy: actingUserId, Now: new Date() });

    return { message: 'Rate card saved.' };
};

// =========================================================
// Daily TA / DA statement (the employee's own)
// =========================================================

// Every work day of the month: DA, TA, total, status (earned / on hold / not payable / payable after review),
// the reason in plain facts, and running totals. A held day is shown, never hidden.
exports.getStatement = async (actingUserId, query) => {
    const user = await loadUser(actingUserId);
    const month = toMonthStart(query.month || currentMonth().slice(0, 7));
    const [rate, facts] = await Promise.all([ExpensesDA.getRate(user.DesignationId), workFacts(user.UserId, month)]);
    const normalized = normalizeRate(rate);
    const price = priceFor(normalized);
    const holds = await holdsOf(user.UserId, month, facts, normalized);

    let earned = 0;
    const rows = [...facts]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((fact) => {
            const review = holds.get(fact.date) || null;
            const amount = price({ ...fact, daEligible: fact.daEligible || Boolean(review?.DaGranted) });
            const total = Math.round((amount.da + amount.ta) * 100) / 100;
            const status = !review ? 'EARNED' : review.Status === 'PAYABLE' ? 'PAYABLE' : review.Status === 'NOT_PAYABLE' ? 'NOT_PAYABLE' : 'ON_HOLD';
            if (status === 'EARNED' || status === 'PAYABLE') earned = Math.round((earned + total) * 100) / 100;
            return {
                date: fact.date,
                visits: fact.validVisits,
                km: fact.km,
                station: fact.station,
                da: amount.da,
                ta: amount.ta,
                total,
                status,
                review,
                canSendReason: Boolean(review) && review.Status === 'HELD',
                earnedSoFar: earned,
            };
        });

    const sum = (list) => Math.round(list.reduce((s, row) => s + row.total, 0) * 100) / 100;
    const onHold = sum(rows.filter((row) => row.status === 'ON_HOLD'));
    return {
        month,
        rateSet: Boolean(rate),
        daMinValidVisits: await Allowances.daMinValidVisits(),
        rows,
        totals: { earned, onHold, notPayable: sum(rows.filter((row) => row.status === 'NOT_PAYABLE')), ifApproved: Math.round((earned + onHold) * 100) / 100 },
        policy: await DayReviews.getPolicy(actingUserId),
    };
};

// One reviewed day's amount (rupees) for head office's decision; grantDa pays DA even below the DA rule.
exports.priceReviewedDay = async (userId, workDate, grantDa) => {
    const user = await ExpensesDA.getUser(userId);
    const rate = normalizeRate(await ExpensesDA.getRate(user?.DesignationId));
    const [fact] = (await Allowances.dayFacts(userId, workDate, workDate)).filter((f) => f.date === workDate);
    if (!rate || !fact) return { da: 0, ta: 0 };
    return priceFor(rate)({ ...fact, daEligible: fact.daEligible || grantDa });
};
