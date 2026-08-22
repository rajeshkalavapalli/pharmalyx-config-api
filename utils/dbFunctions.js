const db = require('../db')

const customQuery = async (sqlQuery) => {
    try {
        const pool = await db.poolPromise;

        const result = await pool.request().query(sqlQuery);

        return result.recordset;
    } catch (error) {
        console.error('Error executing query:', error);
        throw error;
    }
};

module.exports = {
    customQuery
};