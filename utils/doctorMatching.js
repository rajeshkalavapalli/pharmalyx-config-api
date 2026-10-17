// Duplicate-doctor matching: name normalising, fuzzy similarity and distance.
// Pure functions (no database), so they are easy to test and reuse.

const TITLES = new Set(['dr', 'doctor', 'prof', 'mr', 'mrs', 'ms']);

// "Dr. Rajesh K" and "Dr K Rajesh" -> "k rajesh":
// lowercase, dots / commas / hyphens become spaces, drop titles, sort the words.
const normalizeName = (name) =>
    String(name || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[.,\-_/()'"]+/g, ' ')
        .split(/\s+/)
        .filter((word) => word && !TITLES.has(word))
        .sort()
        .join(' ');

const normalizeSpeciality = (value) =>
    String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

// Last 10 digits, so "+91 98666-46468" and "9866646468" match.
const normalizePhone = (value) => {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : null;
};

// Registration numbers: uppercase letters and digits only ("KMC 12345" == "kmc-12345").
const normalizeRegistration = (value) => {
    const clean = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return clean.length >= 3 ? clean : null;
};

// Jaro-Winkler similarity, 0 (nothing alike) .. 1 (identical). Good for short names with typos.
const jaroWinkler = (a, b) => {
    if (a === b) return 1;
    if (!a || !b) return 0;

    const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
    const aMatched = new Array(a.length).fill(false);
    const bMatched = new Array(b.length).fill(false);
    let matches = 0;

    for (let i = 0; i < a.length; i += 1) {
        const start = Math.max(0, i - range);
        const end = Math.min(i + range + 1, b.length);
        for (let j = start; j < end; j += 1) {
            if (!bMatched[j] && a[i] === b[j]) {
                aMatched[i] = true;
                bMatched[j] = true;
                matches += 1;
                break;
            }
        }
    }

    if (!matches) return 0;

    let transpositions = 0;
    for (let i = 0, k = 0; i < a.length; i += 1) {
        if (!aMatched[i]) continue;
        while (!bMatched[k]) k += 1;
        if (a[i] !== b[k]) transpositions += 1;
        k += 1;
    }

    const jaro = (matches / a.length + matches / b.length + (matches - transpositions / 2) / matches) / 3;

    let prefix = 0;
    while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix += 1;

    return jaro + prefix * 0.1 * (1 - jaro);
};

// Similarity of two (already normalised) names. Whole-string score, plus a word-by-word score
// that tolerates an initial ("k" vs "kumar") and a missing middle name.
const nameSimilarity = (left, right) => {
    const a = normalizeName(left);
    const b = normalizeName(right);
    if (!a || !b) return 0;

    const whole = jaroWinkler(a, b);

    const aWords = a.split(' ');
    const bWords = b.split(' ');
    const [shorter, longer] = aWords.length <= bWords.length ? [aWords, bWords] : [bWords, aWords];

    const wordScore = (word, other) => {
        if (word.length === 1 || other.length === 1) return word[0] === other[0] ? 0.9 : 0; // initials
        return jaroWinkler(word, other);
    };

    const perWord = shorter.map((word) => Math.max(...longer.map((other) => wordScore(word, other))));
    const words = perWord.reduce((sum, score) => sum + score, 0) / perWord.length;

    return Math.round(Math.max(whole, words) * 1000) / 1000;
};

// Great-circle distance in metres (haversine).
const distanceMeters = (lat1, lng1, lat2, lng2) => {
    if ([lat1, lng1, lat2, lng2].some((value) => value == null || !Number.isFinite(Number(value)))) return null;

    const toRad = (deg) => (Number(deg) * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

    return Math.round(6371000 * 2 * Math.asin(Math.sqrt(h)));
};

// Lat / lng box around a point, used to pre-filter candidates in SQL before exact distances.
const boundingBox = (lat, lng, meters) => {
    const dLat = meters / 111320;
    const dLng = meters / (111320 * Math.max(0.01, Math.cos((Number(lat) * Math.PI) / 180)));
    return { MinLat: lat - dLat, MaxLat: lat + dLat, MinLng: lng - dLng, MaxLng: lng + dLng };
};

module.exports = {
    normalizeName,
    normalizeSpeciality,
    normalizePhone,
    normalizeRegistration,
    jaroWinkler,
    nameSimilarity,
    distanceMeters,
    boundingBox,
};
