// Reports for MR, manager and head office (each sees their own territories / team; head office sees all):
//   - stockist fill rate (orders supplied / raised), flagged under the minimum
//   - spend (samples, schemes, special prices, doctor spend) vs net sales, flagged when spend is too high
//   - focus: which doctors, chemists, areas and products respond best to visits and spend
//
// Where the business number comes from:
//   territory / product: net sales = primary dispatch - returns (company data)
//   chemist: supplied POB value + direct supply by MRs
//   doctor: supplied POB booked for the doctor (the company has no per-doctor sales figure)

const sql = require('./sql');
const rules = require('./rules');
const { loadSettings } = require('./settings');
const { access } = require('./scope');

const { customQuery } = require('../../utils/dbFunctions');
const { SCOPE_CTE } = require('../../utils/reportScope');
const { fail } = require('../../utils/access');

const q = (name, inputs = {}) => customQuery(sql[name](), inputs);
const safe = async (name, inputs) => {
    try {
        return await q(name, inputs);
    } catch (error) {
        if (error.number === 208) return []; // a module whose tables are not installed yet
        throw error;
    }
};
const lower = (value) => String(value || '').toLowerCase();
const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const r2 = (paise) => rules.toRupees(paise);

const monthsBack = (today, months) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - months);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
};

const monthsParam = (value, fallback) => {
    if (value == null || value === '') return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 12) throw fail(400, 'Months must be from 1 to 12.');
    return n;
};

// Territories the viewer may report on (null = all).
const visibleTerritories = async (scope) => {
    if (scope.viewAll) return null;
    const rows = await q('TERRITORIES_OF_USERS', { Users: JSON.stringify(scope.userIds.map(String)) });
    return new Set(rows.map((row) => lower(row.TerritoryId)));
};
const inScope = (territories, territoryId) => territories === null || territories.has(lower(territoryId));

// Adds paise into a Map of rows keyed by id.
const bump = (map, id, make, field, paise) => {
    if (!id) return;
    const key = lower(id);
    if (!map.has(key)) map.set(key, make());
    map.get(key)[field] += paise;
};

// =========================================================
// Stockist fill rate
// =========================================================

exports.fillRate = async (actingUserId, query) => {
    const scope = await access(actingUserId, 'ledger.approve');
    const settings = await loadSettings();
    const today = todayIst();
    const months = monthsParam(query.months, 3);
    const from = `${monthsBack(today, months - 1).slice(0, 7)}-01`;
    const rows = await customQuery(sql.FILL_RATE(SCOPE_CTE), { ActingUserId: actingUserId, ViewAll: scope.viewAll ? 1 : 0, From: from, To: today, Today: today, Days: settings.UNSUPPLIED_ALERT_DAYS });

    const stockists = new Map();
    rows.forEach((row) => {
        const key = lower(row.StockistId);
        if (!stockists.has(key)) stockists.set(key, { StockistId: row.StockistId, StockistName: row.StockistName, raised: 0, raisedValue: 0, supplied: 0, suppliedValue: 0, overdue: 0, months: [] });
        const s = stockists.get(key);
        const m = { month: new Date(row.Month).toISOString().slice(0, 10), raised: Number(row.Raised), raisedValue: Number(row.RaisedValue), supplied: Number(row.Supplied), suppliedValue: Number(row.SuppliedValue) };
        s.months.push({ ...m, ...rules.fillRate(m, settings.STOCKIST_FILL_RATE_MIN) });
        s.raised += m.raised;
        s.raisedValue += m.raisedValue;
        s.supplied += m.supplied;
        s.suppliedValue += m.suppliedValue;
        s.overdue += Number(row.Overdue) || 0;
    });
    const list = [...stockists.values()]
        .map((s) => ({ ...s, raisedValue: Math.round(s.raisedValue), suppliedValue: Math.round(s.suppliedValue), months: s.months.sort((a, b) => a.month.localeCompare(b.month)), ...rules.fillRate(s, settings.STOCKIST_FILL_RATE_MIN) }))
        .sort((a, b) => Number(b.flagged) - Number(a.flagged) || (a.countPct ?? 101) - (b.countPct ?? 101));
    return { from, to: today, minPct: settings.STOCKIST_FILL_RATE_MIN, unsuppliedDays: settings.UNSUPPLIED_ALERT_DAYS, stockists: list };
};

// =========================================================
// Spend and business sources for a window
// =========================================================

