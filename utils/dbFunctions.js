const db = require('../db')

const customQuery = async (sqlQuery, inputs = []) => {
    try {
        const pool = await db.poolPromise;

        const request = pool.request();

        Object.entries(inputs).forEach(([name, value]) => {
            request.input(name, value);
        });


        const result = await request.query(sqlQuery);

        return result.recordset;
    } catch (error) {
        console.error('Error executing query:', error);
        throw error;
    }
};

module.exports = {
    customQuery
};