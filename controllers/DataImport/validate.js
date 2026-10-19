// Checks every row of an import before anything is saved. Pure: all database data
// arrives in `ctx` (built by ImportDA.loadContext), so this file is easy to test.
//
// Goal: accept as much of the file as possible. Messy values are cleaned, missing
// territories / areas / states are planned as new records (places.js), duplicates
// inside the file are merged, and only real problems become errors.
//
// For each row it returns the cleaned values, messages (errors block the row,
// warnings don't, info is just shown), the existing record it matches, and what
// importing will do: CREATE a new record, UPDATE the matched one, or SKIP the row.
const { ENTITIES, isMatchable } = require('./entities');
const { lookupKey, isBlankCell } = require('./keys');
const { createPlaces } = require('./places');
const { checkStatement } = require('./statement');
const {
    normalizeName,
    normalizeSpeciality,
    normalizePhone,
    normalizeRegistration,
    nameSimilarity,
} = require('../../utils/doctorMatching');

const POSSIBLE_DUPLICATE = 0.9; // doctor name similarity that needs a human look
const MAX_UNRESOLVED_ROWS = 5; // row numbers listed per unknown value
const PLACE_REFS = new Set(['STATE', 'TERRITORY', 'AREA']);
const MERGE_KINDS = new Set(['text', 'phone', 'email', 'date', 'int', 'enum']);

// Names that are a place, not a person.
const NOT_A_PERSON = /\b(hospitals?|clinics?|climic|nursing|nurshing|medicals?|pharmacy|polyclinic|physiotherap\w*|first aid|health ?care|diagnostics?|labs?)\b/i;

const blank = (value) => value === null || value === undefined || String(value).trim() === '';

// ---------------------------------------------------------
// Value cleaners. Each returns { value } or { value, error } / { value, warning }.
// ---------------------------------------------------------

const cleanText = (raw, field) => {
    const text = String(raw).replace(/\s+/g, ' ').trim();
    if (field.max && text.length > field.max) {
        return { value: text.slice(0, field.max), warning: `${field.label} was longer than ${field.max} characters and has been shortened.` };
    }
    return { value: text };
};

const cleanPhone = (raw, field) => {
    const text = String(raw).trim();
    if (/e\+?\d+$/i.test(text)) {
        return { value: null, error: `${field.label} "${text}" was turned into a number by Excel. Format the column as Text and export again.` };
    }
    const value = text.replace(/[^\d+]/g, '');
    if (!normalizePhone(value)) return { value: value || null, warning: `${field.label} "${text}" doesn't look like a 10-digit number.` };
    if (field.max && value.length > field.max) return { value: null, warning: `${field.label} "${text}" is too long and was left out.` };
    return { value };
};

const cleanEmail = (raw, field) => {
    const text = String(raw).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return { value: null, warning: `${field.label} "${raw}" isn't a valid email and was left out.` };
    if (field.max && text.length > field.max) return { value: null, warning: `${field.label} is too long and was left out.` };
    return { value: text };
};

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const ymd = (y, m, d) => {
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
    if (y < 1900 || y > 2100) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

// Excel dates, Excel serial numbers, dd-mm-yyyy (India), dd-Mon-yyyy and yyyy-mm-dd.
const parseDate = (raw) => {
    if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : ymd(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate());

    const text = String(raw).trim();

    if (/^\d{4,5}(\.\d+)?$/.test(text)) {
        const serial = Math.floor(Number(text));
        if (serial > 0 && serial < 80000) {
            const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
            return ymd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
        }
    }

    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text);
    if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));

    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text);
    if (m) {
        const year = m[3].length === 2 ? 1900 + Number(m[3]) + (Number(m[3]) < 30 ? 100 : 0) : Number(m[3]);
        return ymd(year, Number(m[2]), Number(m[1]));
    }

    m = /^(\d{1,2})[-/ ]([a-z]{3})[a-z]*[-/ ,]+(\d{4})$/i.exec(text);
    if (m && MONTHS[m[2].toLowerCase()]) return ymd(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));

    return null;
};

const cleanDate = (raw, field) => {
    const value = parseDate(raw);
    return value ? { value } : { value: null, warning: `${field.label} "${raw}" isn't a date we recognise (use dd-mm-yyyy) and was left out.` };
};

