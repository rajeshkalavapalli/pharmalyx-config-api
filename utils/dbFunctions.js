const db = require('../db');
const { CONTEXT_SQL, contextInputs } = require('./orgContext');

// Every query first names the request's company for the database's Row-Level Security
// (see utils/orgContext.js). The extra statements return nothing, so results are unchanged.
const addInputs = (request, inputs) => {
    Object.entries({ ...inputs, ...contextInputs() }).forEach(([name, value]) => {
        request.input(name, value);
    });
};

const customQuery = async (sqlQuery, inputs = {}) => {
    try {
        const pool = await db.poolPromise;
        const request = pool.request();

        addInputs(request, inputs);

        const result = await request.query(CONTEXT_SQL + sqlQuery);
        return result.recordset ?? result.rowsAffected ?? result;
    } catch (error) {
        console.error('Error executing query:', error);
        throw error;
    }
};

const runInTransaction = async (queries = []) => {
    if (!Array.isArray(queries) || queries.length === 0) {
        return [];
    }

    const pool = await db.poolPromise;
    const transaction = pool.transaction();

    await transaction.begin();

    try {
        // One connection for the whole transaction: name the company once.
        const context = new db.sql.Request(transaction);
        addInputs(context, {});
        await context.query(CONTEXT_SQL);

        const results = [];

        for (const { sqlQuery, inputs = {} } of queries) {
            const request = new db.sql.Request(transaction);

            Object.entries(inputs).forEach(([name, value]) => {
                request.input(name, value);
            });

            const result = await request.query(sqlQuery);
            results.push(result);
        }

        await transaction.commit();
        return results;
    } catch (error) {
        await transaction.rollback();
        console.error('Error executing transaction:', error);
        throw error;
    }
};

module.exports = {
    customQuery,
    runInTransaction,
};
