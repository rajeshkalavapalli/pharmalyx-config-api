// Turns messy place values (state, territory, area) into Pharmalyx records, and plans
// new records for places Pharmalyx doesn't have yet. Pure: works on the lookups in `ctx`.
//
//   "Chittoor,17-434"     -> Chittoor           (text after a comma and numbers dropped)
//   "tirupati 9000660130" -> Tirupati
//   "madanapalli"         -> Madhanapalli       (similar spelling of a known or planned place)
//   no territory column   -> the area's territory
//   no area               -> an area named after the territory (its HQ town)
//
// Every lookup returns { item, note?, missing? }. A planned record looks like a real one
// (id, label, ...) with isNew: true; its id is replaced by a real one when importing.
const { jaroWinkler } = require('../../utils/doctorMatching');
const { lookupKey } = require('./keys');

const SIMILAR = 0.92; // spelling similarity treated as the same place
const MAX_ROWS = 5;

const compact = (key) => key.replace(/ /g, '');

const titleCase = (text) => text.toLowerCase().replace(/(^|[\s.&'-])([a-z])/g, (_, gap, letter) => gap + letter.toUpperCase());

// Ways to read one value, most literal first.
const candidates = (raw) => {
    const text = String(raw).trim();
    const head = text.split(/[,(;]/)[0];
    const noDigits = (s) => s.replace(/[0-9#]+/g, ' ');
    return [...new Set([text, head, noDigits(text), noDigits(head)].map(lookupKey).filter((key) => key.length >= 2))];
};

// Name for a new record: the part before any comma, without numbers. ALL CAPS or all
// lowercase becomes Title Case; mixed case ("New HQ") is kept as typed.
const cleanLabel = (raw) => {
    const text = String(raw)
        .split(/[,(;]/)[0]
        .replace(/[0-9#]+/g, ' ')
        .replace(/[^A-Za-z .&'-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const mixed = /[a-z]/.test(text) && /[A-Z]/.test(text);
    return (mixed ? text : titleCase(text)).slice(0, 240);
};

const similarity = (a, b) => {
    const x = compact(a);
    const y = compact(b);
    if (!x || !y || x[0] !== y[0] || Math.abs(x.length - y.length) > 3) return 0;
    return x === y ? 1 : jaroWinkler(x, y);
};

// Closest entry ([key, item]) to any of the keys, if similar enough.
const closest = (keys, entries) => {
    const list = [...entries]; // may be a one-pass iterator; every reading needs the full list
    let best = null;
    for (const key of keys) {
        for (const [entryKey, item] of list) {
            const score = similarity(key, entryKey);
            if (score >= SIMILAR && (!best || score > best.score)) best = { item, score };
        }
    }
    return best;
};

const createPlaces = (ctx, { create = true, valueMap = {} } = {}) => {
    const { STATE, TERRITORY, AREA } = ctx.refs;
    const homeStates = ctx.refs.STATE_HOME || STATE;
    const territoryById = new Map([...TERRITORY.values()].map((t) => [t.id, t]));
    const stateById = new Map([...STATE.values()].map((s) => [s.id, s]));
    const planned = { STATE: new Map(), TERRITORY: new Map(), AREA: new Map() };
    const corrected = new Map(); // "field|raw" -> { field, value, label, count }

    const chosen = (field, raw) => valueMap?.[field]?.[lookupKey(raw)] ?? null;
    const wantsNew = (field, raw) => chosen(field, raw) === '__NEW__';

    const noteCorrection = (field, raw, item) => {
        const key = `${field}|${lookupKey(raw)}`;
        const entry = corrected.get(key) || { field, value: String(raw).trim(), key: lookupKey(raw), id: item.id, label: item.label, count: 0 };
        entry.count += 1;
        corrected.set(key, entry);
    };

    // Reuses or creates a planned record; similar spellings share one.
    const plan = (type, scope, raw, make) => {
        const keys = candidates(raw);
        const inScope = [...planned[type].entries()].filter(([k]) => k.startsWith(`${scope}|`)).map(([k, item]) => [k.slice(scope.length + 1), item]);
        const exact = keys.map((k) => planned[type].get(`${scope}|${k}`)).find(Boolean);
        const item = exact || closest(keys, inScope)?.item || make(keys[keys.length - 1] || lookupKey(raw));
        // Remembered under every reading ("chittoor 17 434" and "chittoor"), so later spellings find it.
        keys.forEach((k) => !planned[type].has(`${scope}|${k}`) && planned[type].set(`${scope}|${k}`, item));
        item.rawKeys.add(lookupKey(raw));
        return item;
    };

    const newRecord = (type, id, label, extra) =>
        Object.defineProperties({ id, label, isNew: true, type, rawKeys: new Set(), count: 0, rows: [] }, Object.getOwnPropertyDescriptors(extra));

    // ---------- states ----------
    const state = (raw) => {
        const pick = chosen('state', raw);
        if (pick && pick !== '__NEW__' && stateById.has(pick)) return { item: stateById.get(pick) };

        const keys = candidates(raw);
        if (!wantsNew('state', raw)) {
            const exact = keys.map((k) => homeStates.get(k) || STATE.get(k)).find(Boolean);
            if (exact) return { item: exact };
            const near = closest(keys, homeStates.entries());
            if (near) {
                noteCorrection('state', raw, near.item);
                return { item: near.item, note: { level: 'info', text: `State "${raw}" read as ${near.item.label} (similar spelling).` } };
            }
        }
        if (!create) return { missing: true };

        const item = plan('STATE', 'all', raw, (k) => newRecord('STATE', `new:state:${k}`, cleanLabel(raw), { countryId: ctx.homeCountryId || null }));
        return { item };
    };

    // ---------- territories ----------
    const territory = (raw, stateItem) => {
        const pick = chosen('territory', raw);
        if (pick && pick !== '__NEW__' && territoryById.has(pick)) return { item: territoryById.get(pick) };

        const keys = candidates(raw);
        if (!wantsNew('territory', raw)) {
            const exact = keys.map((k) => TERRITORY.get(k)).find(Boolean);
            if (exact) return { item: exact };
            const near = closest(keys, TERRITORY.entries());
            if (near) {
                noteCorrection('territory', raw, near.item);
                return { item: near.item, note: { level: 'info', text: `Territory "${raw}" read as ${near.item.label} (similar spelling).` } };
            }
        }
        if (!create) return { missing: true };

        const item = plan('TERRITORY', 'all', raw, (k) =>
            newRecord('TERRITORY', `new:territory:${k}`, cleanLabel(raw), {
                state: stateItem || null,
                get stateId() {
                    return this.state?.id ?? null;
                },
                get countryId() {
                    return this.state?.countryId ?? null;
                },
            })
        );
        if (!item.state && stateItem) item.state = stateItem;
        return { item };
    };

    // ---------- areas ----------
    const newArea = (raw, territoryItem, label) =>
        plan('AREA', territoryItem.id, raw, (k) =>
            newRecord('AREA', `new:area:${territoryItem.id}|${k}`, label || cleanLabel(raw), {
                territory: territoryItem,
                get territoryId() {
                    return this.territory.id;
                },
                get territoryName() {
                    return this.territory.label;
                },
            })
        );

    // Returns { item, territory, note? } - territory filled in from the area when it wasn't given.
    const area = (raw, territoryItem) => {
        const territoryOf = (a) => territoryItem || territoryById.get(a.territoryId) || null;
        const pick = chosen('area', raw);
        if (pick && pick !== '__NEW__' && AREA.byId.has(pick)) {
            const a = AREA.byId.get(pick);
            return { item: a, territory: territoryOf(a) };
        }

        const keys = candidates(raw);
        if (!wantsNew('area', raw)) {
            if (territoryItem && !territoryItem.isNew) {
                const own = AREA.byTerritory.get(territoryItem.id);
                const exact = own && keys.map((k) => own.get(k)).find(Boolean);
                if (exact) return { item: exact, territory: territoryItem };
                const near = own && closest(keys, own.entries());
                if (near) {
                    noteCorrection('area', raw, near.item);
                    return { item: near.item, territory: territoryItem, note: { level: 'info', text: `Area "${raw}" read as ${near.item.label} (similar spelling).` } };
                }
            }

            const byCode = keys.map((k) => AREA.byCode.get(k)).find(Boolean);
            if (byCode && (!territoryItem || byCode.territoryId === territoryItem.id)) return { item: byCode, territory: territoryOf(byCode) };

            if (!territoryItem) {
                const named = keys.map((k) => AREA.byName.get(k)).find((list) => list?.length);
                if (named?.length === 1) return { item: named[0], territory: territoryOf(named[0]) };
                if (named?.length > 1) {
                    return { missing: true, error: `Area "${raw}" exists in more than one territory (${named.map((a) => a.territoryName).join(', ')}). Add a Territory column, or a territory for every row.` };
                }
                const unique = [...AREA.byName.entries()].filter(([, list]) => list.length === 1).map(([k, list]) => [k, list[0]]);
                const near = closest(keys, unique);
                if (near) {
                    noteCorrection('area', raw, near.item);
                    return { item: near.item, territory: territoryOf(near.item), note: { level: 'info', text: `Area "${raw}" read as ${near.item.label} (similar spelling).` } };
                }
            }
        }

        if (!territoryItem) return { missing: true, error: `Area "${raw}" isn't in Pharmalyx. Add a Territory column, or a territory for every row, so it can be created.` };
        if (!create) return { missing: true };

        const item = newArea(raw, territoryItem);
        const elsewhere = keys.map((k) => AREA.byName.get(k)).find((list) => list?.length);
        const note = elsewhere ? { level: 'warning', text: `An area called ${item.label} exists in ${elsewhere[0].territoryName}; a new one is created in ${territoryItem.label}.` } : null;
        return { item, territory: territoryItem, note };
    };

    // No area in the row: the territory's own town.
    const areaForTerritory = (territoryItem) => {
        const own = !territoryItem.isNew && AREA.byTerritory.get(territoryItem.id);
        const existing = own && own.get(lookupKey(territoryItem.label));
        const note = (label) => ({ level: 'info', text: `No area given; placed in ${label}, the territory's own area.` });
        if (existing) return { item: existing, territory: territoryItem, note: note(existing.label) };
        if (!create) return { missing: true };
        const item = newArea(territoryItem.label, territoryItem, territoryItem.label);
        return { item, territory: territoryItem, note: note(item.label) };
    };

    const markUsed = (item, rowNumber) => {
        if (!item?.isNew) return;
        item.count += 1;
        if (item.rows.length < MAX_ROWS) item.rows.push(rowNumber);
    };

    // Planned records and spelling corrections, for the review screen.
    const report = () => ({
        planned: ['STATE', 'TERRITORY', 'AREA'].flatMap((type) =>
            [...new Set(planned[type].values())]
                .filter((item) => item.count > 0)
                .map((item) => ({
                    type,
                    id: item.id,
                    label: item.label,
                    parent: type === 'AREA' ? item.territory.label : type === 'TERRITORY' ? item.state?.label || null : null,
                    count: item.count,
                    rows: item.rows,
                    rawKeys: [...item.rawKeys],
                }))
        ),
        corrected: [...corrected.values()],
    });

    const allPlanned = () => ['STATE', 'TERRITORY', 'AREA'].flatMap((type) => [...new Set(planned[type].values())]);

    return { state, territory, area, areaForTerritory, markUsed, report, allPlanned };
};

module.exports = { createPlaces, cleanLabel, candidates, similarity };
