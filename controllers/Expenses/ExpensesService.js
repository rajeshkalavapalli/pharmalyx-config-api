const ExpensesDA = require('./ExpensesDA');

const { generateUUID } = require('../../utils/commonUtils');
const { getPermissions } = require('../../utils/permissions');
const { fail, isGuid, optionalText, requireActingUser, sameId, todayKey, toDateKey, toMonthStart } = require('../../utils/access');

// Claims can be prepared for the current month and the two before it.
const MONTHS_BACK = 2;
const MAX_ITEM_AMOUNT = 100000;
const MAX_RATE = 100000;

const STATIONS = ['HQ', 'EX_HQ', 'OUTSTATION'];
const ITEM_TYPES = { COURIER: 'Courier', STATIONERY: 'Stationery', MEETING_TRAVEL: 'Special meeting travel', MISC: 'Miscellaneous' };
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

// One row per approved DCR day, keeping the MR's chosen station type and remarks.
const buildDays = (dcrs, saved, rate, claimId, overrides = new Map()) => {
    const savedByDate = new Map(saved.map((day) => [day.ExpenseDate, day]));

    return dcrs.map((dcr) => {
        const previous = savedByDate.get(dcr.ReportDate);
        const override = overrides.get(dcr.ReportDate);
        const stationType = override?.StationType || previous?.StationType || 'HQ';
        const remarks = override ? override.Remarks : previous?.Remarks || null;
        const amounts = rate ? priceDay(rate, stationType, dcr.TravelMode, dcr.DistanceKm) : { da: 0, ta: 0 };

        return {
            DayId: generateUUID(),
            ClaimId: claimId,
            DcrId: dcr.DcrId,
            ExpenseDate: dcr.ReportDate,
            StationType: stationType,
            TravelMode: dcr.TravelMode || 'OTHER',
            DistanceKm: Number(dcr.DistanceKm || 0),
            DaAmount: toRupees(amounts.da),
            TaAmount: toRupees(amounts.ta),
            Remarks: remarks,
            VisitCount: dcr.VisitCount,
        };
    });
};

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
    VisitCount: day.VisitCount ?? null,
});

const normalizeItem = (item) => ({ ...item, Amount: money(item.Amount), ApprovedAmount: money(item.ApprovedAmount), TypeLabel: ITEM_TYPES[item.ExpenseType] });

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

    const [claim, rate, dcrs, hasTeam] = await Promise.all([
        ExpensesDA.getClaim(user.UserId, month),
        ExpensesDA.getRate(user.DesignationId),
        ExpensesDA.getApprovedDcrs(user.UserId, month, monthEnd(month)),
        ExpensesDA.hasTeam(user.UserId),
    ]);

    const [saved, items] = claim ? await Promise.all([ExpensesDA.getDays(claim.ClaimId), ExpensesDA.getItems(claim.ClaimId)]) : [[], []];
    const status = claim?.Status || 'NOT_STARTED';
    const editable = !claim || EDITABLE.includes(claim.Status);

    // While editable, days follow the approved DCRs live; afterwards they're the submitted snapshot.
    const days = (editable ? buildDays(dcrs, saved, normalizeRate(rate), claim?.ClaimId) : saved).map(normalizeDay);
    const normalizedItems = items.map(normalizeItem);
    const totals = totalsOf(days, normalizedItems);

    let blockedReason = windowReason(month);
    if (!blockedReason && !editable) blockedReason = status === 'PAID' ? 'This claim has been paid.' : 'This claim has been submitted.';
    if (!blockedReason && !rate) blockedReason = `No DA / TA rate card is set for your designation${user.DesignationName ? ` (${user.DesignationName})` : ''}. Ask your administrator.`;

    return {
        month,
        status,
        hasTeam,
        designation: user.DesignationName,
        rate: normalizeRate(rate),
        claim: normalizeClaim(claim),
        days,
        items: normalizedItems,
        totals,
        otherLimit: money(rate?.OtherMonthlyLimit),
        itemTypes: Object.entries(ITEM_TYPES).map(([value, label]) => ({ value, label })),
        canEdit: !blockedReason,
        canSubmit: !blockedReason && totals.total > 0,
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

    const overrides = new Map();
    (Array.isArray(payload.Days) ? payload.Days : []).forEach((day) => {
        const date = toDateKey(day?.ExpenseDate, 'Day');
        const stationType = String(day.StationType || '').toUpperCase();
        if (!STATIONS.includes(stationType)) throw fail(400, `${date}: choose HQ, Ex-HQ or Outstation.`);
        overrides.set(date, { StationType: stationType, Remarks: optionalText(day.Remarks, 300, `${date} remarks`) });
    });

    const claim = await ensureClaim(user, month);
    requireEditable(claim);

    const [dcrs, saved] = await Promise.all([ExpensesDA.getApprovedDcrs(user.UserId, month, monthEnd(month)), ExpensesDA.getDays(claim.ClaimId)]);
    const days = buildDays(dcrs, saved, rate, claim.ClaimId, overrides).map(({ VisitCount, ...day }) => day);

    try {
        await ExpensesDA.replaceDays(claim.ClaimId, user.UserId, days, new Date());
    } catch (error) {
        throw lockedError(error);
    }

    return { message: 'Daily allowances updated.' };
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
        const used = items.reduce((sum, item) => sum + toPaise(item.Amount), 0);
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

    const [dcrs, saved, items] = await Promise.all([
        ExpensesDA.getApprovedDcrs(user.UserId, month, monthEnd(month)),
        ExpensesDA.getDays(claim.ClaimId),
        ExpensesDA.getItems(claim.ClaimId),
    ]);

    const days = buildDays(dcrs, saved, rate, claim.ClaimId).map(({ VisitCount, ...day }) => day);
    const totals = totalsOf(days, items.map(normalizeItem));
    if (totals.total <= 0) throw fail(400, 'There is nothing to claim yet: no approved DCR days or expenses this month.');

    if (rate.OtherMonthlyLimit != null && toPaise(totals.other) > toPaise(rate.OtherMonthlyLimit)) {
        throw fail(400, `Other expenses (₹${totals.other.toLocaleString('en-IN')}) exceed the monthly limit of ₹${rate.OtherMonthlyLimit.toLocaleString('en-IN')}.`);
    }

    // Without a reporting manager the claim goes straight to finance.
    const toStatus = user.ManagerId ? 'SUBMITTED' : 'MANAGER_APPROVED';

    try {
        await ExpensesDA.submit(claim.ClaimId, user.UserId, days, toStatus, new Date());
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
    const dayAdjust = new Map((payload.Days || []).map((day) => [lower(day.DayId), day]));
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