const cleanInt = (raw, field) => {
    const number = Number(String(raw).trim());
    if (!Number.isInteger(number) || number < field.min || number > field.max) {
        return { value: null, warning: `${field.label} must be a whole number from ${field.min} to ${field.max}; "${raw}" was left out.` };
    }
    return { value: number };
};

const YES = new Set(['yes', 'y', 'true', '1', 'active', 'a', 'enabled']);
const NO = new Set(['no', 'n', 'false', '0', 'inactive', 'i', 'disabled', 'deactive', 'deactivated', 'left', 'resigned']);

const cleanActive = (raw, field) => {
    const key = lookupKey(raw);
    if (YES.has(key)) return { value: true };
    if (NO.has(key)) return { value: false };
    return { value: true, warning: `${field.label} "${raw}" isn't Yes or No; the record will be active.` };
};

const CLEANERS = { text: cleanText, code: cleanText, phone: cleanPhone, email: cleanEmail, date: cleanDate, int: cleanInt, active: cleanActive };

// ---------------------------------------------------------
// References (designation, role, division, ...) and enums.
// Places (state, territory, area) go through places.js instead.
// ---------------------------------------------------------

const splitList = (raw) =>
    String(raw)
        .split(/[,;|\n]+/)
        .map((part) => part.trim())
        .filter(Boolean);

// valueMap[field][lookupKey(raw)] -> id / enum value the admin picked.
const mapped = (valueMap, fieldKey, raw) => valueMap?.[fieldKey]?.[lookupKey(raw)] ?? null;

const resolveRef = (ctx, field, raw, valueMap) => {
    const chosen = mapped(valueMap, field.key, raw);
    const table = ctx.refs[field.ref];
    if (chosen) return [...table.values()].find((item) => String(item.id).toLowerCase() === String(chosen).toLowerCase()) || null;
    return table.get(lookupKey(raw)) || null;
};

const resolveEnum = (field, raw, valueMap) => {
    const chosen = mapped(valueMap, field.key, raw);
    if (chosen && field.values.includes(chosen)) return chosen;
    return field.values.find((value) => lookupKey(value) === lookupKey(raw)) || null;
};

// ---------------------------------------------------------
// Existing records and in-file duplicates, per entity type.
// identity: key that is the same for two rows describing the same record.
// findMatch: the existing Pharmalyx record this row is, if any.
// ---------------------------------------------------------

const firstMatch = (checks) => {
    for (const [map, key, how] of checks) {
        if (!key) continue;
        const found = map.get(key);
        if (found) return { ...found, how };
    }
    return null;
};

const placeId = (item) => (item ? String(item.id).toLowerCase() : null);

const MATCHERS = {
    TERRITORY: {
        identity: (v) => lookupKey(v.name),
        findMatch: (v, ctx) => firstMatch([[ctx.existing.byName, lookupKey(v.name), 'name']]),
        blocksCreate: () => true,
    },
    AREA: {
        identity: (v) => v.territory && `${placeId(v.territory)}|${lookupKey(v.name)}`,
        findMatch: (v, ctx) => {
            if (!v.territory || v.territory.isNew) return null;
            const area = ctx.refs.AREA.byTerritory.get(placeId(v.territory))?.get(lookupKey(v.name));
            return area ? { id: area.id, label: area.label, how: 'name' } : null;
        },
        blocksCreate: () => true, // one area name per territory (database rule)
    },
    USER: {
        identity: (v) => v.userName && `u:${v.userName.toLowerCase()}`,
        findMatch: (v, ctx) =>
            firstMatch([
                [ctx.existing.byUserName, v.userName && v.userName.toLowerCase(), 'username'],
                [ctx.existing.byEmail, v.email, 'email'],
            ]),
        blocksCreate: () => true,
    },
    DOCTOR: {
        // Same person = same name and speciality in the same area.
        identity: (v) => v.area && `${placeId(v.area)}|${normalizeName(v.name)}|${normalizeSpeciality(v.speciality)}`,
        findMatch: (v, ctx) => {
            const exact = firstMatch([
                [ctx.existing.byRegistration, normalizeRegistration(v.registrationNumber), 'registration number'],
                [ctx.existing.byMobile, normalizePhone(v.mobile), 'mobile number'],
            ]);
            if (exact) return exact;

            if (!v.territory || v.territory.isNew) return null;
            const name = normalizeName(v.name);
            const speciality = normalizeSpeciality(v.speciality);
            let best = null;
            (ctx.existing.byTerritory.get(placeId(v.territory)) || []).forEach((doctor) => {
                const score = doctor.normName === name ? 1 : nameSimilarity(name, doctor.normName);
                const sameSpeciality = !speciality || !doctor.speciality || doctor.speciality === speciality;
                if (sameSpeciality && score >= POSSIBLE_DUPLICATE && (!best || score > best.score)) best = { ...doctor, score };
            });
            if (!best) return null;
            return best.score === 1
                ? { id: best.id, label: best.label, how: 'name and speciality in the same territory' }
                : { id: best.id, label: best.label, how: `a ${Math.round(best.score * 100)}% similar name in the same territory`, possible: true };
        },
        blocksCreate: () => false,
    },
};

