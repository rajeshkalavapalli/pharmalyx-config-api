const db = require('../db');

const customQuery = async (sqlQuery, inputs = {}) => {
    try {
        const pool = await db.poolPromise;
        const request = pool.request();

        Object.entries(inputs).forEach(([name, value]) => {
            request.input(name, value);
        });

        const result = await request.query(sqlQuery);
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