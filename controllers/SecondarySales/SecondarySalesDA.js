const sql = require('./sql');
const { customQuery, runInTransaction } = require('../../utils/dbFunctions');

const first = async (promise) => (await promise)[0] || null;

exports.getMyStockists = (UserId, StockistId = null) => customQuery(sql.GET_MY_STOCKISTS(), { UserId, StockistId });

exports.getMonthStatements = (UserId, Month) => customQuery(sql.GET_MONTH_STATEMENTS(), { UserId, Month, StockistId: null });

exports.getStatementByKey = (StockistId, Month) => first(customQuery(sql.GET_STATEMENT_BY_KEY(), { StockistId, Month }));

exports.getStatementById = (StatementId) => first(customQuery(sql.GET_STATEMENT_BY_ID(), { StatementId }));

exports.getLines = (StatementId) => customQuery(sql.GET_LINES(), { StatementId });

exports.getPricedProducts = () => customQuery(sql.GET_PRICED_PRODUCTS());

// Header and lines are replaced together or not at all.
exports.saveStatement = (header, lines, isNew) =>
    runInTransaction([
        { sqlQuery: isNew ? sql.INSERT_STATEMENT() : sql.UPDATE_STATEMENT(), inputs: header },
        { sqlQuery: sql.DELETE_LINES(), inputs: { StatementId: header.StatementId } },
        ...lines.map((line) => ({ sqlQuery: sql.INSERT_LINE(), inputs: line })),
    ]);

// Returns the number of rows changed (0 when it was no longer submitted).
exports.reviewStatement = async (inputs) => {
    const result = await customQuery(sql.REVIEW_STATEMENT(), inputs);
    return Array.isArray(result) ? result[0] || 0 : 0;
};

exports.getReviews = (UserId) => customQuery(sql.GET_REVIEWS(), { UserId });

exports.hasTeam = async (UserId) => (await customQuery(sql.HAS_TEAM(), { UserId })).length > 0;

exports.getStock = (UserId) => customQuery(sql.GET_STOCK(), { UserId, StockistId: null });

exports.getStockLines = (UserId) => customQuery(sql.GET_STOCK_LINES(), { UserId, StockistId: null });
