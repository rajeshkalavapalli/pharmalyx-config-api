// Pure rules for business tracking (no database). Every number comes from `settings`,
// which head office can change per company; DEFAULTS apply when a value is missing.

const DEFAULTS = {
    CHEMIST_RADIUS_METERS: 200,
    ORDER_QTY_MULTIPLIER: 3,
    FIRST_ORDER_MULTIPLIER: 3,
    LARGE_ORDER_MULTIPLIER: 2,
    NO_REORDER_DAYS: 60,
    MONTH_END_SPIKE_MULTIPLIER: 2,
    SLIP_HASH_DISTANCE: 6,
    NEAR_EXPIRY_DAYS: 90,
    FOLLOW_UP_AFTER_DAYS: 3,
    INCENTIVE_HOLD_MONTHS: 3,
    UNSUPPLIED_ALERT_DAYS: 4,
};

const MIN_HISTORY_ORDERS = 2; // need this many earlier orders before "x times the average" means anything
const MIN_FIRST_ORDER_SAMPLES = 5;
const SPIKE_MIN_VALUE = 1000; // ignore tiny months

const METRICS = {
    DOCTORS_MAPPED: { label: 'Doctors mapped', unit: 'count' },
    CHEMISTS_MAPPED: { label: 'Chemists mapped', unit: 'count' },
    STP_COVERAGE: { label: 'STP coverage', unit: '%' },
    CHEMISTS_SUPPLIED: { label: 'Chemists with POB marked Supplied', unit: 'count' },
    NET_SALES_PCT_COST: { label: 'Net sales as % of monthly cost', unit: '%' },
};

// ---------------------------------------------------------------------
// Money and months
// ---------------------------------------------------------------------

const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);
const toRupees = (paise) => Math.round(paise) / 100;

// YYYY-MM-01 from 'YYYY-MM-DD' text or a Date (the database returns DATE columns as Dates).
const monthOf = (date) => `${(date instanceof Date ? date.toISOString() : String(date)).slice(0, 7)}-01`;

const addMonths = (monthStart, n) => {
    const d = new Date(`${monthStart}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    return d.toISOString().slice(0, 10);
};

const monthEnd = (monthStart) => {
    const d = new Date(`${monthStart}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1, 0);
    return d.toISOString().slice(0, 10);
};

const monthsBetween = (fromMonth, toMonth) => {
    const [fy, fm] = fromMonth.split('-').map(Number);
    const [ty, tm] = toMonth.split('-').map(Number);
    return (ty - fy) * 12 + (tm - fm);
};

// Month 1 = the joining month.
const monthNumber = (joiningDate, month) => monthsBetween(monthOf(joiningDate), monthOf(month)) + 1;

const daysBetween = (from, to) => Math.round((new Date(`${String(to).slice(0, 10)}T00:00:00Z`) - new Date(`${String(from).slice(0, 10)}T00:00:00Z`)) / 86400000);

