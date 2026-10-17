const SecondarySalesDA = require('./SecondarySalesDA');

const { generateUUID } = require('../../utils/commonUtils');
const { fail, isGuid, optionalText, requireActingUser, sameId, todayKey, toMonthStart } = require('../../utils/access');

// Statements can be prepared for the current month and the two before it.
const EDITABLE_MONTHS_BACK = 2;
const MAX_QUANTITY = 1000000;
const FINAL = ['SUBMITTED', 'APPROVED'];

// Stock cover (days of sales the closing stock lasts) thresholds.
const LOW_COVER_DAYS = 15;
const HIGH_COVER_DAYS = 60;

const lower = (value) => String(value).toLowerCase();
const money = (value) => Number(value || 0);
const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);
const toRupees = (paise) => paise / 100;

const currentMonth = () => `${todayKey().slice(0, 7)}-01`;

const shiftMonth = (monthStart, delta) => {
    const date = new Date(`${monthStart}T00:00:00`);
    return todayKey(new Date(date.getFullYear(), date.getMonth() + delta, 1));
};

const daysInMonth = (monthStart) => {
    const date = new Date(`${monthStart}T00:00:00`);
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
};

const monthLabel = (monthStart) =>
    new Date(`${monthStart}T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

const editableWindow = (month) => {
    const now = currentMonth();

    if (month > now) return 'Statements for future months cannot be entered.';
    if (month < shiftMonth(now, -EDITABLE_MONTHS_BACK)) {
        return `Statements older than ${EDITABLE_MONTHS_BACK} months can no longer be changed.`;
    }

    return null;
};

const toQty = (value, label) => {
    const qty = value === '' || value == null ? 0 : Number(value);

    if (!Number.isInteger(qty) || qty < 0 || qty > MAX_QUANTITY) {
        throw fail(400, `${label} must be a whole number between 0 and ${MAX_QUANTITY}.`);
    }

    return qty;
};

const normalizeStatement = (row) =>
    row && {
        StatementId: row.StatementId,
        StockistId: row.StockistId,
        StockistName: row.StockistName,
        StatementMonth: row.StatementMonth,
        UserId: row.UserId,
        UserName: row.UserName,
        Status: row.Status,
        TotalSalesQty: row.TotalSalesQty,
        SalesValue: money(row.SalesValue),
        ClosingValue: money(row.ClosingValue),
        Remarks: row.Remarks,
        ReviewRemarks: row.ReviewRemarks,
        SubmittedOn: row.SubmittedOn,
        ReviewedOn: row.ReviewedOn,
    };

const requireMappedStockist = async (actingUserId, stockistId) => {
    if (!isGuid(stockistId)) throw fail(400, 'Stockist is invalid.');

    const [stockist] = await SecondarySalesDA.getMyStockists(actingUserId, stockistId);

    if (!stockist) throw fail(403, 'This stockist is not assigned to you.');

    return stockist;
};

// Opening stock comes from last month's closing once last month is submitted.
const loadPrevious = async (stockistId, month) => {
    const previous = await SecondarySalesDA.getStatementByKey(stockistId, shiftMonth(month, -1));
    const lines = previous ? await SecondarySalesDA.getLines(previous.StatementId) : [];

    return {
        previous,
        locked: Boolean(previous && FINAL.includes(previous.Status)),
        byProduct: new Map(lines.map((line) => [lower(line.ProductId), line])),
    };
};

// =========================================================
// OVERVIEW: this month's statement status per assigned stockist
// =========================================================

exports.getOverview = async (actingUserId, query) => {
    requireActingUser(actingUserId);

    const month = toMonthStart(query.month || currentMonth().slice(0, 7));

    const [stockists, statements, hasTeam] = await Promise.all([
        SecondarySalesDA.getMyStockists(actingUserId),
        SecondarySalesDA.getMonthStatements(actingUserId, month),
        SecondarySalesDA.hasTeam(actingUserId),
    ]);

    const byStockist = new Map(statements.map((row) => [lower(row.StockistId), normalizeStatement(row)]));

    const rows = stockists.map((stockist) => {
        const statement = byStockist.get(lower(stockist.StockistId)) || null;

        return {
            ...stockist,
            statement,
            status: statement ? statement.Status : 'NOT_STARTED',
            isOwner: statement ? sameId(statement.UserId, actingUserId) : true,
        };
    });

    const done = rows.filter((row) => FINAL.includes(row.status));

    return {
        month,
        editableReason: editableWindow(month),
        hasTeam,
        summary: {
            stockists: rows.length,
            submitted: done.length,
            approved: rows.filter((row) => row.status === 'APPROVED').length,
            pending: rows.length - done.length,
            salesQty: done.reduce((total, row) => total + row.statement.TotalSalesQty, 0),
            salesValue: toRupees(done.reduce((total, row) => total + toPaise(row.statement.SalesValue), 0)),
            closingValue: toRupees(done.reduce((total, row) => total + toPaise(row.statement.ClosingValue), 0)),
        },
        stockists: rows,
    };
};

// =========================================================
// ONE STATEMENT (existing, or a blank sheet with openings carried forward)
// =========================================================

exports.getStatement = async (actingUserId, query) => {
    requireActingUser(actingUserId);

    const month = toMonthStart(query.month || currentMonth().slice(0, 7));
    const stockist = await requireMappedStockist(actingUserId, query.stockistId);

    const [statementRow, prior, products] = await Promise.all([
        SecondarySalesDA.getStatementByKey(stockist.StockistId, month),
        loadPrevious(stockist.StockistId, month),
        SecondarySalesDA.getPricedProducts(),
    ]);

    const statement = normalizeStatement(statementRow);
    const lines = statement ? await SecondarySalesDA.getLines(statement.StatementId) : [];
    const lineByProduct = new Map(lines.map((line) => [lower(line.ProductId), line]));

    // Every orderable product, plus anything already on this or last month's sheet.
    const catalogue = new Map(products.map((product) => [lower(product.ProductId), product]));
    [...lines, ...prior.byProduct.values()].forEach((line) => {
        if (!catalogue.has(lower(line.ProductId))) {
            catalogue.set(lower(line.ProductId), { ProductId: line.ProductId, ProductName: line.ProductName, PackSize: line.PackSize, UnitPrice: line.UnitPrice });
        }
    });

    const rows = [...catalogue.values()]
        .map((product) => {
            const key = lower(product.ProductId);
            const line = lineByProduct.get(key);
            const previous = prior.byProduct.get(key);
            const opening = prior.locked ? previous?.ClosingQty || 0 : line?.OpeningQty || 0;

            return {
                ProductId: product.ProductId,
                ProductName: product.ProductName,
                PackSize: product.PackSize,
                UnitPrice: money(line?.UnitPrice ?? product.UnitPrice),
                OpeningQty: opening,
                ReceiptQty: line?.ReceiptQty || 0,
                SalesQty: line?.SalesQty || 0,
                ReturnQty: line?.ReturnQty || 0,
                ClosingQty: line ? line.ClosingQty : opening,
                PreviousSalesQty: previous?.SalesQty ?? null,
            };
        })
        .sort((a, b) => a.ProductName.localeCompare(b.ProductName));

    const isOwner = statement ? sameId(statement.UserId, actingUserId) : true;
    let blockedReason = editableWindow(month);

    if (!blockedReason && statement && !isOwner) blockedReason = `${statement.UserName} prepares this statement.`;
    if (!blockedReason && statement && FINAL.includes(statement.Status)) {
        blockedReason = statement.Status === 'APPROVED' ? 'This statement is approved.' : 'This statement is waiting for review.';
    }

    return {
        month,
        stockist,
        statement,
        rows,
        openingLocked: prior.locked,
        previous: prior.previous ? { StatementMonth: prior.previous.StatementMonth, Status: prior.previous.Status } : null,
        canEdit: !blockedReason,
        blockedReason,
    };
};

// =========================================================
// SAVE DRAFT / SUBMIT
// =========================================================

exports.saveStatement = async (actingUserId, payload) => {
    requireActingUser(actingUserId);

    const month = toMonthStart(payload.Month);
    const windowReason = editableWindow(month);
    if (windowReason) throw fail(400, windowReason);

    const stockist = await requireMappedStockist(actingUserId, payload.StockistId);
    const submit = payload.Submit === true;

    const [existing, prior, products] = await Promise.all([
        SecondarySalesDA.getStatementByKey(stockist.StockistId, month),
        loadPrevious(stockist.StockistId, month),
        SecondarySalesDA.getPricedProducts(),
    ]);

    if (existing && !sameId(existing.UserId, actingUserId)) throw fail(403, `${existing.UserName} prepares this statement.`);
    if (existing && FINAL.includes(existing.Status)) throw fail(409, 'This statement has already been submitted.');

    if (submit && prior.previous && !prior.locked) {
        throw fail(409, `Submit the ${monthLabel(prior.previous.StatementMonth)} statement first; its closing stock is this month's opening.`);
    }

    // Products that may appear: orderable ones, plus last month's stock being carried forward.
    const allowed = new Map(products.map((product) => [lower(product.ProductId), { ...product, UnitPrice: money(product.UnitPrice) }]));
    prior.byProduct.forEach((line, key) => {
        if (!allowed.has(key)) allowed.set(key, { ProductId: line.ProductId, ProductName: line.ProductName, UnitPrice: money(line.UnitPrice) });
    });

    const entered = new Map();
    (Array.isArray(payload.Lines) ? payload.Lines : []).forEach((line, index) => {
        const product = isGuid(line?.ProductId) ? allowed.get(lower(line.ProductId)) : null;

        if (!product) throw fail(400, `Line ${index + 1}: choose an active product.`);
        if (entered.has(lower(product.ProductId))) throw fail(400, `${product.ProductName} is listed twice.`);

        entered.set(lower(product.ProductId), { product, line });
    });

    // Carried stock stays on the sheet even if the MR didn't touch it.
    if (prior.locked) {
        prior.byProduct.forEach((line, key) => {
            if (line.ClosingQty > 0 && !entered.has(key)) entered.set(key, { product: allowed.get(key), line: {} });
        });
    }

    const statementId = existing ? existing.StatementId : generateUUID();
    const totals = { sales: 0, salesPaise: 0, closingPaise: 0 };

    const lines = [...entered.entries()]
        .map(([key, { product, line }]) => {
            const name = product.ProductName;
            const opening = prior.locked ? prior.byProduct.get(key)?.ClosingQty || 0 : toQty(line.OpeningQty, `${name} opening`);
            const receipt = toQty(line.ReceiptQty, `${name} receipts`);
            const sales = toQty(line.SalesQty, `${name} sales`);
            const returns = toQty(line.ReturnQty, `${name} returns`);
            const closing = opening + receipt + returns - sales;

            if (closing < 0) {
                throw fail(400, `${name}: sales (${sales}) are more than the stock available (${opening + receipt + returns}).`);
            }

            return { key, product, opening, receipt, sales, returns, closing };
        })
        .filter((line) => line.opening || line.receipt || line.sales || line.returns)
        .map(({ product, opening, receipt, sales, returns, closing }) => {
            const pricePaise = toPaise(product.UnitPrice);

            totals.sales += sales;
            totals.salesPaise += pricePaise * sales;
            totals.closingPaise += pricePaise * closing;

            return {
                LineId: generateUUID(),
                StatementId: statementId,
                ProductId: product.ProductId,
                OpeningQty: opening,
                ReceiptQty: receipt,
                SalesQty: sales,
                ReturnQty: returns,
                ClosingQty: closing,
                UnitPrice: toRupees(pricePaise),
                SalesValue: toRupees(pricePaise * sales),
                ClosingValue: toRupees(pricePaise * closing),
            };
        });

    if (submit && lines.length === 0) throw fail(400, 'Enter stock for at least one product before submitting.');

    const now = new Date();

    try {
        await SecondarySalesDA.saveStatement(
            {
                StatementId: statementId,
                StockistId: stockist.StockistId,
                Month: month,
                UserId: actingUserId,
                Status: submit ? 'SUBMITTED' : 'DRAFT',
                TotalSalesQty: totals.sales,
                SalesValue: toRupees(totals.salesPaise),
                ClosingValue: toRupees(totals.closingPaise),
                Remarks: optionalText(payload.Remarks, 500, 'Remarks'),
                SubmittedOn: submit ? now : null,
                Now: now,
            },
            lines,
            !existing
        );
    } catch (error) {
        if (String(error.message).includes('STATEMENT_LOCKED')) throw fail(409, 'This statement was submitted meanwhile. Refresh to see it.');
        if (error.number === 2627 || error.number === 2601) throw fail(409, 'A statement for this stockist and month was just started by someone else. Refresh.');
        throw error;
    }

    return {
        message: submit
            ? `${stockist.StockistName} · ${monthLabel(month)} submitted for review.`
            : `${stockist.StockistName} · ${monthLabel(month)} saved as draft.`,
        StatementId: statementId,
    };
};

