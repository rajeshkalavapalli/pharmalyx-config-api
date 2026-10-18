// What the MR, their manager and head office see: monthly review, ramp-up, cost vs business,
// incentives (held / deducted / released) and near-expiry stock. Read-only for everyone.

const sql = require('./sql');
const rules = require('./rules');
const { loadSettings } = require('./settings');

const VerifiedWork = require('../VerifiedWork/VerifiedWorkService');
const { customQuery } = require('../../utils/dbFunctions');
const { fail, toMonthStart } = require('../../utils/access');

const q = (name, inputs = {}) => customQuery(sql[name](), inputs);
const lower = (value) => String(value || '').toLowerCase();
const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const thisMonth = () => `${todayIst().slice(0, 7)}-01`;

const resolveTarget = (actingUserId, userId) => VerifiedWork.resolveTarget(actingUserId, userId);

const territoriesOf = async (userId) => q('USER_TERRITORIES', { UserId: userId });

// The MR's share of net sales per month (a territory with several MRs is split equally).
const netByMonth = async (userId, from, to) => {
    const territories = await territoriesOf(userId);
    if (!territories.length) return { territories, months: [] };

    const Territories = JSON.stringify(territories.map((t) => t.TerritoryId));
    const [dispatches, returns, people] = await Promise.all([
        q('DISPATCH_BY_MONTH', { Territories, From: from, To: to }),
        q('RETURNS_BY_MONTH', { Territories, From: from, To: to }),
        q('TERRITORY_PEOPLE', { Territories }),
    ]);
    const peopleIn = new Map(people.map((row) => [lower(row.TerritoryId), Math.max(1, Number(row.People) || 1)]));
    const share = (territoryId) => peopleIn.get(lower(territoryId)) || 1;

    const byMonth = new Map();
    const row = (month) => {
        if (!byMonth.has(month)) byMonth.set(month, { month, dispatched: 0, returned: 0, net: 0, expired: 0, damaged: 0, other: 0 });
        return byMonth.get(month);
    };

    rules.netSales(dispatches, returns).forEach((item) => {
        const target = row(item.month);
        const people = share(item.territoryId);
        target.dispatched += rules.shareOf(item.dispatched, people);
        target.returned += rules.shareOf(item.returned, people);
        target.net += rules.shareOf(item.net, people);
    });
    returns.forEach((item) => {
        const key = { EXPIRED: 'expired', DAMAGED: 'damaged' }[item.Reason] || 'other';
        row(rules.monthOf(new Date(item.Month).toISOString().slice(0, 10)))[key] += rules.shareOf(Number(item.Value), share(item.TerritoryId));
    });

    const round = (value) => rules.toRupees(rules.toPaise(value));
    return {
        territories,
        months: [...byMonth.values()]
            .map((m) => ({ ...m, dispatched: round(m.dispatched), returned: round(m.returned), net: round(m.net), expired: round(m.expired), damaged: round(m.damaged), other: round(m.other) }))
            .sort((a, b) => a.month.localeCompare(b.month)),
    };
};

// Monthly cost = salary in force that month + TA / DA from the claims.
const costByMonth = async (userId, from, to) => {
    const [salaries, allowances] = await Promise.all([q('SALARIES', { UserId: userId }), q('ALLOWANCES', { UserId: userId, From: from, To: to })]);
    const allowance = new Map(allowances.map((row) => [row.Month, Number(row.Allowances) || 0]));
    const months = [];
    for (let m = from; m <= to; m = rules.addMonths(m, 1)) {
        const salary = [...salaries].reverse().find((s) => s.EffectiveFrom <= m);
        const s = Number(salary?.MonthlySalary) || 0;
        const a = allowance.get(m) || 0;
        months.push({ month: m, salary: s, allowances: a, cost: rules.toRupees(rules.toPaise(s) + rules.toPaise(a)) });
    }
    return { months, salarySet: salaries.length > 0 };
};

const profileOf = async (userId) => {
    const profile = (await q('PROFILE', { UserId: userId }))[0];
    if (!profile) throw fail(404, 'User not found.');
    return profile;
};

// =========================================================
// Milestones
// =========================================================

