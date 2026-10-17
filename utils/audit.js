const { customQuery } = require('./dbFunctions');

// Permanent record of who changed what, when and why (dbo.AuditLog).
// An audit failure is logged, never thrown, so it can't block the action itself.
// For writes that must succeed or fail together with the audit row, add
// `auditQuery(...)` to the same runInTransaction list instead.

const INSERT_AUDIT = `
    INSERT INTO dbo.AuditLog (EntityType, EntityId, Action, ActorId, Reason, BeforeData, AfterData, CreatedOn)
    VALUES (@EntityType, @EntityId, @Action, @ActorId, @Reason, @BeforeData, @AfterData, @Now)
`;

const json = (value) => (value == null ? null : JSON.stringify(value));

const auditInputs = ({ entityType, entityId, action, actorId, reason = null, before = null, after = null }) => ({
    EntityType: entityType,
    EntityId: String(entityId),
    Action: action,
    ActorId: actorId || null,
    Reason: reason ? String(reason).slice(0, 1000) : null,
    BeforeData: json(before),
    AfterData: json(after),
    Now: new Date(),
});

// For runInTransaction([...]): { sqlQuery, inputs }.
const auditQuery = (entry) => ({ sqlQuery: INSERT_AUDIT, inputs: auditInputs(entry) });

const writeAudit = async (entry) => {
    try {
        await customQuery(INSERT_AUDIT, auditInputs(entry));
    } catch (error) {
        console.error(`Audit not recorded (${entry.entityType} ${entry.action} ${entry.entityId}):`, error.message);
    }
};

module.exports = { writeAudit, auditQuery };
