const RcpaDA = require('./RcpaDA');

const { generateUUID } = require('../../utils/commonUtils');
const {
    fail,
    isGuid,
    optionalText,
    requireActingUser,
    resolveViewUser,
    todayKey,
    toDateKey,
    toMonthStart,
} = require('../../utils/access');

const MAX_BACKDATE_DAYS = 31;
const MAX_LINES = 20;
const MAX_QUANTITY = 100000;

const addDays = (key, days) => {
    const date = new Date(`${key}T00:00:00`);
    date.setDate(date.getDate() + days);
    return todayKey(date);
};

const monthEnd = (monthStart) => {
    const date = new Date(`${monthStart}T00:00:00`);
    return todayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
};

const toQuantity = (value, label) => {
    const quantity = value === '' || value == null ? 0 : Number(value);

    if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY) {
        throw fail(400, `${label} must be a whole number between 0 and ${MAX_QUANTITY}.`);
    }

    return quantity;
};

const share = (ours, theirs) => (ours + theirs ? Math.round((ours / (ours + theirs)) * 100) : null);

// =========================================================
// READS
// =========================================================

exports.getRcpa = async (actingUserId, query) => {
    const userId = await resolveViewUser(actingUserId, query.userId, 'RCPA');
    const fromDate = toMonthStart(query.month || todayKey().slice(0, 7));
    const toDate = monthEnd(fromDate);

    const [entries, lines] = await Promise.all([
        RcpaDA.getEntries(userId, fromDate, toDate),
        RcpaDA.getLines(userId, fromDate, toDate),
    ]);

    const linesByEntry = new Map();

    lines.forEach((line) => {
        const key = String(line.RcpaId).toLowerCase();
        linesByEntry.set(key, [...(linesByEntry.get(key) || []), line]);
    });

    // Per-product totals and the competitor brands seen against each product.
    const products = new Map();
    const competitors = new Map();

    lines.forEach((line) => {
        const product = products.get(line.ProductId) || {
            ProductId: line.ProductId,
            ProductName: line.ProductName,
            ours: 0,
            competitor: 0,
        };

        product.ours += line.OurQuantity;
        product.competitor += line.CompetitorQuantity;
        products.set(line.ProductId, product);

        if (line.CompetitorBrand && line.CompetitorQuantity > 0) {
            const brandKey = line.CompetitorBrand.trim().toLowerCase();
            const brand = competitors.get(brandKey) || {
                brand: line.CompetitorBrand.trim(),
                company: line.CompetitorCompany || null,
                quantity: 0,
                againstProducts: new Set(),
            };

            brand.quantity += line.CompetitorQuantity;
            brand.againstProducts.add(line.ProductName);
            competitors.set(brandKey, brand);
        }
    });

    const ours = lines.reduce((sum, line) => sum + line.OurQuantity, 0);
    const theirs = lines.reduce((sum, line) => sum + line.CompetitorQuantity, 0);

    return {
        month: fromDate,
        summary: {
            audits: entries.length,
            chemists: new Set(entries.map((entry) => String(entry.PharmacyId).toLowerCase())).size,
            doctors: new Set(entries.map((entry) => String(entry.DoctorId).toLowerCase())).size,
            ourQuantity: ours,
            competitorQuantity: theirs,
            share: share(ours, theirs),
        },
        products: [...products.values()]
            .map((product) => ({ ...product, share: share(product.ours, product.competitor) }))
            .sort((a, b) => b.ours + b.competitor - (a.ours + a.competitor)),
        competitors: [...competitors.values()]
            .map((brand) => ({ ...brand, againstProducts: [...brand.againstProducts] }))
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 8),
        entries: entries.map((entry) => ({
            ...entry,
            lines: linesByEntry.get(String(entry.RcpaId).toLowerCase()) || [],
        })),
    };
};

exports.getPharmacies = async (actingUserId) => {
    requireActingUser(actingUserId);
    return { pharmacies: await RcpaDA.getPharmacies(actingUserId) };
};

// =========================================================
// CREATE
// =========================================================

exports.createRcpa = async (actingUserId, payload) => {
    requireActingUser(actingUserId);

    const today = todayKey();
    const auditDate = toDateKey(payload.AuditDate, 'Audit date');

    if (auditDate > today) throw fail(400, 'Audit date cannot be in the future.');
    if (auditDate < addDays(today, -MAX_BACKDATE_DAYS)) {
        throw fail(400, `Audits older than ${MAX_BACKDATE_DAYS} days cannot be recorded.`);
    }

    if (!isGuid(payload.PharmacyId)) throw fail(400, 'Chemist is required.');
    if (!isGuid(payload.DoctorId)) throw fail(400, 'Doctor is required.');

    const [pharmacyOk, doctorOk, activeProducts] = await Promise.all([
        RcpaDA.isPharmacyMapped(actingUserId, payload.PharmacyId),
        RcpaDA.isDoctorMapped(actingUserId, payload.DoctorId),
        RcpaDA.getActiveProductIds(),
    ]);

    if (!pharmacyOk) throw fail(400, 'This chemist is not assigned to you.');
    if (!doctorOk) throw fail(400, 'This doctor is not assigned to you.');

    const rawLines = Array.isArray(payload.Lines) ? payload.Lines : [];

    if (rawLines.length === 0) throw fail(400, 'Add at least one product.');
    if (rawLines.length > MAX_LINES) throw fail(400, `At most ${MAX_LINES} products per audit.`);

    const rcpaId = generateUUID();
    const seen = new Set();

    const lines = rawLines.map((line, index) => {
        const label = `Line ${index + 1}`;

        if (!isGuid(line?.ProductId) || !activeProducts.has(String(line.ProductId).toLowerCase())) {
            throw fail(400, `${label}: choose one of our products.`);
        }

        const competitorBrand = optionalText(line.CompetitorBrand, 150, `${label} competitor brand`);
        const competitorQuantity = toQuantity(line.CompetitorQuantity, `${label} competitor quantity`);

        if (competitorQuantity > 0 && !competitorBrand) {
            throw fail(400, `${label}: name the competitor brand.`);
        }

        const key = `${String(line.ProductId).toLowerCase()}|${(competitorBrand || '').toLowerCase()}`;
        if (seen.has(key)) throw fail(400, `${label}: this product and competitor are already listed.`);
        seen.add(key);

        return {
            LineId: generateUUID(),
            RcpaId: rcpaId,
            ProductId: line.ProductId,
            OurQuantity: toQuantity(line.OurQuantity, `${label} our quantity`),
            CompetitorBrand: competitorBrand,
            CompetitorCompany: optionalText(line.CompetitorCompany, 150, `${label} competitor company`),
            CompetitorQuantity: competitorQuantity,
        };
    });

    await RcpaDA.createEntry(
        {
            RcpaId: rcpaId,
            UserId: actingUserId,
            AuditDate: auditDate,
            PharmacyId: payload.PharmacyId,
            DoctorId: payload.DoctorId,
            Remarks: optionalText(payload.Remarks, 500, 'Remarks'),
            CreatedOn: new Date(),
        },
        lines
    );

    return { message: 'RCPA saved.', RcpaId: rcpaId };
};