const actualFor = async (actingUserId, userId, metric, month, facts) => {
    switch (metric) {
        case 'DOCTORS_MAPPED':
            return facts.mapped.Doctors;
        case 'CHEMISTS_MAPPED':
            return facts.mapped.Chemists;
        case 'STP_COVERAGE': {
            const coverage = await VerifiedWork.getCoverage(actingUserId, { userId, month: month.slice(0, 7) }).catch(() => null);
            return coverage?.summary?.percent ?? 0;
        }
        case 'CHEMISTS_SUPPLIED': {
            const pob = (await q('POB_SUMMARY', { UserId: userId, From: month, To: rules.monthEnd(month) }))[0];
            return Number(pob?.ChemistsSupplied || 0);
        }
        case 'NET_SALES_PCT_COST': {
            const net = facts.net.get(month)?.net || 0;
            const cost = facts.cost.get(month)?.cost || 0;
            return cost > 0 ? Math.round((net / cost) * 1000) / 10 : null;
        }
        default:
            return null;
    }
};

const rampFacts = async (userId, joiningMonth, to) => {
    const [mapped, net, cost] = await Promise.all([q('MAPPED_COUNTS', { UserId: userId }), netByMonth(userId, joiningMonth, rules.monthEnd(to)), costByMonth(userId, joiningMonth, to)]);
    return { mapped: mapped[0], net: new Map(net.months.map((m) => [m.month, m])), cost: new Map(cost.months.map((m) => [m.month, m])), salarySet: cost.salarySet };
};

exports.getRampUp = async (actingUserId, query) => {
    const userId = await resolveTarget(actingUserId, query.userId);
    const profile = await profileOf(userId);
    const joiningMonth = rules.monthOf(profile.JoiningDate);
    const current = thisMonth();
    const milestones = (await q('MILESTONES')).filter((m) => m.IsActive);
    const facts = await rampFacts(userId, joiningMonth, current);

    const rows = [];
    for (const milestone of milestones) {
        const month = rules.addMonths(joiningMonth, Number(milestone.MonthNumber) - 1);
        const state = month > current ? 'UPCOMING' : month === current ? 'IN_PROGRESS' : 'DONE';
        const actual = state === 'UPCOMING' ? null : await actualFor(actingUserId, userId, milestone.Metric, month, facts);
        const evaluated = rules.evaluateMilestone({ ...milestone, Target: Number(milestone.Target) }, actual);
        rows.push({
            ...evaluated,
            month,
            label: rules.METRICS[milestone.Metric]?.label || milestone.Metric,
            unit: rules.METRICS[milestone.Metric]?.unit || '',
            status: state === 'UPCOMING' ? 'UPCOMING' : evaluated.met ? 'MET' : state === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'MISSED',
        });
    }

    return {
        userId,
        name: profile.Name,
        joiningDate: profile.JoiningDate,
        joiningSet: Boolean(profile.JoiningSet),
        salarySet: facts.salarySet,
        monthNumber: rules.monthNumber(profile.JoiningDate, current),
        milestones: rows,
    };
};

// =========================================================
// Cost vs business
// =========================================================

exports.getCostVsBusiness = async (actingUserId, query) => {
    const userId = await resolveTarget(actingUserId, query.userId);
    const profile = await profileOf(userId);
    const joiningMonth = rules.monthOf(profile.JoiningDate);
    const current = thisMonth();
    const from = rules.monthsBetween(joiningMonth, current) > 23 ? rules.addMonths(current, -23) : joiningMonth;

    const [net, cost, milestones] = await Promise.all([netByMonth(userId, from, rules.monthEnd(current)), costByMonth(userId, from, current), q('MILESTONES')]);
    const netOf = new Map(net.months.map((m) => [m.month, m.net]));
    const series = rules.costVsBusiness(
        cost.months.map((m) => ({ month: m.month, cost: m.cost, net: netOf.get(m.month) || 0 })),
        milestones.filter((m) => m.IsActive),
        profile.JoiningDate
    );
    const last = series[series.length - 1] || null;

    return {
        userId,
        name: profile.Name,
        joiningDate: profile.JoiningDate,
        salarySet: cost.salarySet,
        territories: net.territories,
        series,
        summary: last
            ? {
                  cumulativeCost: last.cumulativeCost,
                  cumulativeNet: last.cumulativeNet,
                  cumulativeExpected: last.cumulativeExpected,
                  recoveredPercent: last.cumulativeCost > 0 ? Math.round((last.cumulativeNet / last.cumulativeCost) * 1000) / 10 : null,
                  vsExpected: last.cumulativeExpected > 0 ? Math.round((last.cumulativeNet / last.cumulativeExpected) * 1000) / 10 : null,
              }
            : null,
    };
};

// =========================================================
// Incentives with the holdback
// =========================================================