const outletMatcher = {
    identity: (v) => v.area && `${placeId(v.area)}|${lookupKey(v.name)}`,
    findMatch: (v, ctx) =>
        firstMatch([
            [ctx.existing.byGstin, v.gstin && lookupKey(v.gstin), 'GSTIN'],
            [ctx.existing.byLicence, v.drugLicence && lookupKey(v.drugLicence), 'drug licence number'],
            [ctx.existing.byAreaName, v.area && !v.area.isNew && `${placeId(v.area)}|${lookupKey(v.name)}`, 'name in the same area'],
            [ctx.existing.byPhone, normalizePhone(v.contact), 'contact number'],
        ]),
    blocksCreate: (match) => match.how !== 'contact number',
};
MATCHERS.CHEMIST = outletMatcher;
MATCHERS.STOCKIST = outletMatcher;

// ---------------------------------------------------------
// Row check
// ---------------------------------------------------------

const checkRow = (entityType, row, ctx, { columnMap, valueMap, defaults, places }, unresolved) => {
    const { fields } = ENTITIES[entityType];
    const values = {};
    const messages = [];
    const placeRaw = {};
    const add = (level, text, field) => text && messages.push({ level, field, text });

    const noteUnresolved = (field, raw) => {
        const list = (unresolved[field.key] = unresolved[field.key] || new Map());
        const key = lookupKey(raw);
        const entry = list.get(key) || { value: String(raw).trim(), count: 0, rows: [] };
        entry.count += 1;
        if (entry.rows.length < MAX_UNRESOLVED_ROWS) entry.rows.push(row.rowNumber);
        list.set(key, entry);
    };

    fields.forEach((field) => {
        const header = columnMap[field.key];
        const cell = header ? row.values[header] : '';
        // Blank (or "---") cells take the value set for the whole column, if any.
        const raw = isBlankCell(cell) ? (blank(defaults[field.key]) ? '' : defaults[field.key]) : cell;

        if (field.kind === 'ref' && PLACE_REFS.has(field.ref)) {
            placeRaw[field.key] = blank(raw) ? null : raw;
            return;
        }

        if (blank(raw)) {
            if (field.kind === 'active') values[field.key] = true;
            else if (field.required) add('error', `${field.label} is missing.`, field.key);
            else values[field.key] = null;
            return;
        }

        if (CLEANERS[field.kind]) {
            const result = CLEANERS[field.kind](raw, field);
            values[field.key] = result.value;
            add('error', result.error, field.key);
            add('warning', result.warning, field.key);
            if (field.required && blank(result.value) && !result.error) add('error', `${field.label} is missing.`, field.key);
            return;
        }

        if (field.kind === 'enum') {
            const value = resolveEnum(field, raw, valueMap);
            if (!value) {
                noteUnresolved(field, raw);
                add(field.required ? 'error' : 'warning', `${field.label} "${raw}" isn't one of ${field.values.join(', ')}${field.required ? '' : ' and was left out'}.`, field.key);
            }
            values[field.key] = value;
            return;
        }

        if (field.kind === 'ref') {
            const item = resolveRef(ctx, field, raw, valueMap);
            if (field.ref === 'USER') {
                // Managers may also be other rows of the same file; resolved after all rows are read.
                values[field.key] = item ? { ...item } : { pending: String(raw).trim() };
                return;
            }
            if (!item) {
                noteUnresolved(field, raw);
                add(field.required ? 'error' : 'warning', `${field.label} "${raw}" wasn't found in Pharmalyx.`, field.key);
            }
            values[field.key] = item;
            return;
        }

        if (field.kind === 'refList') {
            const items = [];
            splitList(raw).forEach((part) => {
                const item = resolveRef(ctx, field, part, valueMap);
                if (item) {
                    if (!items.some((existing) => existing.id === item.id)) items.push(item);
                } else {
                    noteUnresolved(field, part);
                    add(field.required ? 'error' : 'warning', `${field.label}: "${part}" wasn't found in Pharmalyx.`, field.key);
                }
            });
            if (field.required && !items.length && !messages.some((m) => m.field === field.key)) add('error', `${field.label} is missing.`, field.key);
            values[field.key] = items;
        }
    });

    resolveRowPlaces(fields, placeRaw, values, places, add, noteUnresolved, row.rowNumber);

    if (entityType === 'USER' && values.email) {
        const owner = ctx.existing.byEmail.get(values.email);
        const byName = values.userName && ctx.existing.byUserName.get(values.userName.toLowerCase());
        if (owner && byName && owner.id !== byName.id) add('error', `Email ${values.email} already belongs to ${owner.label}.`, 'email');
    }

    if (entityType === 'DOCTOR' && values.name && NOT_A_PERSON.test(values.name)) {
        add('warning', `"${values.name}" looks like a hospital, clinic or shop rather than a doctor. Check it before importing.`, 'name');
    }

    if (entityType === 'CHEMIST' || entityType === 'STOCKIST') {
        ['owner', 'contact', 'address'].forEach((key) => {
            if (blank(values[key])) add('info', `${fields.find((f) => f.key === key).label} is empty; you can fill it in later.`, key);
        });
    }

    return { rowNumber: row.rowNumber, values, messages, singular: ENTITIES[entityType].singular };
};

