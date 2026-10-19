// Checks a stockist's stock & sales statement (import type STATEMENT). The whole file is one
// statement: one stockist, one month, one row per product. Pure, like validate.js.
//
//   stockist  matched by GSTIN (from the letterhead), then by name (close spellings too);
//             otherwise planned as new, with the letterhead's address, phone, email and GSTIN,
//             placed in the town its address names (or the territory typed for every row)
//   month     from the column, the value typed for every row, or the statement's period
//   products  matched by name (close spellings too); otherwise planned as new, priced at the rate
//   lines     the database needs closing = opening + receipts + returns - sales, so:
//               receipts = purchases + other in - purchase returns - other out
//               returns  = sales returns
//             a closing in the file that doesn't add up is reported and the sum is used.
const { lookupKey, isBlankCell } = require('./keys');
const { candidates, similarity } = require('./places');

const MAX_QTY = 1000000;
const SIMILAR = 0.92;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const blank = (value) => value === null || value === undefined || String(value).trim() === '';

// "Feb 2023", "February-2023", "2023-02", "02/2023", "01-02-2023 to 28-02-2023" -> "2023-02-01".
const parseMonth = (raw) => {
    if (raw instanceof Date) return `${raw.getUTCFullYear()}-${String(raw.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const text = String(raw).trim().toLowerCase();
    const ok = (y, m) => (y >= 2000 && y <= 2100 && m >= 1 && m <= 12 ? `${y}-${String(m).padStart(2, '0')}-01` : null);
    const year = (y) => (y.length === 2 ? 2000 + Number(y) : Number(y));

    let m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\s*(?:-|to)\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4}))?$/.exec(text);
    if (m) {
        // A period must stay inside one month.
        if (m[4] && (m[5] !== m[2] || year(m[6]) !== year(m[3]))) return null;
        return ok(year(m[3]), Number(m[2]));
    }
    m = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/.exec(text);
    if (m) return ok(Number(m[1]), Number(m[2]));
    m = /^(\d{1,2})[-/.](\d{4})$/.exec(text);
    if (m) return ok(Number(m[2]), Number(m[1]));
    m = /^([a-z]{3})[a-z]*[\s,'-]*(\d{2}|\d{4})$/.exec(text);
    if (m && MONTHS[m[1]]) return ok(year(m[2]), MONTHS[m[1]]);
    return null;
};

const monthLabel = (month) => new Date(`${month}T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

// "1,200", "1200.00" -> 1200. Blank -> 0.
const toQty = (raw) => {
    if (isBlankCell(raw)) return { value: 0 };
    const number = Number(String(raw).replace(/,/g, '').trim());
    if (!Number.isInteger(number) || number < 0 || number > MAX_QTY) {
        return { error: `"${raw}" isn't a whole quantity.` };
    }
    return { value: number };
};

const toMoney = (raw) => {
    if (isBlankCell(raw)) return null;
    const number = Number(String(raw).replace(/[₹,\s]|rs\.?/gi, ''));
    return Number.isFinite(number) && number >= 0 && number < 10000000 ? Math.round(number * 100) / 100 : undefined;
};

// Finds a record by exact key, then by close spelling; `list` is [[key, item]].
const findByName = (raw, list) => {
    const keys = candidates(raw);
    const map = new Map(list);
    const exact = keys.map((k) => map.get(k)).find(Boolean);
    if (exact) return { item: exact };
    let best = null;
    keys.forEach((key) =>
        list.forEach(([k, item]) => {
            const score = similarity(key, k);
            if (score >= SIMILAR && (!best || score > best.score)) best = { item, score };
        })
    );
    return best ? { item: best.item, close: true } : null;
};

const newRecord = (type, id, label, extra = {}) => Object.assign({ id, label, isNew: true, type, rawKeys: new Set(), count: 0, rows: [] }, extra);

/*
 ctx: buildContext('STATEMENT', ...) - refs.PRODUCT, refs.STOCKIST, statements, stockistOwner
 places: createPlaces(...) - for a new stockist's territory / area
 detected: what detectKind read from the letterhead ({ from, gstin, phone, email, address, town, state, period })
*/
const checkStatement = (rows, ctx, places, { columnMap, valueMap = {}, defaults = {}, options = {}, detected = null }) => {
    const create = options.createMissing !== false;
    const cell = (row, key) => {
        const header = columnMap[key];
        const raw = header ? row.values[header] : '';
        return isBlankCell(raw) ? (blank(defaults[key]) ? '' : defaults[key]) : raw;
    };
    const chosen = (field, raw) => valueMap?.[field]?.[lookupKey(raw)] ?? null;
    const unresolved = {};
    const noteUnresolved = (key, raw, rowNumber) => {
        const list = (unresolved[key] = unresolved[key] || new Map());
        const entry = list.get(lookupKey(raw)) || { value: String(raw).trim(), count: 0, rows: [] };
        entry.count += 1;
        if (entry.rows.length < 5) entry.rows.push(rowNumber);
        list.set(lookupKey(raw), entry);
    };
    const corrections = [];
    const statementErrors = [];
    const statementNotes = [];

    // ---------- the statement: stockist and month (same for every row) ----------
    const first = rows[0] || { values: {} };
    const stockistRaw = cell(first, 'stockist') || detected?.from || '';
    const monthRaw = cell(first, 'month') || detected?.period || '';

    let stockist = null;
    if (!stockistRaw) statementErrors.push('Stockist is missing. Type the stockist for every row.');
    else {
        const pick = chosen('stockist', stockistRaw);
        const byId = new Map([...ctx.refs.STOCKIST.values()].map((s) => [s.id, s]));
        if (pick && pick !== '__NEW__' && byId.has(pick)) stockist = byId.get(pick);
        else if (pick !== '__NEW__') {
            const gstin = detected?.gstin && ctx.refs.STOCKIST_GSTIN.get(lookupKey(detected.gstin));
            const found = gstin ? { item: gstin } : findByName(stockistRaw, [...ctx.refs.STOCKIST.entries()]);
            if (found) {
                stockist = found.item;
                if (gstin) statementNotes.push({ level: 'info', text: `Stockist found by GSTIN ${detected.gstin}: ${stockist.label}.` });
                if (found.close) corrections.push({ field: 'stockist', value: String(stockistRaw), key: lookupKey(stockistRaw), id: stockist.id, label: stockist.label, count: rows.length });
            }
        }
        if (!stockist && create) {
            // Where the new stockist is: the territory typed for every row, else the town in its address.
            const stateRaw = cell(first, 'state') || detected?.state || '';
            const stateItem = stateRaw ? places.state(stateRaw).item || null : null;
            const territoryRaw = cell(first, 'territory') || detected?.town || '';
            const territoryItem = territoryRaw ? places.territory(territoryRaw, stateItem).item || null : null;
            const areaRaw = cell(first, 'area');
            const areaResult = areaRaw ? places.area(areaRaw, territoryItem) : territoryItem ? places.areaForTerritory(territoryItem) : null;
            const area = areaResult?.item || null;
            const territory = territoryItem || areaResult?.territory || null;

            if (!territory || !area) {
                statementErrors.push(`${stockistRaw} is a new stockist and needs a place. Type its territory (or area) for every row.`);
            } else {
                stockist = newRecord('STOCKIST', `new:stockist:${lookupKey(stockistRaw)}`, String(stockistRaw).trim().slice(0, 100), {
                    territory,
                    area,
                    gstin: detected?.gstin || null,
                    phone: detected?.phone || '',
                    email: detected?.email || null,
                    address: (detected?.address || '').slice(0, 350),
                });
                stockist.rawKeys.add(lookupKey(stockistRaw));
                stockist.count = rows.length;
                [territory.state, territory, area].forEach((item) => places.markUsed(item, first.rowNumber));
            }
        } else if (!stockist) {
            noteUnresolved('stockist', stockistRaw, first.rowNumber);
            statementErrors.push(`Stockist "${stockistRaw}" wasn't found in Pharmalyx.`);
        }
    }

    const month = monthRaw ? parseMonth(monthRaw) : null;
    if (!monthRaw) statementErrors.push('Month is missing. Type the statement month for every row (e.g. Feb 2023).');
    else if (!month) statementErrors.push(`Month "${monthRaw}" isn't one month we recognise (e.g. Feb 2023 or 2023-02).`);

    const existing = stockist && !stockist.isNew && month ? ctx.statements.get(`${stockist.id}|${month}`) : null;
    if (existing) statementErrors.push(`${stockist.label} already has a ${monthLabel(month)} statement in Pharmalyx (${existing.toLowerCase()}).`);

    // ---------- products and lines ----------
    const productList = [...ctx.refs.PRODUCT.entries()];
    const productById = new Map([...ctx.refs.PRODUCT.values()].map((p) => [p.id, p]));
    const planned = new Map();
    const seen = new Map();

    const results = rows.map((row) => {
        const messages = statementErrors.map((text) => ({ level: 'error', field: null, text }));
        const add = (level, text, field = null) => messages.push({ level, field, text });
        const values = { stockist, month };

        // Every row must be for the same stockist and month.
        if (row !== first && columnMap.stockist && !isBlankCell(row.values[columnMap.stockist]) && lookupKey(cell(row, 'stockist')) !== lookupKey(stockistRaw)) {
            add('error', `Only one stockist per file: this row is for "${cell(row, 'stockist')}".`, 'stockist');
        }
        if (row !== first && columnMap.month && !isBlankCell(row.values[columnMap.month]) && parseMonth(cell(row, 'month')) !== month) {
            add('error', `Only one month per file: this row is for "${cell(row, 'month')}".`, 'month');
        }

        // Product.
        const productRaw = cell(row, 'product');
        let product = null;
        if (!productRaw) add('error', 'Product is missing.', 'product');
        else {
            const pick = chosen('product', productRaw);
            if (pick && pick !== '__NEW__' && productById.has(pick)) product = productById.get(pick);
            else {
                const found = pick === '__NEW__' ? null : findByName(productRaw, productList);
                if (found) {
                    product = found.item;
                    if (found.close) {
                        add('info', `Product "${productRaw}" read as ${product.label} (similar spelling).`, 'product');
                        corrections.push({ field: 'product', value: String(productRaw).trim(), key: lookupKey(productRaw), id: product.id, label: product.label, count: 1 });
                    }
                } else if (create) {
                    const key = lookupKey(productRaw);
                    product = planned.get(key) || newRecord('PRODUCT', `new:product:${key}`, String(productRaw).replace(/\s+/g, ' ').trim().slice(0, 150));
                    planned.set(key, product);
                    product.rawKeys.add(key);
                } else {
                    noteUnresolved('product', productRaw, row.rowNumber);
                    add('error', `Product "${productRaw}" wasn't found in Pharmalyx.`, 'product');
                }
            }
        }
        values.product = product;

        // Quantities.
        const qty = {};
        ['opening', 'purchases', 'saleReturn', 'otherIn', 'sales', 'purchaseReturn', 'otherOut', 'closing'].forEach((key) => {
            const result = toQty(cell(row, key));
            if (result.error) add('error', `${key === 'saleReturn' ? 'Sales returns' : key[0].toUpperCase() + key.slice(1)}: ${result.error}`, key);
            qty[key] = result.value ?? 0;
        });
        const rate = toMoney(cell(row, 'rate'));
        if (rate === undefined) add('warning', `Rate "${cell(row, 'rate')}" isn't a price; the product's own price is used.`, 'rate');

        // Fold the statement's columns into opening + receipts + returns - sales = closing.
        let receipts = qty.purchases + qty.otherIn - qty.purchaseReturn - qty.otherOut;
        let sales = qty.sales;
        if (receipts < 0) {
            add('warning', `More stock went back (${qty.purchaseReturn + qty.otherOut}) than came in (${qty.purchases + qty.otherIn}); the difference is counted with sales.`);
            sales += -receipts;
            receipts = 0;
        }
        const closing = qty.opening + receipts + qty.saleReturn - sales;
        if (closing < 0) add('error', `Sales (${sales}) are more than the stock available (${qty.opening + receipts + qty.saleReturn}).`);
        else if (columnMap.closing && !isBlankCell(row.values[columnMap.closing]) && qty.closing !== closing) {
            add('warning', `The file's closing stock (${qty.closing}) doesn't add up; ${closing} is used (opening + receipts + returns - sales).`, 'closing');
        }

        Object.assign(values, { opening: qty.opening, receipts, returns: qty.saleReturn, sales, closing, rate: rate ?? null });

        const moved = qty.opening || receipts || qty.saleReturn || sales;
        let action = 'CREATE';
        if (product) {
            const before = seen.get(String(product.id));
            if (before) {
                add('warning', `Same product as row ${before}; this row is skipped.`, 'product');
                action = 'SKIP';
            } else seen.set(String(product.id), row.rowNumber);
        }
        if (action === 'CREATE' && !moved) {
            add('info', 'No stock and no movement; nothing to record.');
            action = 'SKIP';
        }
        if (product?.isNew && action === 'CREATE') {
            product.count += 1;
            if (product.rows.length < 5) product.rows.push(row.rowNumber);
            if (rate != null && product.price == null) product.price = rate;
        }

        const hasError = messages.some((m) => m.level === 'error');
        return {
            rowNumber: row.rowNumber,
            values,
            messages: [...statementNotes, ...messages],
            singular: 'statement line',
            match: null,
            allowed: hasError ? ['SKIP'] : ['CREATE', 'SKIP'],
            action: hasError ? 'SKIP' : row.decision === 'SKIP' ? 'SKIP' : action,
            status: hasError ? 'ERROR' : messages.some((m) => m.level === 'warning') ? 'WARNING' : 'READY',
        };
    });

    const extra = [...(stockist?.isNew ? [stockist] : []), ...[...planned.values()].filter((p) => p.count > 0)];
    return {
        results,
        unresolved: Object.fromEntries(Object.entries(unresolved).map(([k, list]) => [k, [...list.values()]])),
        corrections,
        plannedExtra: extra,
        statement: stockist && month ? { stockist: stockist.label, newStockist: Boolean(stockist.isNew), month, monthLabel: monthLabel(month), owner: ctx.stockistOwner.get(stockist.id) || null } : null,
    };
};

module.exports = { checkStatement, parseMonth, monthLabel };