const loadWindow = async (from, to) => {
    const inputs = { From: from, To: to };
    const [samples, schemes, paid, net, netByProduct, chemists, doctorBusiness, visits, areas, territories] = await Promise.all([
        q('SAMPLE_SPEND', inputs),
        safe('SCHEME_SPEND', inputs),
        safe('DOCTOR_SPEND_PAID', inputs),
        q('NET_BY_TERRITORY', inputs),
        q('NET_BY_PRODUCT', inputs),
        safe('CHEMIST_BUSINESS', inputs),
        q('DOCTOR_BUSINESS', inputs),
        q('DOCTOR_VISITS', inputs),
        q('AREAS'),
        q('TERRITORY_NAMES'),
    ]);
    return { samples, schemes, paid, net, netByProduct, chemists, doctorBusiness, visits, areas, territories };
};

// Doctor info for ids that only appear in spend rows.
const doctorInfo = async (ids, known) => {
    const missing = [...ids].filter((id) => !known.has(id));
    if (!missing.length) return known;
    (await q('DOCTOR_NAMES', { Doctors: JSON.stringify(missing) })).forEach((row) => known.set(lower(row.DoctorId), row));
    return known;
};

// =========================================================
// Spend vs business
// =========================================================

exports.spendVsBusiness = async (actingUserId, query) => {
    const scope = await access(actingUserId, 'ledger.approve');
    const settings = await loadSettings();
    const months = monthsParam(query.months, settings.SPEND_RATIO_MONTHS);
    const to = todayIst();
    const from = monthsBack(to, months);
    const data = await loadWindow(from, to);
    const territories = await visibleTerritories(scope);
    const tName = new Map(data.territories.map((t) => [lower(t.TerritoryId), t.TerritoryName]));

    const empty = () => ({ samples: 0, schemes: 0, doctorSpend: 0, business: 0 });
    const byTerritory = new Map();
    const byDoctor = new Map();
    const byChemist = new Map();
    const doctors = new Map();
    const chemistNames = new Map();

    data.samples.forEach((row) => {
        const p = rules.toPaise(row.Value);
        bump(byTerritory, row.TerritoryId, empty, 'samples', p);
        bump(byDoctor, row.DoctorId, empty, 'samples', p);
        doctors.set(lower(row.DoctorId), row);
    });
    data.schemes.forEach((row) => {
        const p = rules.toPaise(row.Value);
        bump(byTerritory, row.TerritoryId, empty, 'schemes', p);
        if (row.DoctorId) bump(byDoctor, row.DoctorId, empty, 'schemes', p);
        if (row.PharmacyId) bump(byChemist, row.PharmacyId, empty, 'schemes', p);
    });
    data.paid.forEach((row) => {
        const p = rules.toPaise(row.Value);
        bump(byTerritory, row.TerritoryId, empty, 'doctorSpend', p);
        bump(byDoctor, row.DoctorId, empty, 'doctorSpend', p);
    });
    data.net.forEach((row) => bump(byTerritory, row.TerritoryId, empty, 'business', rules.toPaise(row.Net)));
    data.doctorBusiness.forEach((row) => bump(byDoctor, row.DoctorId, empty, 'business', rules.toPaise(row.Business)));
    data.chemists.forEach((row) => {
        bump(byChemist, row.PharmacyId, empty, 'business', rules.toPaise(row.Business));
        chemistNames.set(lower(row.PharmacyId), row);
    });
    data.visits.forEach((row) => doctors.set(lower(row.DoctorId), row));
    await doctorInfo(byDoctor.keys(), doctors);

    const finish = (map, info) =>
        [...map.entries()]
            .map(([id, v]) => {
                const spend = v.samples + v.schemes + v.doctorSpend;
                const meta = info(id);
                if (!meta || !inScope(territories, meta.territoryId)) return null;
                return { id, ...meta, samples: r2(v.samples), schemes: r2(v.schemes), doctorSpend: r2(v.doctorSpend), spend: r2(spend), business: r2(v.business), ...rules.spendRatio(r2(spend), r2(v.business), settings.SPEND_RATIO_MAX_PCT) };
            })
            .filter((row) => row && (row.spend > 0 || row.business > 0))
            .sort((a, b) => Number(b.flagged) - Number(a.flagged) || b.spend - a.spend);

    // Chemists only reached through schemes may not be in the business rows: look their names up.
    const chemistIds = [...byChemist.keys()].filter((id) => !chemistNames.has(id));
    if (chemistIds.length) (await q('PHARMACY_NAMES', { Pharmacies: JSON.stringify(chemistIds) })).forEach((row) => chemistNames.set(lower(row.PharmacyId), row));
    const chemistTerritory = new Map(data.schemes.filter((s) => s.PharmacyId).map((s) => [lower(s.PharmacyId), s.TerritoryId]));

    return {
        from,
        to,
        months,
        maxPct: settings.SPEND_RATIO_MAX_PCT,
        territories: finish(byTerritory, (id) => ({ name: tName.get(id) || 'Territory', territoryId: id })),
        doctors: finish(byDoctor, (id) => {
            const d = doctors.get(id);
            return d ? { name: d.DoctorName, territoryId: d.TerritoryId, territory: tName.get(lower(d.TerritoryId)) || '' } : null;
        }),
        chemists: finish(byChemist, (id) => {
            const c = chemistNames.get(id);
            const territoryId = c?.TerritoryId || chemistTerritory.get(id);
            return c ? { name: c.PharmacyName, territoryId, territory: tName.get(lower(territoryId)) || '' } : null;
        }),
    };
};

