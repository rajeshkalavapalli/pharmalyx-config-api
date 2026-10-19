// Recognises files that aren't a list of records, so the screen can say what the file
// really is instead of asking to match columns that will never fit.
//
// Today: a stockist's stock & sales statement (one row per product with opening, purchases,
// sales and closing stock). Its letterhead usually names the stockist.
const { lookupKey } = require('./keys');

const STATEMENT_WORDS = ['opening', 'closing', 'sales', 'sale', 'purchase', 'purchases', 'receipt', 'receipts', 'stock', 'rate', 'free', 'qty'];

const GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]\b/i;
const EMAIL = /[^\s:]+@[^\s]+\.[a-z]{2,}/i;
const PHONE = /(?:phone|ph|mobile|mob|tel)\s*[:.-]?\s*([+\d][\d\s-]{8,})/i;
// Indian states and union territories, to find the state (and the town before it) in an address.
const INDIAN_STATES = [
    'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
    'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
    'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh',
    'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

// The address line of a letterhead: a PIN code, or a street-like line with commas.
const findAddress = (preamble) =>
    preamble.find((line) => /\d{3}\s?\d{3}/.test(line) && !/phone|gstin|e-?mail/i.test(line)) ||
    preamble.find((line) => (line.match(/,/g) || []).length >= 2 && /road|street|nagar|shop|colony|floor|bazaar|lane/i.test(line)) ||
    null;

// "…TRUNK ROAD, NELLORE, ANDHRA PRADESH-524 001." -> { state: 'Andhra Pradesh', town: 'NELLORE' }
const placeOf = (address) => {
    if (!address) return { state: null, town: null };
    const key = lookupKey(address);
    const state = INDIAN_STATES.find((name) => ` ${key} `.includes(` ${lookupKey(name)} `)) || null;
    const parts = address.split(',').map((part) => part.replace(/[0-9#.-]+/g, ' ').replace(/\s+/g, ' ').trim());
    const stateAt = state ? parts.findIndex((part) => lookupKey(part).includes(lookupKey(state))) : -1;
    const before = stateAt > 0 ? parts[stateAt - 1] : null;
    const town = before && before.length >= 3 && !/road|street|shop|floor|lane|near|opp/i.test(before) ? before : null;
    return { state, town };
};

const PERIOD = /(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\s*(?:-|to)\s*(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/i;

const detectKind = (headers = [], preamble = [], rowCount = 0) => {
    const words = new Set(headers.flatMap((h) => lookupKey(h).split(' ')));
    const hits = STATEMENT_WORDS.filter((w) => words.has(w));
    const hasStockColumns = words.has('opening') || words.has('closing');
    if (hits.length < 3 || !hasStockColumns) return null;

    const text = preamble.join('\n');
    // The letterhead's first line that isn't an address, contact or title line.
    const name = preamble.find((line) => line.length >= 3 && !/\d{3}|gstin|phone|e-?mail|statement|analysis|report|stock/i.test(line)) || null;
    const period = PERIOD.exec(text);
    const address = findAddress(preamble);
    const { state, town } = placeOf(address);

    return {
        kind: 'STOCK_STATEMENT',
        label: 'Stock & sales statement',
        from: name,
        gstin: GSTIN.exec(text)?.[0]?.toUpperCase() || null,
        email: EMAIL.exec(text)?.[0]?.toLowerCase() || null,
        phone: PHONE.exec(text)?.[1]?.replace(/\D/g, '') || null,
        period: period ? `${period[1]} to ${period[2]}` : null,
        address,
        state,
        town,
        products: rowCount,
    };
};

module.exports = { detectKind };
