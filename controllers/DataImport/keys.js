// Shared text keys for matching file values to records.

// Case, spacing and punctuation don't matter ("Andhra-Pradesh" == "andhra pradesh").
const lookupKey = (value) =>
    String(value ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

// What exports put in empty cells: "---", "-", "NA", "N/A", "nil", "none", "null", ".".
const PLACEHOLDER = /^(?:-+|_+|\.+|n\s*\/?\s*a|nil+|none|null|not available)$/i;

const isBlankCell = (value) => value === null || value === undefined || String(value).trim() === '' || PLACEHOLDER.test(String(value).trim());

module.exports = { lookupKey, isBlankCell };
