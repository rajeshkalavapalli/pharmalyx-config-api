// Pure rules for the field ledger (no database). Every threshold comes from `settings`, which head
// office can change per company; DEFAULTS apply when a value is missing. Money is handled in paise.

const DEFAULTS = {
    UNSUPPLIED_ALERT_DAYS: 4,
    STOCKIST_FILL_RATE_MIN: 80,
    MR_STOCK_LIMIT: 25000,
    MR_STOCK_HOLD_DAYS: 15,
    CHEMIST_DUE_BLOCK_DAYS: 60,
    SPEND_RATIO_MAX_PCT: 30,
    SPEND_RATIO_MONTHS: 3,
    FOCUS_VISIT_EFFORT: 500,
    CHEMIST_RADIUS_METERS: 200,
};

const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);
const toRupees = (paise) => Math.round(paise) / 100;
const dateKey = (value) => (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
const daysBetween = (from, to) => Math.round((new Date(`${dateKey(to)}T00:00:00Z`) - new Date(`${dateKey(from)}T00:00:00Z`)) / 86400000);
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

// ---------------------------------------------------------------------
// MR stock: balance, first-in-first-out lots, holding age
// ---------------------------------------------------------------------

// entries: [{ EntryType, Quantity, Value }] for one MR (any batches). Voided entries must be left out.
const stockTotals = (entries) => {
    const t = { issued: 0, transferredIn: 0, delivered: 0, returned: 0, transferredOut: 0, balanceQty: 0, balanceValue: 0 };
    let value = 0;
    entries.forEach((e) => {
        const qty = Number(e.Quantity) || 0;
        value += toPaise(e.Value);
        t.balanceQty += qty;
        if (e.EntryType === 'ISSUE') t.issued += qty;
        else if (e.EntryType === 'TRANSFER_IN') t.transferredIn += qty;
        else if (e.EntryType === 'DELIVERY') t.delivered -= qty;
        else if (e.EntryType === 'RETURN') t.returned -= qty;
        else if (e.EntryType === 'TRANSFER_OUT') t.transferredOut -= qty;
    });
    t.balanceValue = toRupees(value);
    return t;
};

// Value of `quantity` units taken out of a balance, at the balance's average unit value.
const outflowValue = (balanceQty, balanceValue, quantity) => {
    if (balanceQty <= 0) return 0;
    if (quantity >= balanceQty) return toRupees(toPaise(balanceValue));
    return toRupees(Math.round((toPaise(balanceValue) * quantity) / balanceQty));
};

// Lots still in the MR's hands for ONE batch: stock in (issue / transfer in) is used up oldest first.
// entries: [{ EntryDate, Quantity }] any order -> [{ date, quantity }] oldest first.
const openLots = (entries) => {
    const sorted = [...entries].sort((a, b) => dateKey(a.EntryDate).localeCompare(dateKey(b.EntryDate)) || Number(b.Quantity) - Number(a.Quantity));
    const lots = [];
    let owed = 0; // stock taken out before any lot could cover it (should not happen, kept safe)
    sorted.forEach((e) => {
        let qty = Number(e.Quantity) || 0;
        if (qty > 0) {
            const used = Math.min(owed, qty);
            owed -= used;
            qty -= used;
            if (qty > 0) lots.push({ date: dateKey(e.EntryDate), quantity: qty });
            return;
        }
        let out = -qty;
        while (out > 0 && lots.length) {
            const take = Math.min(out, lots[0].quantity);
            lots[0].quantity -= take;
            out -= take;
            if (lots[0].quantity === 0) lots.shift();
        }
        owed += out;
    });
    return lots;
};

// Lots held longer than `days` (the oldest stock first).
const heldTooLong = (lots, today, days) => lots.map((lot) => ({ ...lot, ageDays: daysBetween(lot.date, today) })).filter((lot) => lot.ageDays > days);

// Head office may issue only while the MR's stock value stays within the limit.
const issueCheck = (currentValue, addValue, limit) => {
    const after = toRupees(toPaise(currentValue) + toPaise(addValue));
    return after > Number(limit) ? { allowed: false, after, limit: Number(limit) } : { allowed: true, after, limit: Number(limit) };
};

// ---------------------------------------------------------------------
// Chemist dues: ageing and the credit rule
// ---------------------------------------------------------------------

/**
 * entries: [{ EntryDate, Amount }] (+ = owed, - = paid / written off), voided left out.
 * Payments settle the oldest dues first. Returns the balance, what is still unpaid per entry with its
 * age, the ageing buckets (0-30, 31-60, 61-90, 90+ days) and the age of the oldest unpaid due.
 */
const dueAgeing = (entries, today) => {
    const sorted = [...entries].sort((a, b) => dateKey(a.EntryDate).localeCompare(dateKey(b.EntryDate)));
    const open = [];
    let credit = 0;
    sorted.forEach((e) => {
        const amount = toPaise(e.Amount);
        if (amount > 0) {
            const used = Math.min(credit, amount);
            credit -= used;
            if (amount - used > 0) open.push({ date: dateKey(e.EntryDate), paise: amount - used, ref: e.DeliveryId || e.EntryId || null });
            return;
        }
        let pay = -amount;
        while (pay > 0 && open.length) {
            const take = Math.min(pay, open[0].paise);
            open[0].paise -= take;
            pay -= take;
            if (open[0].paise === 0) open.shift();
        }
        credit += pay; // advance / overpayment
    });

    const buckets = { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    const unpaid = open.map((item) => {
        const ageDays = Math.max(0, daysBetween(item.date, today));
        const key = ageDays <= 30 ? 'd0_30' : ageDays <= 60 ? 'd31_60' : ageDays <= 90 ? 'd61_90' : 'd90_plus';
        buckets[key] += item.paise;
        return { date: item.date, amount: toRupees(item.paise), ageDays, ref: item.ref };
    });
    const owed = open.reduce((sum, item) => sum + item.paise, 0);
    return {
        balance: toRupees(owed - credit),
        unpaid,
        buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, toRupees(v)])),
        oldestDays: unpaid.length ? Math.max(...unpaid.map((u) => u.ageDays)) : 0,
        advance: toRupees(credit),
    };
};