// =========================================================
// MANAGER REVIEW
// =========================================================

exports.getReviews = async (actingUserId) => {
    requireActingUser(actingUserId);

    const rows = await SecondarySalesDA.getReviews(actingUserId);

    return { reviews: rows.map(normalizeStatement) };
};

// Full statement for the reviewing manager (or the MR who owns it).
exports.getStatementById = async (actingUserId, statementId) => {
    requireActingUser(actingUserId);

    if (!isGuid(statementId)) throw fail(400, 'Statement is invalid.');

    const row = await SecondarySalesDA.getStatementById(statementId);
    if (!row) throw fail(404, 'Statement not found.');

    if (!sameId(row.UserId, actingUserId) && !sameId(row.ManagerId, actingUserId)) {
        throw fail(403, 'Only the MR or their manager can open this statement.');
    }

    const lines = await SecondarySalesDA.getLines(statementId);

    return {
        statement: normalizeStatement(row),
        lines: lines.map((line) => ({ ...line, UnitPrice: money(line.UnitPrice), SalesValue: money(line.SalesValue), ClosingValue: money(line.ClosingValue) })),
        canReview: sameId(row.ManagerId, actingUserId) && row.Status === 'SUBMITTED',
    };
};

exports.reviewStatement = async (actingUserId, statementId, outcome, remarks) => {
    requireActingUser(actingUserId);

    if (!isGuid(statementId)) throw fail(400, 'Statement is invalid.');

    const statement = await SecondarySalesDA.getStatementById(statementId);
    if (!statement) throw fail(404, 'Statement not found.');

    if (!sameId(statement.ManagerId, actingUserId)) throw fail(403, 'Only the reporting manager can review this statement.');
    if (statement.Status !== 'SUBMITTED') throw fail(409, 'Only a submitted statement can be reviewed.');

    const reviewRemarks = optionalText(remarks, 500, 'Remarks');

    if (outcome === 'RETURNED') {
        if (!reviewRemarks) throw fail(400, 'Say what needs to be corrected.');

        // Next month's opening is this month's closing; don't reopen it underneath a submitted month.
        const next = await SecondarySalesDA.getStatementByKey(statement.StockistId, shiftMonth(statement.StatementMonth, 1));
        if (next && FINAL.includes(next.Status)) {
            throw fail(409, `${monthLabel(next.StatementMonth)} is already submitted, so this month can't be returned.`);
        }
    }

    const changed = await SecondarySalesDA.reviewStatement({
        StatementId: statement.StatementId,
        Status: outcome,
        ReviewRemarks: reviewRemarks,
        ReviewedBy: actingUserId,
        Now: new Date(),
    });

    if (!changed) throw fail(409, 'This statement was updated meanwhile. Refresh and try again.');

    const label = `${statement.StockistName} · ${monthLabel(statement.StatementMonth)}`;
    return { message: outcome === 'APPROVED' ? `${label} approved.` : `${label} returned to ${statement.UserName}.` };
};

