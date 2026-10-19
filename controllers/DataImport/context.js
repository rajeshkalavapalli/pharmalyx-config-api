// Builds the lookups validate.js works with, from plain lists read by ImportDA.
// Pure (no database), so tests build exactly what production builds.
const { normalizeName, normalizeSpeciality, normalizePhone, normalizeRegistration } = require('../../utils/doctorMatching');
const { lookupKey } = require('./keys');

const lower = (id) => (id == null ? null : String(id).toLowerCase());

// Map of key -> item; the first record wins when two share a key.
const indexBy = (items, keysOf) => {
    const map = new Map();
    items.forEach((item) => keysOf(item).forEach((key) => key && !map.has(key) && map.set(key, item)));
    return map;
};

// Old-app codes from earlier imports also find the record.
const addLinks = (map, byId, links = []) =>
    links.forEach((link) => {
        const key = lookupKey(link.LegacyCode);
        const item = byId.get(lower(link.EntityId));
        if (item && key && !map.has(key)) map.set(key, item);
    });

const simple = (rows, keysOf) => indexBy(rows.map((r) => ({ ...r, id: lower(r.id), label: r.name })), keysOf);

/*
 lists: {
   states, divisions, designations, roles, territories, areas, users,   (rows as returned by sql.js LIST_*)
   doctors, outlets,                                                    (only for DOCTOR / CHEMIST / STOCKIST)
   links: { TERRITORY: [...], AREA: [...], USER: [...], [entityType]: [...] }   (ImportLinks rows)
 }
*/
const buildContext = (entityType, lists) => {
    const links = lists.links || {};

    const territoryItems = (lists.territories || []).map((t) => ({ id: lower(t.id), label: t.name, stateId: lower(t.StateId), countryId: lower(t.CountryId) }));
    const territoryById = new Map(territoryItems.map((t) => [t.id, t]));
    const TERRITORY = indexBy(territoryItems, (t) => [lookupKey(t.label)]);
    addLinks(TERRITORY, territoryById, links.TERRITORY);

    const areaItems = (lists.areas || []).map((a) => ({ id: lower(a.id), label: a.name, code: a.code, territoryId: lower(a.TerritoryId), territoryName: a.TerritoryName }));
    const areaById = new Map(areaItems.map((a) => [a.id, a]));
    const byCode = indexBy(areaItems, (a) => [a.code && lookupKey(a.code)]);
    addLinks(byCode, areaById, links.AREA);
    const byTerritory = new Map();
    const byName = new Map();
    areaItems.forEach((a) => {
        const key = lookupKey(a.label);
        if (!byTerritory.has(a.territoryId)) byTerritory.set(a.territoryId, new Map());
        byTerritory.get(a.territoryId).set(key, a);
        byName.set(key, [...(byName.get(key) || []), a]);
    });

    const userItems = (lists.users || []).map((u) => ({ id: lower(u.id), label: u.fullName || u.UserName, userName: u.UserName, email: u.EmailId && String(u.EmailId).toLowerCase(), managerId: lower(u.ManagerId) }));
    const userById = new Map(userItems.map((u) => [u.id, u]));
    const USER = indexBy(userItems, (u) => [u.userName && lookupKey(u.userName), u.email && lookupKey(u.email)]);
    addLinks(USER, userById, links.USER);

    const STATE = simple(lists.states || [], (s) => [lookupKey(s.name), s.code && lookupKey(s.code)]);
    STATE.forEach((s) => (s.countryId = lower(s.CountryId)));

    // The states list covers the world: prefer the country the company's territories are in.
    const countryVotes = new Map();
    territoryItems.forEach((t) => t.countryId && countryVotes.set(t.countryId, (countryVotes.get(t.countryId) || 0) + 1));
    const homeCountryId = [...countryVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || lower(lists.homeCountryId) || null;
    const STATE_HOME = homeCountryId ? new Map([...STATE.entries()].filter(([, s]) => s.countryId === homeCountryId)) : STATE;

    const ctx = {
        refs: {
            STATE,
            STATE_HOME,
            DIVISION: simple(lists.divisions || [], (d) => [lookupKey(d.name)]),
            // Designations have a short name (ASM) and a long code (AREA_SALES_MANAGER); either works.
            DESIGNATION: simple(lists.designations || [], (d) => [lookupKey(d.name), d.code && lookupKey(d.code)]),
            ROLE: simple(lists.roles || [], (r) => [lookupKey(r.name), r.code && lookupKey(r.code)]),
            TERRITORY,
            AREA: { byId: areaById, byCode, byTerritory, byName },
            USER,
        },
        existing: {},
        homeCountryId,
        features: lists.features || {},
        links: new Map(),
        managerOf: new Map(userItems.map((u) => [u.id, u.managerId])),
    };

    const ownById = new Map();
    const existing = ctx.existing;

    if (entityType === 'TERRITORY') {
        existing.byName = TERRITORY;
        territoryItems.forEach((t) => ownById.set(t.id, t));
    }
    if (entityType === 'AREA') areaItems.forEach((a) => ownById.set(a.id, { ...a, label: `${a.label} (${a.territoryName || ''})` }));
    if (entityType === 'USER') {
        existing.byUserName = indexBy(userItems, (u) => [u.userName && u.userName.toLowerCase()]);
        existing.byEmail = indexBy(userItems, (u) => [u.email]);
        userItems.forEach((u) => ownById.set(u.id, u));
    }
    if (entityType === 'DOCTOR') {
        const doctors = (lists.doctors || []).map((d) => ({
            id: lower(d.id),
            label: d.name,
            normName: d.NormalizedName || normalizeName(d.name),
            speciality: normalizeSpeciality(d.Speciality),
            mobile: normalizePhone(d.MobileNumber),
            registration: normalizeRegistration(d.RegistrationNumber),
            territoryId: lower(d.TerritoryId),
        }));
        existing.byRegistration = indexBy(doctors, (d) => [d.registration]);
        existing.byMobile = indexBy(doctors, (d) => [d.mobile]);
        existing.byTerritory = new Map();
        doctors.forEach((d) => {
            if (!existing.byTerritory.has(d.territoryId)) existing.byTerritory.set(d.territoryId, []);
            existing.byTerritory.get(d.territoryId).push(d);
            ownById.set(d.id, d);
        });
    }
    if (entityType === 'CHEMIST' || entityType === 'STOCKIST') {
        const outlets = (lists.outlets || []).map((o) => ({
            id: lower(o.id),
            label: o.name,
            gstin: o.GSTIN && lookupKey(o.GSTIN),
            licence: o.DrugLicenceNumber && lookupKey(o.DrugLicenceNumber),
            phone: normalizePhone(o.ContactNumber),
            areaName: o.AreaId && `${lower(o.AreaId)}|${lookupKey(o.name)}`,
        }));
        existing.byGstin = indexBy(outlets, (o) => [o.gstin]);
        existing.byLicence = indexBy(outlets, (o) => [o.licence]);
        existing.byPhone = indexBy(outlets, (o) => [o.phone]);
        existing.byAreaName = indexBy(outlets, (o) => [o.areaName]);
        outlets.forEach((o) => ownById.set(o.id, o));
    }

    if (entityType === 'STATEMENT') {
        const stockists = (lists.outlets || []).map((o) => ({ id: lower(o.id), label: o.name, gstin: o.GSTIN && lookupKey(o.GSTIN) }));
        ctx.refs.STOCKIST = indexBy(stockists, (s) => [lookupKey(s.label)]);
        ctx.refs.STOCKIST_GSTIN = indexBy(stockists, (s) => [s.gstin]);
        ctx.refs.PRODUCT = indexBy(
            (lists.products || []).map((p) => ({ id: lower(p.id), label: p.name, price: p.UnitPrice == null ? null : Number(p.UnitPrice), isSample: Boolean(p.IsSample) })),
            (p) => [lookupKey(p.label)]
        );
        ctx.statements = new Map((lists.statements || []).map((s) => [`${lower(s.StockistId)}|${s.StatementMonth}`, s.Status]));
        ctx.stockistOwner = new Map((lists.stockistOwners || []).map((o) => [lower(o.StockistId), lower(o.UserId)]));
    }

    (links[entityType] || []).forEach((link) => {
        const id = lower(link.EntityId);
        const item = ownById.get(id);
        const key = lookupKey(link.LegacyCode);
        if (item && key) ctx.links.set(key, { id, label: item.label });
    });

    return ctx;
};

module.exports = { buildContext };
