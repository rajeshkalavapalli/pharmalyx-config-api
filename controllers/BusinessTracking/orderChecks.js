// Automatic POB checks. They only raise flags for head office (dbo.FraudFlags); nothing is blocked
// and the MR does nothing extra. Each flag has a SubjectKey, so running a check again never duplicates it.
//   On booking:  POB_INFLATED (qty > N x the chemist's average), POB_FIRST_LARGE, POB_DUPLICATE_SLIP
//   Background:  POB_NO_REORDER (large order, no reorder for N days), POB_MONTH_END_SPIKE

const rules = require('./rules');
const { loadSettings } = require('./settings');
const { customQuery } = require('../../utils/dbFunctions');
const { generateUUID } = require('../../utils/commonUtils');

const LIVE = `o.Status <> 'CANCELLED'`;

const SQL = {
    PREVIOUS_QTY: `
        SELECT l.Quantity FROM dbo.OrderLines l INNER JOIN dbo.Orders o ON o.OrderId = l.OrderId
        WHERE ${LIVE} AND o.PharmacyId = @PharmacyId AND l.ProductId = @ProductId AND o.OrderId <> @OrderId AND o.CreatedOn < @CreatedOn
    `,
    PREVIOUS_ORDERS: `SELECT COUNT(*) AS N FROM dbo.Orders o WHERE ${LIVE} AND o.PharmacyId = @PharmacyId AND o.OrderId <> @OrderId AND o.CreatedOn < @CreatedOn`,
    // Value of every other chemist's first order in the last year.
    FIRST_ORDER_VALUES: `
        SELECT f.NetAmount FROM (
            SELECT o.PharmacyId, o.NetAmount, o.OrderDate, ROW_NUMBER() OVER (PARTITION BY o.PharmacyId ORDER BY o.CreatedOn) AS N
            FROM dbo.Orders o WHERE ${LIVE} AND o.PharmacyId IS NOT NULL AND o.PharmacyId <> @PharmacyId
        ) f
        WHERE f.N = 1 AND f.OrderDate >= DATEADD(YEAR, -1, @Today)
    `,
    SAME_SHA: `SELECT TOP 5 OrderId, OrderNumber, UserId FROM dbo.Orders WHERE SlipSha256 = @Sha AND OrderId <> @OrderId`,
    RECENT_HASHES: `
        SELECT TOP 5000 OrderId, OrderNumber, UserId, SlipDHash FROM dbo.Orders
        WHERE SlipDHash IS NOT NULL AND OrderId <> @OrderId AND CreatedOn >= DATEADD(DAY, -180, @Now)
        ORDER BY CreatedOn DESC
    `,
    MEDIAN_SOURCE: `SELECT o.NetAmount FROM dbo.Orders o WHERE ${LIVE} AND o.OrderDate >= DATEADD(DAY, -180, @Today)`,
    // Chemist orders old enough to judge "no reorder", with whether anything came after.
    REORDER_CANDIDATES: `
        SELECT o.OrderId, o.OrderNumber, o.UserId, o.PharmacyId, ph.PharmacyName, CONVERT(VARCHAR(10), o.OrderDate, 23) AS OrderDate, o.NetAmount,
               (SELECT COUNT(*) FROM dbo.Orders n WHERE n.PharmacyId = o.PharmacyId AND n.Status <> 'CANCELLED' AND n.OrderDate > o.OrderDate) AS LaterOrders
        FROM dbo.Orders o
        INNER JOIN dbo.Pharmacy ph ON ph.PharmacyId = o.PharmacyId
        WHERE ${LIVE} AND o.PharmacyId IS NOT NULL
          AND o.OrderDate BETWEEN DATEADD(DAY, -365, @Today) AND DATEADD(DAY, -@Days, @Today)
    `,
    // Daily order value per chemist territory for one month, and who booked most in the last week.
    MONTH_DAILY: `
        SELECT ph.TerritoryId, t.TerritoryName, CONVERT(VARCHAR(10), o.OrderDate, 23) AS OrderDate, SUM(o.NetAmount) AS Value
        FROM dbo.Orders o
        INNER JOIN dbo.Pharmacy ph ON ph.PharmacyId = o.PharmacyId
        INNER JOIN Territory t ON t.TerritoryId = ph.TerritoryId
        WHERE ${LIVE} AND o.OrderDate BETWEEN @From AND @To
        GROUP BY ph.TerritoryId, t.TerritoryName, o.OrderDate
    `,
    TOP_BOOKER: `
        SELECT TOP 1 o.UserId FROM dbo.Orders o INNER JOIN dbo.Pharmacy ph ON ph.PharmacyId = o.PharmacyId
        WHERE ${LIVE} AND ph.TerritoryId = @TerritoryId AND o.OrderDate BETWEEN @From AND @To
        GROUP BY o.UserId ORDER BY SUM(o.NetAmount) DESC
    `,
    INSERT_FLAG: `
        IF NOT EXISTS (SELECT 1 FROM dbo.FraudFlags WHERE SubjectKey = @SubjectKey)
            INSERT INTO dbo.FraudFlags (FlagId, FlagType, Severity, UserId, DoctorId, VisitId, OrderId, Details, Data, Status, SubjectKey, CreatedOn)
            VALUES (@FlagId, @FlagType, @Severity, @UserId, NULL, NULL, @OrderId, @Details, @Data, 'OPEN', @SubjectKey, @Now)
    `,
};

