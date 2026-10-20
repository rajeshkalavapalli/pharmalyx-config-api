// Background checks for the field ledger. Flags go to head office (dbo.FraudFlags) for review;
// nothing is blocked or punished automatically. Each flag has a SubjectKey, so it is raised only once.
//   STOCK_HELD_LONG: an MR has held issued stock for more than MR_STOCK_HOLD_DAYS
// It also hands over the chemists, doctors and stock of MRs whose leaving date has come.

const sql = require('./sql');
const rules = require('./rules');
const { loadSettings } = require('./settings');
const HeadOffice = require('./HeadOfficeService');

const { customQuery } = require('../../utils/dbFunctions');
const { forEachOrganisation } = require('../../utils/orgContext');
const { generateUUID } = require('../../utils/commonUtils');

const INSERT_FLAG = `
    IF NOT EXISTS (SELECT 1 FROM dbo.FraudFlags WHERE SubjectKey = @SubjectKey)
        INSERT INTO dbo.FraudFlags (FlagId, FlagType, Severity, UserId, DoctorId, VisitId, OrderId, Details, Data, Status, SubjectKey, CreatedOn)
        VALUES (@FlagId, @FlagType, @Severity, @UserId, NULL, NULL, NULL, @Details, @Data, 'OPEN', @SubjectKey, @Now)
`;

const todayIst = (now = new Date()) => new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
const lower = (value) => String(value || '').toLowerCase();

// Stock held too long, per MR and batch (one flag per lot).
const heldFlags = (lotRows, today, days) => {
    const groups = new Map();
    lotRows.forEach((row) => {
        const key = `${lower(row.UserId)}|${lower(row.BatchId)}`;
        if (!groups.has(key)) groups.set(key, { row, list: [] });
        groups.get(key).list.push(row);
    });
    const flags = [];
    groups.forEach(({ row, list }) => {
        rules.heldTooLong(rules.openLots(list), today, days).forEach((lot) => {
            flags.push({
                FlagId: generateUUID(),
                FlagType: 'STOCK_HELD_LONG',
                Severity: lot.ageDays > days * 2 ? 'HIGH' : 'MEDIUM',
                UserId: row.UserId,
                Details: `${row.UserName} has held ${lot.quantity} of ${row.ProductName} (batch ${row.BatchNumber}) since ${lot.date}: ${lot.ageDays} days (limit ${days}).`.slice(0, 500),
                Data: JSON.stringify({ batchId: row.BatchId, ...lot }),
                SubjectKey: `HELD|${lower(row.UserId)}|${lower(row.BatchId)}|${lot.date}`,
                Now: new Date(),
            });
        });
    });
    return flags;
};

exports.sweep = async (now = new Date(), deps = { query: customQuery, handover: HeadOffice.handover }) => {
    const settings = await loadSettings();
    const today = todayIst(now);
    let raised = 0;

    try {
        const flags = heldFlags(await deps.query(sql.LOT_ENTRIES(), { UserId: null }), today, settings.MR_STOCK_HOLD_DAYS);
        for (const flag of flags) await deps.query(INSERT_FLAG, flag);
        raised = flags.length;

        for (const row of await deps.query(sql.HANDOVER_DUE(), { Today: today })) {
            try {
                await deps.handover(row.ClearanceId, null);
            } catch (error) {
                console.error('Automatic handover failed for clearance', row.ClearanceId, error.message);
            }
        }
    } catch (error) {
        if (error.number === 208) return 0; // ledger tables not installed yet
        throw error;
    }
    return raised;
};

exports.startScheduler = (hours = 6) => {
    // Once per company: each sweep sees only that company's stock and clearances.
    const tick = () => forEachOrganisation(customQuery, () => exports.sweep(), 'Field ledger checks').catch((error) => console.error('Field ledger checks failed:', error.message));
    setTimeout(tick, 90 * 1000);
    return setInterval(tick, hours * 3600 * 1000);
};

exports._test = { heldFlags };