const median = (values) => {
    const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// ---------------------------------------------------------------------
// Net sales = dispatch value - returns value (per territory per month)
// ---------------------------------------------------------------------

// rows: [{ TerritoryId, Month, Value }] -> Map "territory|month" -> paise
const sumBy = (rows) => {
    const map = new Map();
    rows.forEach((row) => {
        const key = `${String(row.TerritoryId).toLowerCase()}|${monthOf(row.Month)}`;
        map.set(key, (map.get(key) || 0) + toPaise(row.Value));
    });
    return map;
};

const netSales = (dispatches, returns) => {
    const sent = sumBy(dispatches);
    const back = sumBy(returns);
    const keys = new Set([...sent.keys(), ...back.keys()]);
    return [...keys].map((key) => {
        const [territoryId, month] = key.split('|');
        const dispatched = sent.get(key) || 0;
        const returned = back.get(key) || 0;
        return { territoryId, month, dispatched: toRupees(dispatched), returned: toRupees(returned), net: toRupees(dispatched - returned) };
    });
};

// A territory shared by several MRs: each gets an equal share (no double counting).
const shareOf = (value, people) => (people > 0 ? toRupees(toPaise(value) / people) : 0);

// ---------------------------------------------------------------------
// Incentive: slabs and the 3-month holdback
// ---------------------------------------------------------------------

// Rate of the highest slab whose FromAmount the month's net sales reach (applied to the whole month).
const slabRate = (slabs, amount) => {
    const sorted = [...slabs].sort((a, b) => Number(a.FromAmount) - Number(b.FromAmount));
    let rate = 0;
    sorted.forEach((slab) => {
        if (amount >= Number(slab.FromAmount)) rate = Number(slab.RatePercent);
    });
    return rate;
};

/**
 * months: [{ month, net, returned }] for the MR (their share), any order.
 * Incentive for month M = rate x net sales of M. Held until the end of M + holdMonths.
 * Returns booked in M+1 .. M+holdMonths are deducted at the same rate (never more than earned).
 */
const incentiveLedger = (months, slabs, holdMonths, today) => {
    const byMonth = new Map(months.map((row) => [monthOf(row.month), row]));
    const todayKey = String(today).slice(0, 10);

    return [...byMonth.keys()].sort().map((month) => {
        const row = byMonth.get(month);
        const net = Math.max(0, Number(row.net) || 0);
        const rate = slabRate(slabs, net);
        const earned = toPaise((net * rate) / 100);

        let returnsAfter = 0;
        for (let i = 1; i <= holdMonths; i++) returnsAfter += toPaise(byMonth.get(addMonths(month, i))?.returned || 0);
        const deducted = Math.min(earned, Math.round((returnsAfter * rate) / 100));

        const releaseOn = monthEnd(addMonths(month, holdMonths));
        const released = todayKey > releaseOn;

        return {
            month,
            netSales: toRupees(toPaise(net)),
            rate,
            earned: toRupees(earned),
            deducted: toRupees(deducted),
            held: released ? 0 : toRupees(earned - deducted),
            released: released ? toRupees(earned - deducted) : 0,
            releaseOn,
            status: released ? 'RELEASED' : 'HELD',
        };
    });
};

// ---------------------------------------------------------------------
// Automatic order checks (flags for head office, never punishment)
// ---------------------------------------------------------------------

// Quantity more than `multiplier` x the chemist's average for this product (needs earlier orders).
const inflatedQuantity = (quantity, previousQuantities, multiplier) => {
    if (previousQuantities.length < MIN_HISTORY_ORDERS) return null;
    const average = previousQuantities.reduce((sum, q) => sum + q, 0) / previousQuantities.length;
    return quantity > multiplier * average ? { average: Math.round(average * 10) / 10, times: Math.round((quantity / average) * 10) / 10 } : null;
};

// A new chemist's first order compared with typical first orders across the company.
const largeFirstOrder = (value, otherFirstOrderValues, multiplier) => {
    if (otherFirstOrderValues.length < MIN_FIRST_ORDER_SAMPLES) return null;
    const typical = median(otherFirstOrderValues);
    return typical > 0 && value > multiplier * typical ? { typical, times: Math.round((value / typical) * 10) / 10 } : null;
};

const isLargeOrder = (value, typicalOrderValue, multiplier) => typicalOrderValue > 0 && value >= multiplier * typicalOrderValue;

// Large order and nothing since from that chemist for `days` days.
const noReorder = (orderDate, laterOrderDates, days, today) => !laterOrderDates.some((date) => date > orderDate) && daysBetween(orderDate, today) >= days;

// daily: [{ date, value }] for one territory and one finished month.
const monthEndSpike = (daily, monthStart, multiplier) => {
    const lastDays = 7;
    const end = monthEnd(monthStart);
    const total = Number(end.slice(8, 10));
    const cut = total - lastDays; // days 1..cut are "the rest of the month"
    let early = 0;
    let late = 0;
    daily.forEach((row) => {
        const day = Number(String(row.date).slice(8, 10));
        if (day > cut) late += Number(row.value) || 0;
        else early += Number(row.value) || 0;
    });
    if (late < SPIKE_MIN_VALUE) return null;
    const earlyAvg = early / cut;
    const lateAvg = late / lastDays;
    if (earlyAvg === 0) return { earlyAvg: 0, lateAvg: Math.round(lateAvg), times: null, late: Math.round(late) };
    return lateAvg > multiplier * earlyAvg ? { earlyAvg: Math.round(earlyAvg), lateAvg: Math.round(lateAvg), times: Math.round((lateAvg / earlyAvg) * 10) / 10, late: Math.round(late) } : null;
};

// Hamming distance between two 64-bit hex hashes.
const hashDistance = (a, b) => {
    if (!/^[0-9a-f]{16}$/i.test(a || '') || !/^[0-9a-f]{16}$/i.test(b || '')) return 64;
    let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
    let bits = 0;
    while (x) {
        bits += Number(x & 1n);
        x >>= 1n;
    }
    return bits;
};

// ---------------------------------------------------------------------
// Ramp-up milestones and the expected curve
// ---------------------------------------------------------------------

const evaluateMilestone = (milestone, actual) => {
    if (actual == null) return { ...milestone, actual: null, met: null };
    return { ...milestone, actual, met: Number(actual) >= Number(milestone.Target) };
};

// Expected net sales (% of cost) for a month number, from the NET_SALES_PCT_COST milestones:
// 0% in month 1, straight lines between milestones, flat after the last one.
const expectedPct = (milestones, n) => {
    const points = [{ m: 1, pct: 0 }, ...milestones.filter((x) => x.Metric === 'NET_SALES_PCT_COST').map((x) => ({ m: Number(x.MonthNumber), pct: Number(x.Target) }))]
        .sort((a, b) => a.m - b.m)
        .filter((p, i, list) => i === 0 || p.m !== list[i - 1].m);
    if (n <= points[0].m) return points[0].pct;
    for (let i = 1; i < points.length; i++) {
        if (n <= points[i].m) {
            const a = points[i - 1];
            const b = points[i];
            return a.pct + ((b.pct - a.pct) * (n - a.m)) / (b.m - a.m);
        }
    }
    return points[points.length - 1].pct;
};

// months: [{ month, cost, net }] from joining to now -> cumulative series with the expected curve.
const costVsBusiness = (months, milestones, joiningDate) => {
    let cost = 0;
    let net = 0;
    let expected = 0;
    return [...months]
        .sort((a, b) => a.month.localeCompare(b.month))
        .map((row) => {
            const n = monthNumber(joiningDate, row.month);
            cost += toPaise(row.cost);
            net += toPaise(row.net);
            expected += toPaise((Number(row.cost) * expectedPct(milestones, n)) / 100);
            return { month: row.month, monthNumber: n, cost: toRupees(toPaise(row.cost)), net: toRupees(toPaise(row.net)), cumulativeCost: toRupees(cost), cumulativeNet: toRupees(net), cumulativeExpected: toRupees(expected) };
        });
};

module.exports = {
    DEFAULTS,
    METRICS,
    toPaise,
    toRupees,
    monthOf,
    addMonths,
    monthEnd,
    monthsBetween,
    monthNumber,
    daysBetween,
    median,
    netSales,
    shareOf,
    slabRate,
    incentiveLedger,
    inflatedQuantity,
    largeFirstOrder,
    isLargeOrder,
    noReorder,
    monthEndSpike,
    hashDistance,
    evaluateMilestone,
    expectedPct,
    costVsBusiness,
};