/**
 * New deliveries and POBs are blocked when dues are over the credit limit or older than `blockDays`.
 * limit: null = no money limit set. addAmount: value of the new delivery (0 for a POB check).
 */
const creditCheck = ({ balance, oldestDays, limit, addAmount = 0, blockDays }) => {
    const reasons = [];
    if (oldestDays > blockDays) reasons.push(`dues are ${oldestDays} days old (limit ${blockDays} days)`);
    if (limit != null) {
        const after = toRupees(toPaise(balance) + toPaise(addAmount));
        if (toPaise(balance) > toPaise(limit)) reasons.push(`dues of Rs ${balance.toLocaleString('en-IN')} are over the credit limit of Rs ${Number(limit).toLocaleString('en-IN')}`);
        else if (addAmount > 0 && toPaise(after) > toPaise(limit)) reasons.push(`this delivery would take dues to Rs ${after.toLocaleString('en-IN')}, over the credit limit of Rs ${Number(limit).toLocaleString('en-IN')}`);
    }
    return { blocked: reasons.length > 0, reasons };
};

// ---------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------

// Orders supplied / orders raised, by count and value; flagged under the minimum %.
const fillRate = ({ raised, raisedValue, supplied, suppliedValue }, minPct) => {
    const countPct = pct(Number(supplied) || 0, Number(raised) || 0);
    const valuePct = pct(Number(suppliedValue) || 0, Number(raisedValue) || 0);
    return { countPct, valuePct, flagged: countPct != null && (countPct < minPct || (valuePct != null && valuePct < minPct)) };
};

// Spend as % of net sales; flagged above the maximum, or when there is spend and no sales at all.
const spendRatio = (spend, business, maxPct) => {
    const s = toPaise(spend);
    const b = toPaise(business);
    if (s <= 0) return { pct: b > 0 ? 0 : null, flagged: false };
    if (b <= 0) return { pct: null, flagged: true };
    const ratio = Math.round((s / b) * 1000) / 10;
    return { pct: ratio, flagged: ratio > maxPct };
};

// Business per rupee of effort, where effort = spend + visits x the rupee value of a visit.
// With no effort at all, any business counts as fully responsive.
const focusScore = ({ business, spend, visits }, visitEffort) => {
    const effort = (Number(spend) || 0) + (Number(visits) || 0) * (Number(visitEffort) || 0);
    const b = Number(business) || 0;
    if (effort <= 0) return b > 0 ? b : 0;
    return Math.round((b / effort) * 100) / 100;
};

// Most responsive first; ties broken by more business.
const rankByFocus = (rows, visitEffort) =>
    rows
        .map((row) => ({ ...row, score: focusScore(row, visitEffort) }))
        .sort((a, b) => b.score - a.score || (Number(b.business) || 0) - (Number(a.business) || 0));

module.exports = {
    DEFAULTS,
    toPaise,
    toRupees,
    dateKey,
    daysBetween,
    stockTotals,
    outflowValue,
    openLots,
    heldTooLong,
    issueCheck,
    dueAgeing,
    creditCheck,
    fillRate,
    spendRatio,
    focusScore,
    rankByFocus,
};