// =========================================================
// STOCK: latest closing stock and cover at each assigned stockist
// =========================================================

const coverStatus = (line, days) => {
    if (line.ClosingQty === 0) return line.SalesQty > 0 || line.OpeningQty > 0 ? 'OUT' : 'NONE';
    if (line.SalesQty === 0) return 'NO_MOVEMENT';

    const cover = (line.ClosingQty / line.SalesQty) * days;

    if (cover < LOW_COVER_DAYS) return 'LOW';
    if (cover > HIGH_COVER_DAYS) return 'HIGH';
    return 'HEALTHY';
};

exports.getStock = async (actingUserId) => {
    requireActingUser(actingUserId);

    const [stockists, lines] = await Promise.all([SecondarySalesDA.getStock(actingUserId), SecondarySalesDA.getStockLines(actingUserId)]);

    const linesByStatement = new Map();
    lines.forEach((line) => {
        const key = lower(line.StatementId);
        linesByStatement.set(key, [...(linesByStatement.get(key) || []), line]);
    });

    const rows = stockists.map((stockist) => {
        const days = stockist.StatementMonth ? daysInMonth(stockist.StatementMonth) : 30;
        const items = (stockist.StatementId ? linesByStatement.get(lower(stockist.StatementId)) || [] : [])
            .map((line) => ({
                ...line,
                ClosingValue: money(line.ClosingValue),
                coverDays: line.SalesQty > 0 ? Math.round((line.ClosingQty / line.SalesQty) * days) : null,
                stockStatus: coverStatus(line, days),
            }))
            .filter((line) => line.stockStatus !== 'NONE');

        return {
            StockistId: stockist.StockistId,
            StockistName: stockist.StockistName,
            AreaName: stockist.AreaName,
            StatementMonth: stockist.StatementMonth,
            Status: stockist.Status,
            ClosingValue: money(stockist.ClosingValue),
            SalesValue: money(stockist.SalesValue),
            counts: {
                out: items.filter((item) => item.stockStatus === 'OUT').length,
                low: items.filter((item) => item.stockStatus === 'LOW').length,
                high: items.filter((item) => item.stockStatus === 'HIGH' || item.stockStatus === 'NO_MOVEMENT').length,
            },
            items,
        };
    });

    const reporting = rows.filter((row) => row.StatementMonth);

    return {
        thresholds: { low: LOW_COVER_DAYS, high: HIGH_COVER_DAYS },
        summary: {
            stockists: rows.length,
            reporting: reporting.length,
            closingValue: toRupees(rows.reduce((total, row) => total + toPaise(row.ClosingValue), 0)),
            outOfStock: rows.reduce((total, row) => total + row.counts.out, 0),
            lowStock: rows.reduce((total, row) => total + row.counts.low, 0),
            overStock: rows.reduce((total, row) => total + row.counts.high, 0),
        },
        stockists: rows,
    };
};