// State -> territory -> area, each filling in what the row didn't say.
const resolveRowPlaces = (fields, placeRaw, values, places, add, noteUnresolved, rowNumber) => {
    const field = (key) => fields.find((f) => f.key === key && f.kind === 'ref' && PLACE_REFS.has(f.ref));
    const stateField = field('state');
    const territoryField = field('territory');
    const areaField = field('area');
    if (!stateField && !territoryField && !areaField) return;

    const take = (f, result, raw) => {
        if (result?.note) add(result.note.level, result.note.text, f.key);
        if (result?.missing) {
            if (result.error) add('error', result.error, f.key);
            else {
                noteUnresolved(f, raw);
                add(f.required ? 'error' : 'warning', `${f.label} "${raw}" wasn't found in Pharmalyx.`, f.key);
            }
            return null;
        }
        return result?.item || null;
    };

    let stateItem = null;
    if (stateField) {
        stateItem = placeRaw.state ? take(stateField, places.state(placeRaw.state), placeRaw.state) : null;
        values.state = stateItem;
        if (!stateItem && stateField.required && !placeRaw.state) add('error', `${stateField.label} is missing.`, 'state');
    }

    let territoryItem = null;
    if (territoryField) {
        territoryItem = placeRaw.territory ? take(territoryField, places.territory(placeRaw.territory, stateItem), placeRaw.territory) : null;
    }

    if (areaField) {
        let result = null;
        if (placeRaw.area) result = places.area(placeRaw.area, territoryItem);
        else if (territoryItem) result = places.areaForTerritory(territoryItem);

        const areaItem = result ? take(areaField, result, placeRaw.area) : null;
        values.area = areaItem;
        if (!territoryItem && result?.territory) territoryItem = result.territory;
        if (!areaItem && !result?.missing) {
            add('error', placeRaw.territory ? `${areaField.label} is missing.` : `${territoryField?.label || 'Territory'} and ${areaField.label} are both missing.`, 'area');
        }
    }

    if (territoryField) {
        values.territory = territoryItem;
        if (!territoryItem && !placeRaw.territory && territoryField.required && !areaField) add('error', `${territoryField.label} is missing.`, 'territory');
    }

    new Set([values.state, values.territory, values.territory?.state, values.area]).forEach((item) => places.markUsed(item, rowNumber));
};

