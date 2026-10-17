const SalesPlanDA = require('./SalesPlanDA');

const { generateUUID } = require('../../utils/commonUtils');
const { getPermissions } = require('../../utils/permissions');
const { fail, isGuid, requireActingUser, resolveViewUser, sameId, todayKey, toMonthStart } = require('../../utils/access');

// Targets can be set for the current month and up to three months ahead.
const MONTHS_AHEAD = 3;
const MAX_QTY = 1000000;

const money = (value) => Number(value || 0);
const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);
const toRupees = (paise) => paise / 100;
const lower = (value) => String(value).toLowerCase();
const percent = (actual, target) => (target > 0 ? Math.round((actual / target) * 100) : null);

const currentMonth = () => `${todayKey().slice(0, 7)}-01`;

const shiftMonth = (monthStart, delta) => {
    const date = new Date(`${monthStart}T00:00:00`);
    return todayKey(new Date(date.getFullYear(), date.getMonth() + delta, 1));
};

const monthEnd = (monthStart) => {
    const date = new Date(`${monthStart}T00:00:00`);
    return todayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
};

const editableReason = (month) => {
    if (month < currentMonth()) return 'Targets for past months are locked.';
    if (month > shiftMonth(currentMonth(), MONTHS_AHEAD)) return `Targets can be set up to ${MONTHS_AHEAD} months ahead.`;
    return null;
};

// Targets vs achievement per product for one MR and month.
const buildPlan = async (userId, month) => {
    const [targets, secondary, pob] = await Promise.all([
        SalesPlanDA.getTargets(userId, month),
        SalesPlanDA.getSecondary(userId, month),
        SalesPlanDA.getPobSupplied(userId, month, monthEnd(month)),
    ]);

    const rows = new Map();
    const row = (item) => {
        const key = lower(item.ProductId);
        if (!rows.has(key)) {
            rows.set(key, {
                ProductId: item.ProductId,
                ProductName: item.ProductName,
                PackSize: item.PackSize || null,
                targetQty: 0,
                targetValue: 0,
                secondaryQty: 0,
                secondaryValue: 0,
                pobQty: 0,
                pobValue: 0,
            });
        }
        return rows.get(key);
    };

    targets.forEach((item) => Object.assign(row(item), { targetQty: item.TargetQty, targetValue: money(item.TargetValue), PackSize: item.PackSize }));
    secondary.forEach((item) => Object.assign(row(item), { secondaryQty: item.Qty, secondaryValue: money(item.Value) }));
    pob.forEach((item) => Object.assign(row(item), { pobQty: item.Qty, pobValue: money(item.Value) }));

    const products = [...rows.values()]
        .map((item) => ({ ...item, secondaryPercent: percent(item.secondaryQty, item.targetQty), pobPercent: percent(item.pobQty, item.targetQty) }))
        .sort((a, b) => b.targetValue - a.targetValue || a.ProductName.localeCompare(b.ProductName));

    const sum = (field) => toRupees(products.reduce((total, item) => total + toPaise(item[field]), 0));
    const target = sum('targetValue');
    const secondaryValue = sum('secondaryValue');
    const pobValue = sum('pobValue');
    const targeted = products.filter((item) => item.targetQty > 0);

    return {
        summary: {
            targetValue: target,
            secondaryValue,
            pobValue,
            secondaryPercent: percent(secondaryValue, target),
            pobPercent: percent(pobValue, target),
            targetedProducts: targeted.length,
            onTrack: targeted.filter((item) => item.secondaryQty >= item.targetQty).length,
        },
        products,
        setBy: targets[0]?.SetByName || null,
        setOn: targets.reduce((latest, item) => (!latest || item.ModifiedOn > latest ? item.ModifiedOn : latest), null),
    };
};

// One MR's plan: yourself, or a direct report.
exports.getPlan = async (actingUserId, query) => {
    const userId = await resolveViewUser(actingUserId, query.userId, 'sales plan');
    const month = toMonthStart(query.month || currentMonth().slice(0, 7));

    const [plan, user, permissions] = await Promise.all([buildPlan(userId, month), SalesPlanDA.getUser(userId), getPermissions(actingUserId)]);

    const isManager = sameId(user?.ManagerId, actingUserId);
    const reason = editableReason(month);

    return {
        month,
        user: { UserId: userId, Name: user?.Name, isSelf: sameId(userId, actingUserId) },
        ...plan,
        canEdit: isManager && permissions.has('salesplan.edit') && !reason,
        editableReason: isManager ? reason : null,
    };
};

