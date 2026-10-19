// Suggests which file column fills which Pharmalyx field.
// Order of preference: the matching saved last time for the same source app,
// then exact header/alias matches, then headers that contain an alias.
const { ENTITIES } = require('./entities');

const normalizeHeader = (text) =>
    String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

const scoreHeader = (header, field) => {
    const h = normalizeHeader(header);
    if (!h) return 0;

    const names = [field.label, field.key, ...(field.aliases || [])].map(normalizeHeader);

    if (names.includes(h)) {
        // A specific alias ("doctor name") beats a generic one ("name") for the same header.
        const exact = names.find((name) => name === h);
        return 100 + exact.length;
    }

    // "Doctor Name (as per MCI)" contains "doctor name".
    const contained = names.filter((name) => name.length >= 3 && ` ${h} `.includes(` ${name} `));
    if (contained.length) return 50 + Math.max(...contained.map((name) => name.length));

    return 0;
};

// Returns { [fieldKey]: header | null }.
const suggestColumnMap = (entityType, headers, previousMap = null) => {
    const { fields } = ENTITIES[entityType];
    const map = Object.fromEntries(fields.map((field) => [field.key, null]));
    const used = new Set();

    // 1. Last time's matching for this source app, where the columns still exist.
    if (previousMap) {
        fields.forEach((field) => {
            const header = previousMap[field.key];
            if (header && headers.includes(header) && !used.has(header)) {
                map[field.key] = header;
                used.add(header);
            }
        });
    }

    // 2. Best scores first, each header used once.
    const candidates = [];
    fields.forEach((field) => {
        if (map[field.key]) return;
        headers.forEach((header) => {
            const score = scoreHeader(header, field);
            if (score) candidates.push({ field: field.key, header, score });
        });
    });

    candidates
        .sort((a, b) => b.score - a.score)
        .forEach(({ field, header }) => {
            if (map[field] || used.has(header)) return;
            map[field] = header;
            used.add(header);
        });

    return map;
};

// Keeps only known fields and headers that exist in the file.
const cleanColumnMap = (entityType, headers, map) => {
    const { fields } = ENTITIES[entityType];
    const used = new Set();
    return Object.fromEntries(
        fields.map((field) => {
            const header = map?.[field.key];
            if (!header || !headers.includes(header) || used.has(header)) return [field.key, null];
            used.add(header);
            return [field.key, header];
        })
    );
};

// Required fields with neither a column nor a value for every row. Territory and area
// stand in for each other: one of them is enough.
const missingRequired = (entityType, map, defaults = {}) => {
    const given = (key) => Boolean(map[key] || String(defaults[key] ?? '').trim());
    const fields = ENTITIES[entityType].fields.filter((field) => field.required && !given(field.key));
    const missing = fields.filter((field) => !(field.requiredUnless && given(field.requiredUnless)));
    return missing.map((field) => field.label).filter((label, i, list) => list.indexOf(label) === i);
};

module.exports = { suggestColumnMap, cleanColumnMap, missingRequired, normalizeHeader };