// =========================================================
// Focus: most to least responsive
// =========================================================

exports.focus = async (actingUserId, query) => {
    const scope = await access(actingUserId, 'ledger.approve');
    const settings = await loadSettings();
    const months = monthsParam(query.months, 3);
    const to = todayIst();
    const from = monthsBack(to, months);
    const data = await loadWindow(from, to);
    const territories = await visibleTerritories(scope);
    const effort = settings.FOCUS_VISIT_EFFORT;
    const tName = new Map(data.territories.map((t) => [lower(t.TerritoryId), t.TerritoryName]));
    const areaOf = new Map(data.areas.map((a) => [lower(a.AreaId), a]));

    const zero = () => ({ business: 0, spend: 0, visits: 0 });
    const doctor = new Map();
    const chemist = new Map();
    const area = new Map();
    const product = new Map();
    const doctorMeta = new Map();
    const chemistMeta = new Map();

    data.visits.forEach((row) => {
        doctorMeta.set(lower(row.DoctorId), row);
        bump(doctor, row.DoctorId, zero, 'visits', Number(row.Visits));
        bump(area, row.AreaId, zero, 'visits', Number(row.Visits));
    });
    data.samples.forEach((row) => {
        const p = rules.toPaise(row.Value);
        doctorMeta.set(lower(row.DoctorId), row);
        bump(doctor, row.DoctorId, zero, 'spend', p);
        bump(area, row.AreaId, zero, 'spend', p);
        if (row.ProductId) bump(product, row.ProductId, zero, 'spend', p);
    });
    data.paid.forEach((row) => {
        const p = rules.toPaise(row.Value);
        bump(doctor, row.DoctorId, zero, 'spend', p);
        bump(area, row.AreaId, zero, 'spend', p);
    });
    data.schemes.forEach((row) => {
        const p = rules.toPaise(row.Value);
        if (row.DoctorId) bump(doctor, row.DoctorId, zero, 'spend', p);
        if (row.PharmacyId) bump(chemist, row.PharmacyId, zero, 'spend', p);
        bump(area, row.PharmacyAreaId || row.DoctorAreaId, zero, 'spend', p);
        if (row.ProductId) bump(product, row.ProductId, zero, 'spend', p);
    });
    data.doctorBusiness.forEach((row) => bump(doctor, row.DoctorId, zero, 'business', rules.toPaise(row.Business)));
    data.chemists.forEach((row) => {
        chemistMeta.set(lower(row.PharmacyId), row);
        const p = rules.toPaise(row.Business);
        bump(chemist, row.PharmacyId, zero, 'business', p);
        bump(chemist, row.PharmacyId, zero, 'visits', Number(row.Events));
        bump(area, row.AreaId, zero, 'business', p);
    });
    const productNames = new Map();
    data.netByProduct.forEach((row) => {
        if (!inScope(territories, row.TerritoryId)) return;
        productNames.set(lower(row.ProductId), row.ProductName);
        bump(product, row.ProductId, zero, 'business', rules.toPaise(row.Net));
    });
    await doctorInfo(doctor.keys(), doctorMeta);

    const out = (map, meta) =>
        rules.rankByFocus(
            [...map.entries()]
                .map(([id, v]) => {
                    const m = meta(id);
                    if (!m) return null;
                    return { id, ...m, business: r2(v.business), spend: r2(v.spend), visits: v.visits };
                })
                .filter((row) => row && (row.business > 0 || row.spend > 0 || row.visits > 0)),
            effort
        ).slice(0, 200);

    return {
        from,
        to,
        months,
        visitEffort: effort,
        doctors: out(doctor, (id) => {
            const d = doctorMeta.get(id);
            return d && inScope(territories, d.TerritoryId) ? { name: d.DoctorName, territory: tName.get(lower(d.TerritoryId)) || '' } : null;
        }),
        chemists: out(chemist, (id) => {
            const c = chemistMeta.get(id);
            return c && inScope(territories, c.TerritoryId) ? { name: c.PharmacyName, territory: tName.get(lower(c.TerritoryId)) || '' } : null;
        }),
        areas: out(area, (id) => {
            const a = areaOf.get(id);
            return a && inScope(territories, a.TerritoryId) ? { name: a.AreaName, territory: tName.get(lower(a.TerritoryId)) || '' } : null;
        }),
        products: out(product, (id) => (productNames.has(id) ? { name: productNames.get(id), territory: '' } : null)),
    };
};
