const { customQuery, runInTransaction } = require('../../utils/dbFunctions');
const { generateUUID } = require('../../utils/commonUtils');
const { fail, isGuid, optionalText, requireActingUser, todayKey } = require('../../utils/access');
const { displayName, IN_TEAM, teamIdsJson } = require('../../utils/reportScope');

const missing = (error) => /Invalid object name 'dbo\.ChemistAvailability'/i.test(error?.message || '');
const guard = async (work) => {
    try {
        return await work();
    } catch (error) {
        if (missing(error)) throw fail(503, 'Chemist availability is not set up yet. Run its SQL in the database first.');
        throw error;
    }
};

const ASSIGNED = `SELECT TOP 1 1 AS Found FROM dbo.UserPharmacyMapping WHERE UserId = @UserId AND PharmacyId = @PharmacyId AND ISNULL(IsActive, 'Yes') <> 'No'`;

// Latest check of each product at a chemist.
const LATEST = `
    SELECT x.ProductId, p.ProductName, x.Available, CONVERT(VARCHAR(10), x.CheckDate, 23) AS CheckDate, x.Notes
    FROM (
        SELECT c.*, ROW_NUMBER() OVER (PARTITION BY c.ProductId ORDER BY c.CheckDate DESC, c.CreatedOn DESC) AS rn
        FROM dbo.ChemistAvailability c WHERE c.PharmacyId = @PharmacyId
    ) x
    INNER JOIN dbo.Products p ON p.ProductId = x.ProductId
    WHERE x.rn = 1`;

const INSERT = `
    INSERT INTO dbo.ChemistAvailability (CheckId, UserId, PharmacyId, ProductId, CheckDate, Available, Notes, CreatedOn)
    VALUES (@CheckId, @UserId, @PharmacyId, @ProductId, @CheckDate, @Available, @Notes, @Now)`;

// Latest status per chemist + product in the period, for the team (or the whole company for head office).
const SUMMARY = `
    WITH L AS (
        SELECT c.*, ROW_NUMBER() OVER (PARTITION BY c.PharmacyId, c.ProductId ORDER BY c.CheckDate DESC, c.CreatedOn DESC) AS rn
        FROM dbo.ChemistAvailability c
        WHERE c.CheckDate >= @Since AND (c.UserId = @ActingUserId OR ${IN_TEAM('c.UserId')})
    )
    SELECT L.PharmacyId, ph.PharmacyName, ar.AreaName, L.ProductId, p.ProductName, L.Available, CONVERT(VARCHAR(10), L.CheckDate, 23) AS CheckDate,
           ${displayName('u')} AS CheckedBy
    FROM L
    INNER JOIN Pharmacy ph ON ph.PharmacyId = L.PharmacyId
    INNER JOIN dbo.Products p ON p.ProductId = L.ProductId
    INNER JOIN Users u ON u.UserId = L.UserId
    LEFT JOIN Areas ar ON ar.AreaId = ph.AreaId
    WHERE L.rn = 1`;

exports.getForChemist = async (actingUserId, query) => {
    requireActingUser(actingUserId);
    if (!isGuid(query.pharmacyId)) throw fail(400, 'Choose the chemist.');
    return guard(async () => ({ items: await customQuery(LATEST, { PharmacyId: query.pharmacyId }) }));
};

// A rep's check at one of their chemists: each product on the shelf or not.
exports.record = async (actingUserId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(payload.PharmacyId)) throw fail(400, 'Choose the chemist.');
    const items = Array.isArray(payload.Items) ? payload.Items : [];
    if (!items.length) throw fail(400, 'Mark at least one product.');
    if (items.length > 60) throw fail(400, 'At most 60 products per check.');
    if (!(await customQuery(ASSIGNED, { UserId: actingUserId, PharmacyId: payload.PharmacyId })).length) throw fail(403, 'This chemist is not assigned to you.');

    const seen = new Set();
    const now = new Date();
    const notes = optionalText(payload.Notes, 300, 'Notes');
    const queries = items.map((item, i) => {
        if (!isGuid(item.ProductId)) throw fail(400, `Line ${i + 1}: choose a product.`);
        const key = String(item.ProductId).toLowerCase();
        if (seen.has(key)) throw fail(400, 'Each product can be marked once per check.');
        seen.add(key);
        return {
            sqlQuery: INSERT,
            inputs: { CheckId: generateUUID(), UserId: actingUserId, PharmacyId: payload.PharmacyId, ProductId: item.ProductId, CheckDate: todayKey(), Available: item.Available ? 1 : 0, Notes: notes, Now: now },
        };
    });
    return guard(async () => {
        await runInTransaction(queries);
        const out = items.filter((i) => !i.Available).length;
        return { message: out ? `Saved. ${out} product(s) missing at this chemist - your manager will see it.` : 'Saved. All marked products are on the shelf.' };
    });
};

// Stock-outs across the team: products missing at chemists (latest check in the last N days).
exports.getSummary = async (actingUserId, query) => {
    requireActingUser(actingUserId);
    const days = Math.min(Math.max(Number(query.days) || 30, 7), 120);
    const since = (() => {
        const d = new Date();
        d.setDate(d.getDate() - days);
        return todayKey(d);
    })();
    return guard(async () => {
        const rows = await customQuery(SUMMARY, { ActingUserId: actingUserId, TeamIds: await teamIdsJson(actingUserId), Since: since });
        const byProduct = new Map();
        rows.forEach((r) => {
            const key = String(r.ProductId).toLowerCase();
            if (!byProduct.has(key)) byProduct.set(key, { productId: r.ProductId, productName: r.ProductName, checked: 0, missing: [] });
            const p = byProduct.get(key);
            p.checked += 1;
            if (!r.Available) p.missing.push({ pharmacyId: r.PharmacyId, pharmacyName: r.PharmacyName, areaName: r.AreaName, checkDate: r.CheckDate, checkedBy: r.CheckedBy });
        });
        const products = [...byProduct.values()]
            .map((p) => ({ ...p, missingCount: p.missing.length, availability: p.checked ? Math.round(((p.checked - p.missing.length) / p.checked) * 100) : null }))
            .sort((a, b) => b.missingCount - a.missingCount);
        return { since, days, chemistsChecked: new Set(rows.map((r) => String(r.PharmacyId).toLowerCase())).size, products };
    });
};

