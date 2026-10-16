const sql = require('./sql');
const { customQuery, runInTransaction } = require('../../utils/dbFunctions');

const found = async (promise) => (await promise).length > 0;

exports.getEntries = (UserId, FromDate, ToDate) => customQuery(sql.GET_ENTRIES(), { UserId, FromDate, ToDate });

exports.getLines = (UserId, FromDate, ToDate) => customQuery(sql.GET_LINES(), { UserId, FromDate, ToDate });

exports.getPharmacies = (UserId) => customQuery(sql.GET_PHARMACIES(), { UserId });

exports.isPharmacyMapped = (UserId, PharmacyId) =>
    found(customQuery(sql.IS_PHARMACY_MAPPED(), { UserId, PharmacyId }));

exports.isDoctorMapped = (UserId, DoctorId) => found(customQuery(sql.IS_DOCTOR_MAPPED(), { UserId, DoctorId }));

exports.getActiveProductIds = async () =>
    new Set((await customQuery(sql.GET_ACTIVE_PRODUCT_IDS())).map((row) => String(row.ProductId).toLowerCase()));

// Header and lines are saved together or not at all.
exports.createEntry = (entry, lines) =>
    runInTransaction([
        { sqlQuery: sql.CREATE_ENTRY(), inputs: entry },
        ...lines.map((line) => ({ sqlQuery: sql.CREATE_LINE(), inputs: line })),
    ]);
