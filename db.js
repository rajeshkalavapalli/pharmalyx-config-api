require('dotenv').config();

const sql = require('mssql');

const dbConfig = {
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT),
    // A busy or low-memory SQL Server can take a while to answer: wait longer before giving up.
    connectionTimeout: 30000,
    requestTimeout: 60000,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    options: {
        // Azure SQL needs an encrypted connection (DB_ENCRYPT=true); a local SQL Server doesn't.
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_ENCRYPT !== 'true'
    }
};

const RETRY_MS = 5000;

// One shared pool. If connecting fails (SQL Server starting, slow or out of memory), the next request
// tries again instead of the API crashing or staying broken until it is restarted.
let current = null;

const connect = () => {
    if (!current) {
        const pool = new sql.ConnectionPool(dbConfig);
        pool.on('error', (error) => console.error('Database pool error:', error.message));
        current = pool.connect().catch((error) => {
            current = null; // the next caller starts a fresh attempt
            throw error;
        });
    }
    return current;
};

// Connect at start-up, retrying quietly until SQL Server answers.
const warmUp = () =>
    connect()
        .then(() => console.log('Connected to the database.'))
        .catch((error) => {
            console.error(`Database not reachable yet (${error.message}). Trying again in ${RETRY_MS / 1000} s.`);
            setTimeout(warmUp, RETRY_MS);
        });
warmUp();

module.exports = {
    sql,
    // Same name as before (`await db.poolPromise`): each read returns the live connection attempt.
    get poolPromise() {
        return connect();
    },
};