// Direct reports with target and achievement totals for the month.
exports.getTeam = async (actingUserId, query) => {
    requireActingUser(actingUserId);

    const month = toMonthStart(query.month || currentMonth().slice(0, 7));
    const rows = await SalesPlanDA.getTeam(actingUserId, month, monthEnd(month));

    const team = rows.map((row) => {
        const target = money(row.TargetValue);
        const secondary = money(row.SecondaryValue);
        const pob = money(row.PobSuppliedValue);

        return {
            UserId: row.UserId,
            Name: row.Name,
            DesignationName: row.DesignationName,
            targetValue: target,
            targetProducts: row.TargetProducts,
            secondaryValue: secondary,
            pobValue: pob,
            secondaryPercent: percent(secondary, target),
            pobPercent: percent(pob, target),
        };
    });

    const sum = (field) => toRupees(team.reduce((total, member) => total + toPaise(member[field]), 0));
    const target = sum('targetValue');

    return {
        month,
        summary: {
            members: team.length,
            withTargets: team.filter((member) => member.targetValue > 0).length,
            targetValue: target,
            secondaryValue: sum('secondaryValue'),
            pobValue: sum('pobValue'),
            secondaryPercent: percent(sum('secondaryValue'), target),
        },
        team,
    };
};

// Options for the target form: priced products plus the previous month's targets to copy.
exports.getTargetForm = async (actingUserId, query) => {
    requireActingUser(actingUserId);

    if (!isGuid(query.userId)) throw fail(400, 'Team member is invalid.');

    const month = toMonthStart(query.month || currentMonth().slice(0, 7));
    const user = await SalesPlanDA.getUser(query.userId);

    if (!user || !sameId(user.ManagerId, actingUserId)) throw fail(403, 'You can only set targets for your direct reports.');

    const [products, current, previous] = await Promise.all([
        SalesPlanDA.getPricedProducts(),
        SalesPlanDA.getTargets(query.userId, month),
        SalesPlanDA.getTargets(query.userId, shiftMonth(month, -1)),
    ]);

    return {
        month,
        user: { UserId: user.UserId, Name: user.Name },
        products: products.map((product) => ({ ...product, UnitPrice: money(product.UnitPrice) })),
        current: current.map((item) => ({ ProductId: item.ProductId, TargetQty: item.TargetQty })),
        previous: previous.map((item) => ({ ProductId: item.ProductId, TargetQty: item.TargetQty })),
    };
};

// Replace one direct report's targets for a month. Products left at 0 have no target.
exports.saveTargets = async (actingUserId, payload) => {
    requireActingUser(actingUserId);

    if (!isGuid(payload.UserId)) throw fail(400, 'Team member is invalid.');

    const month = toMonthStart(payload.Month);
    const reason = editableReason(month);
    if (reason) throw fail(400, reason);

    const user = await SalesPlanDA.getUser(payload.UserId);
    if (!user || !sameId(user.ManagerId, actingUserId)) throw fail(403, 'You can only set targets for your direct reports.');

    const products = new Map((await SalesPlanDA.getPricedProducts()).map((product) => [lower(product.ProductId), product]));
    const seen = new Set();
    const now = new Date();

    const targets = (Array.isArray(payload.Lines) ? payload.Lines : [])
        .map((line, index) => {
            const product = isGuid(line?.ProductId) ? products.get(lower(line.ProductId)) : null;

            if (!product) throw fail(400, `Line ${index + 1}: choose an active product with a price.`);
            if (seen.has(lower(product.ProductId))) throw fail(400, `${product.ProductName} is listed twice.`);
            seen.add(lower(product.ProductId));

            const qty = line.TargetQty === '' || line.TargetQty == null ? 0 : Number(line.TargetQty);
            if (!Number.isInteger(qty) || qty < 0 || qty > MAX_QTY) {
                throw fail(400, `${product.ProductName}: target must be a whole number between 0 and ${MAX_QTY}.`);
            }

            return { product, qty };
        })
        .filter((line) => line.qty > 0)
        .map(({ product, qty }) => {
            const pricePaise = toPaise(product.UnitPrice);

            return {
                TargetId: generateUUID(),
                UserId: user.UserId,
                Month: month,
                ProductId: product.ProductId,
                TargetQty: qty,
                UnitPrice: toRupees(pricePaise),
                TargetValue: toRupees(pricePaise * qty),
                SetBy: actingUserId,
                Now: now,
            };
        });

    await SalesPlanDA.replaceTargets(user.UserId, month, targets);

    const total = toRupees(targets.reduce((sum, target) => sum + toPaise(target.TargetValue), 0));
    const label = new Date(`${month}T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

    return {
        message: targets.length
            ? `${user.Name}'s ${label} targets saved: ${targets.length} product(s), ₹${total.toLocaleString('en-IN')}.`
            : `${user.Name}'s ${label} targets cleared.`,
    };
};