exports.getIncentives = async (actingUserId, query) => {
    const userId = await resolveTarget(actingUserId, query.userId);
    const settings = await loadSettings();
    const hold = settings.INCENTIVE_HOLD_MONTHS;
    const current = thisMonth();
    const from = rules.addMonths(current, -11 - hold);

    const [net, slabs] = await Promise.all([netByMonth(userId, from, rules.monthEnd(current)), q('SLABS')]);
    const ledger = rules
        .incentiveLedger(
            net.months.map((m) => ({ month: m.month, net: m.net, returned: m.returned })),
            slabs,
            hold,
            todayIst()
        )
        .filter((row) => row.month >= rules.addMonths(current, -11));

    const sum = (key) => rules.toRupees(ledger.reduce((total, row) => total + rules.toPaise(row[key]), 0));
    return {
        userId,
        holdMonths: hold,
        slabs: slabs.map((s) => ({ FromAmount: Number(s.FromAmount), RatePercent: Number(s.RatePercent) })),
        totals: { earned: sum('earned'), held: sum('held'), deducted: sum('deducted'), released: sum('released') },
        months: ledger.reverse(),
    };
};

// =========================================================
// Near-expiry stock at the territory's stockists
// =========================================================

exports.getNearExpiry = async (actingUserId, query) => {
    const userId = await resolveTarget(actingUserId, query.userId);
    const settings = await loadSettings();
    const territories = await territoriesOf(userId);
    if (!territories.length) return { userId, days: settings.NEAR_EXPIRY_DAYS, batches: [] };

    const batches = await q('NEAR_EXPIRY', { Territories: JSON.stringify(territories.map((t) => t.TerritoryId)), Today: todayIst(), Days: settings.NEAR_EXPIRY_DAYS });
    return { userId, days: settings.NEAR_EXPIRY_DAYS, batches: batches.map((b) => ({ ...b, expired: Number(b.DaysLeft) < 0 })) };
};

// =========================================================
// Monthly review (data only)
// =========================================================

exports.getReview = async (actingUserId, query) => {
    const userId = await resolveTarget(actingUserId, query.userId);
    const month = toMonthStart(query.month || thisMonth().slice(0, 7));
    const to = rules.monthEnd(month);
    const profile = await profileOf(userId);

    const [coverage, visits, pob, net, cost, flags, ramp, expiry] = await Promise.all([
        VerifiedWork.getCoverage(actingUserId, { userId, month: month.slice(0, 7) }).catch(() => null),
        q('VALID_VISITS', { UserId: userId, From: month, To: to }),
        q('POB_SUMMARY', { UserId: userId, From: month, To: to }),
        netByMonth(userId, month, to),
        costByMonth(userId, month, month),
        q('USER_FLAGS', { UserId: userId, From: month, To: to }),
        exports.getRampUp(actingUserId, { userId }),
        exports.getNearExpiry(actingUserId, { userId }),
    ]);

    const p = pob[0] || {};
    const sales = net.months.find((m) => m.month === month) || { dispatched: 0, returned: 0, net: 0, expired: 0, damaged: 0, other: 0 };
    const monthCost = cost.months.find((m) => m.month === month)?.cost || 0;
    const target = ramp.milestones.find((m) => m.Metric === 'NET_SALES_PCT_COST' && m.month === month)
        || ramp.milestones.filter((m) => m.Metric === 'NET_SALES_PCT_COST' && m.month <= month).slice(-1)[0]
        || null;

    return {
        userId,
        name: profile.Name,
        month,
        monthNumber: rules.monthNumber(profile.JoiningDate, month),
        stpCoverage: coverage?.summary?.percent ?? null,
        validVisits: Number(visits[0]?.ValidVisits || 0),
        pob: {
            chemistsOrdered: Number(p.ChemistsOrdered || 0),
            booked: Number(p.Booked || 0),
            bookedValue: Number(p.BookedValue || 0),
            supplied: Number(p.Supplied || 0),
            suppliedValue: Number(p.SuppliedValue || 0),
            verified: Number(p.Verified || 0),
        },
        sales: {
            ...sales,
            cost: monthCost,
            pctOfCost: monthCost > 0 ? Math.round((sales.net / monthCost) * 1000) / 10 : null,
            targetPct: target ? Number(target.Target) : null,
            targetFromMonth: target?.MonthNumber || null,
        },
        territories: net.territories,
        nearExpiry: expiry.batches.length,
        flags,
        milestones: ramp.milestones,
    };
};

exports._internals = { netByMonth, costByMonth };