const money = (value) => `Rs ${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;

const flag = (FlagType, Severity, UserId, OrderId, Details, SubjectKey, data = {}) => ({
    FlagId: generateUUID(),
    FlagType,
    Severity,
    UserId,
    OrderId,
    Details: Details.slice(0, 500),
    Data: JSON.stringify(data),
    SubjectKey,
    Now: new Date(),
});

const save = async (flags) => {
    for (const row of flags) await customQuery(SQL.INSERT_FLAG, row);
    return flags.length;
};

// =========================================================
// Right after a POB is booked
// =========================================================

/**
 * order: { OrderId, OrderNumber, UserId, PharmacyId, PharmacyName, NetAmount, CreatedOn, SlipSha256, SlipDHash }
 * lines: [{ ProductId, ProductName, Quantity }]
 */
exports.checkNewOrder = async (order, lines, deps = { query: customQuery, save }) => {
    const settings = await loadSettings();
    const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    const flags = [];
    const base = { OrderId: order.OrderId, CreatedOn: order.CreatedOn, PharmacyId: order.PharmacyId };

    if (order.PharmacyId) {
        // Inflated quantity per product.
        for (const line of lines) {
            const previous = (await deps.query(SQL.PREVIOUS_QTY, { ...base, ProductId: line.ProductId })).map((row) => Number(row.Quantity));
            const inflated = rules.inflatedQuantity(Number(line.Quantity), previous, settings.ORDER_QTY_MULTIPLIER);
            if (inflated) {
                flags.push(
                    flag(
                        'POB_INFLATED',
                        inflated.times >= settings.ORDER_QTY_MULTIPLIER * 2 ? 'HIGH' : 'MEDIUM',
                        order.UserId,
                        order.OrderId,
                        `${order.OrderNumber}: ${line.Quantity} of ${line.ProductName} for ${order.PharmacyName}, ${inflated.times}x this chemist's usual ${inflated.average}.`,
                        `INFLATED|${order.OrderId}|${line.ProductId}`,
                        { productId: line.ProductId, quantity: line.Quantity, ...inflated }
                    )
                );
            }
        }

        // A new chemist's first order compared with typical first orders.
        const previousOrders = Number((await deps.query(SQL.PREVIOUS_ORDERS, base))[0]?.N || 0);
        if (previousOrders === 0) {
            const firsts = (await deps.query(SQL.FIRST_ORDER_VALUES, { ...base, Today: today })).map((row) => Number(row.NetAmount));
            const large = rules.largeFirstOrder(Number(order.NetAmount), firsts, settings.FIRST_ORDER_MULTIPLIER);
            if (large) {
                flags.push(
                    flag('POB_FIRST_LARGE', 'MEDIUM', order.UserId, order.OrderId, `${order.OrderNumber}: first order from ${order.PharmacyName} is ${money(order.NetAmount)}, ${large.times}x a typical first order (${money(large.typical)}).`, `FIRST|${order.OrderId}`, large)
                );
            }
        }
    }

    // Same slip photo: exact copy, or a near-identical photo of the same slip.
    if (order.SlipSha256) {
        const same = await deps.query(SQL.SAME_SHA, { Sha: order.SlipSha256, OrderId: order.OrderId });
        const near = order.SlipDHash
            ? (await deps.query(SQL.RECENT_HASHES, { OrderId: order.OrderId, Now: new Date() })).filter((row) => rules.hashDistance(row.SlipDHash, order.SlipDHash) <= settings.SLIP_HASH_DISTANCE)
            : [];
        const matches = [...new Map([...same, ...near].map((row) => [String(row.OrderId).toLowerCase(), row])).values()];
        if (matches.length) {
            flags.push(
                flag(
                    'POB_DUPLICATE_SLIP',
                    'HIGH',
                    order.UserId,
                    order.OrderId,
                    `${order.OrderNumber}: the order slip photo matches ${matches.map((m) => m.OrderNumber).join(', ')}.`,
                    `SLIP|${order.OrderId}`,
                    { matches: matches.map((m) => m.OrderId) }
                )
            );
        }
    }

    return deps.save(flags);
};