// Manager column: existing users, or other rows of this file (by employee code or username).
const resolveManagers = (results, ctx) => {
    const byFileKey = new Map();
    results.forEach((r) => {
        if (r.values.code) byFileKey.set(lookupKey(r.values.code), r);
        if (r.values.userName) byFileKey.set(lookupKey(r.values.userName), r);
    });

    results.forEach((r) => {
        const manager = r.values.manager;
        if (!manager?.pending) return;
        const inFile = byFileKey.get(lookupKey(manager.pending));
        if (inFile && inFile !== r) {
            r.values.manager = { row: inFile.rowNumber, label: inFile.values.userName };
        } else {
            r.values.manager = null;
            r.messages.push({ level: 'warning', field: 'manager', text: `Manager "${manager.pending}" wasn't found in Pharmalyx or in this file; the user will have no manager.` });
        }
    });

    // Reporting loops (A -> B -> A), across this file and existing users.
    const nodeOf = (r) => (r.action === 'UPDATE' && r.match ? `id:${String(r.match.id).toLowerCase()}` : `row:${r.rowNumber}`);
    const managerNode = new Map();
    ctx.managerOf.forEach((managerId, userId) => managerId && managerNode.set(`id:${userId}`, `id:${managerId}`));
    results.forEach((r) => {
        const m = r.values.manager;
        managerNode.set(nodeOf(r), m ? (m.row ? nodeOf(results.find((x) => x.rowNumber === m.row)) : `id:${String(m.id).toLowerCase()}`) : null);
    });

    results.forEach((r) => {
        const start = nodeOf(r);
        let node = managerNode.get(start);
        for (let steps = 0; node && steps < 100; steps += 1) {
            if (node === start) {
                r.messages.push({ level: 'error', field: 'manager', text: 'This manager creates a reporting loop (someone ends up reporting to themselves).' });
                break;
            }
            node = managerNode.get(node);
        }
    });
};

// Same record twice in the file: the first row is kept and gets any details only the
// later row had; the later row is skipped (the admin can still choose to create it).
// A repeated old-app code is an error: codes must be unique.
const flagInFileDuplicates = (entityType, results) => {
    const { fields } = ENTITIES[entityType];
    const firstBy = new Map();
    const codes = new Map();

    results.forEach((r) => {
        if (r.values.code) {
            const key = lookupKey(r.values.code);
            if (codes.has(key)) r.messages.push({ level: 'error', field: 'code', text: `Code "${r.values.code}" is also used on row ${codes.get(key).rowNumber}.` });
            else codes.set(key, r);
        }

        const identity = MATCHERS[entityType].identity(r.values);
        if (!identity) return;
        const first = firstBy.get(identity);
        if (!first) {
            firstBy.set(identity, r);
            return;
        }

        const filled = fields.filter((f) => MERGE_KINDS.has(f.kind) && blank(first.values[f.key]) && !blank(r.values[f.key]));
        filled.forEach((f) => (first.values[f.key] = r.values[f.key]));
        if (filled.length) first.messages.push({ level: 'info', field: null, text: `${filled.map((f) => f.label).join(', ')} taken from row ${r.rowNumber} (same ${r.singular}).` });

        r.duplicateOf = first.rowNumber;
        r.messages.push({ level: 'warning', field: null, text: `Same ${r.singular} as row ${first.rowNumber}; this row is skipped${filled.length ? ' and its extra details were added there' : ''}.` });
    });

    // Doctors: near-identical names in the same area and speciality.
    if (entityType === 'DOCTOR') {
        const groups = new Map();
        results
            .filter((r) => !r.duplicateOf && r.values.area && r.values.name)
            .forEach((r) => {
                const key = `${placeId(r.values.area)}|${normalizeSpeciality(r.values.speciality)}`;
                groups.set(key, [...(groups.get(key) || []), r]);
            });
        groups.forEach((group) => {
            group.forEach((r, i) => {
                const name = normalizeName(r.values.name);
                const earlier = group.slice(0, i).find((o) => nameSimilarity(name, normalizeName(o.values.name)) >= 0.92);
                if (earlier) r.messages.push({ level: 'warning', field: 'name', text: `Possibly the same doctor as row ${earlier.rowNumber} (${earlier.values.name}). Choose Skip if it is.` });
            });
        });
    }
};