// =========================================================
// Background sweep (no reorder, month-end spike)
// =========================================================

exports.sweep = async (now = new Date(), deps = { query: customQuery, save }) => {
    const settings = await loadSettings();
    const today = new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
    const flags = [];

    // Large order, then nothing from that chemist for N days.
    const typical = rules.median((await deps.query(SQL.MEDIAN_SOURCE, { Today: today })).map((row) => Number(row.NetAmount)));
    if (typical) {
        const candidates = await deps.query(SQL.REORDER_CANDIDATES, { Today: today, Days: settings.NO_REORDER_DAYS });
        candidates
            .filter((row) => Number(row.LaterOrders) === 0 && rules.isLargeOrder(Number(row.NetAmount), typical, settings.LARGE_ORDER_MULTIPLIER))
            .forEach((row) =>
                flags.push(
                    flag(
                        'POB_NO_REORDER',
                        'MEDIUM',
                        row.UserId,
                        row.OrderId,
                        `${row.OrderNumber}: large order of ${money(row.NetAmount)} from ${row.PharmacyName} on ${row.OrderDate}, and no reorder for ${rules.daysBetween(row.OrderDate, today)} days.`,
                        `NOREORDER|${row.OrderId}`,
                        { typical, value: Number(row.NetAmount) }
                    )
                )
            );
    }

    // Last 7 days of last month vs the rest of it, per chemist territory.
    const month = rules.addMonths(rules.monthOf(today), -1);
    const end = rules.monthEnd(month);
    const daily = await deps.query(SQL.MONTH_DAILY, { From: month, To: end });
    const byTerritory = new Map();
    daily.forEach((row) => {
        const key = String(row.TerritoryId).toLowerCase();
        if (!byTerritory.has(key)) byTerritory.set(key, { id: row.TerritoryId, name: row.TerritoryName, days: [] });
        byTerritory.get(key).days.push({ date: row.OrderDate, value: Number(row.Value) });
    });
    for (const territory of byTerritory.values()) {
        const spike = rules.monthEndSpike(territory.days, month, settings.MONTH_END_SPIKE_MULTIPLIER);
        if (!spike) continue;
        const lastWeek = new Date(`${end}T00:00:00Z`);
        lastWeek.setUTCDate(lastWeek.getUTCDate() - 6);
        const booker = (await deps.query(SQL.TOP_BOOKER, { TerritoryId: territory.id, From: lastWeek.toISOString().slice(0, 10), To: end }))[0];
        if (!booker) continue;
        flags.push(
            flag(
                'POB_MONTH_END_SPIKE',
                'MEDIUM',
                booker.UserId,
                null,
                `${territory.name}: orders in the last 7 days of ${month.slice(0, 7)} averaged ${money(spike.lateAvg)}/day vs ${money(spike.earlyAvg)}/day earlier${spike.times ? ` (${spike.times}x)` : ''}.`,
                `SPIKE|${territory.id}|${month}`,
                spike
            )
        );
    }

    return deps.save(flags);
};

// Runs the sweep now and then every few hours while the API is up.
exports.startScheduler = (hours = 6) => {
    const tick = () => exports.sweep().catch((error) => console.error('Order checks sweep failed:', error.message));
    setTimeout(tick, 60 * 1000);
    return setInterval(tick, hours * 3600 * 1000);
};

exports._sql = SQL;