// What importing will do with the row, given the match and the admin's choice.
const decide = (entityType, r, options, decision, ctx) => {
    const matcher = MATCHERS[entityType];
    const linkedId = r.values.code ? ctx.links.get(lookupKey(r.values.code)) : null;

    if (linkedId) r.match = { id: linkedId.id, label: linkedId.label, how: 'old-app code (imported before)' };
    else r.match = matcher.findMatch(r.values, ctx);

    const canCreate = !r.match || (!linkedId && !matcher.blocksCreate(r.match));
    const allowed = new Set(['SKIP']);
    if (canCreate) allowed.add('CREATE');
    if (r.match) allowed.add('UPDATE');
    r.allowed = [...allowed];

    let action;
    if (decision && allowed.has(decision)) action = decision;
    else if (r.duplicateOf) action = 'SKIP';
    else if (!r.match) action = 'CREATE';
    else if (linkedId) action = 'UPDATE';
    else if (r.match.possible) action = 'SKIP';
    else action = options.existing === 'UPDATE' ? 'UPDATE' : 'SKIP';
    r.action = action;

    if (r.match) {
        const what = `Matches ${r.match.label} by ${r.match.how}`;
        const outcome = { UPDATE: 'it will be updated', SKIP: 'this row will be skipped', CREATE: 'a new record will still be created' }[action];
        r.messages.push({ level: r.match.possible ? 'warning' : 'info', field: null, text: `${what}; ${outcome}.` });
    }
};

/*
 rows:    [{ rowNumber, values: {header: raw}, decision? }]
 columnMap: { field: header }, valueMap: { field: { rawKey: id } }, defaults: { field: raw }
 options: { existing: 'SKIP' | 'UPDATE', createMissing: true | false }
*/
const summarize = (results) => ({
    total: results.length,
    ready: results.filter((r) => r.status === 'READY').length,
    warnings: results.filter((r) => r.status === 'WARNING').length,
    errors: results.filter((r) => r.status === 'ERROR').length,
    create: results.filter((r) => r.action === 'CREATE').length,
    update: results.filter((r) => r.action === 'UPDATE').length,
    skip: results.filter((r) => r.action === 'SKIP').length,
});

// A stock & sales statement: the whole file is one record (see statement.js).
const checkStatementRows = (rows, ctx, places, opts) => {
    const out = checkStatement(rows, ctx, places, opts);
    const summary = summarize(out.results);
    const placeReport = places.report();
    const extra = out.plannedExtra.map((item) => ({
        type: item.type,
        id: item.id,
        label: item.label,
        parent: item.type === 'STOCKIST' ? item.territory?.label || null : null,
        count: item.count,
        rows: item.rows,
        rawKeys: [...item.rawKeys],
    }));
    const report = { planned: [...extra, ...placeReport.planned], corrected: [...placeReport.corrected, ...out.corrections] };
    summary.newPlaces = report.planned.length;
    return { results: out.results, summary, unresolved: out.unresolved, places: report, plannedRecords: [...out.plannedExtra, ...places.allPlanned()], statement: out.statement };
};

const checkRows = (entityType, rows, ctx, { columnMap, valueMap = {}, defaults = {}, options = {}, detected = null }) => {
    const unresolved = {};
    const places = createPlaces(ctx, { create: options.createMissing !== false, valueMap });
    if (entityType === 'STATEMENT') return checkStatementRows(rows, ctx, places, { columnMap, valueMap, defaults, options, detected });
    const results = rows.map((row) => checkRow(entityType, row, ctx, { columnMap, valueMap, defaults, places }, unresolved));

    flagInFileDuplicates(entityType, results);
    results.forEach((r, i) => decide(entityType, r, options, rows[i].decision, ctx));
    if (entityType === 'USER') resolveManagers(results, ctx);

    results.forEach((r) => {
        const hasError = r.messages.some((m) => m.level === 'error');
        r.status = hasError ? 'ERROR' : r.messages.some((m) => m.level === 'warning') ? 'WARNING' : 'READY';
        if (hasError) r.action = 'SKIP';
    });

    const summary = summarize(results);

    // Unknown values per matchable field, most common first.
    const unknown = Object.fromEntries(
        Object.entries(unresolved).map(([key, list]) => [key, [...list.values()].sort((a, b) => b.count - a.count)])
    );

    const placeReport = places.report();
    summary.newPlaces = placeReport.planned.length;

    return { results, summary, unresolved: unknown, places: placeReport, plannedRecords: places.allPlanned() };
};

module.exports = { checkRows, lookupKey, parseDate, isMatchable };
