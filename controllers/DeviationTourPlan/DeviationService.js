const DeviationDA = require('./DeviationDA');

const { generateUUID } = require('../../utils/commonUtils');

const DEVIATION_TYPES = ['Territory Change', 'Area Change'];
const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];
const SOURCE = 'MR Requested';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

const sameId = (a, b) =>
    a != null && b != null && String(a).toLowerCase() === String(b).toLowerCase();

const requireActingUser = (actingUserId) => {
    if (!actingUserId || !GUID.test(actingUserId)) {
        throw fail(401, 'Acting user is required.');
    }
};

const optionalGuid = (value, label) => {
    if (value == null || value === '') {
        return null;
    }

    if (!GUID.test(String(value))) {
        throw fail(400, `${label} is invalid.`);
    }

    return String(value);
};

const toIsoDate = (value) => {
    const text = String(value ?? '').slice(0, 10);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    const date = match ? new Date(Date.UTC(+match[1], +match[2] - 1, +match[3])) : null;

    if (!date || date.toISOString().slice(0, 10) !== text) {
        throw fail(400, 'DeviationDate must be in YYYY-MM-DD format.');
    }

    return text;
};

const toMonthStart = (value) => {
    if (!value) {
        return null;
    }

    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(value));

    if (!match) {
        throw fail(400, 'Month must be in YYYY-MM format.');
    }

    return `${match[1]}-${match[2]}-01`;
};

const mapDbError = (err) => (err.number === 50011 ? fail(409, err.message) : err);

const withPermissions = (row, actingUserId) => {
    const isOwner = sameId(row.UserId, actingUserId);
    const isManager = sameId(row.ManagerId, actingUserId);

    return {
        ...row,
        canReview: isManager && !isOwner && row.Status === 'PENDING',
    };
};

const loadVisible = async (actingUserId, deviationId) => {
    if (!GUID.test(String(deviationId))) {
        throw fail(400, 'Deviation id is invalid.');
    }

    const row = await DeviationDA.getDeviationById(deviationId);

    if (!row) {
        throw fail(404, 'Deviation not found.');
    }

    if (!sameId(row.UserId, actingUserId) && !sameId(row.ManagerId, actingUserId)) {
        throw fail(403, 'You are not allowed to view this deviation.');
    }

    return row;
};

exports.getDeviations = async (actingUserId, query) => {
    requireActingUser(actingUserId);

    const deviationType = query.deviationType || null;
    const status = query.status ? String(query.status).toUpperCase() : null;

    if (deviationType && !DEVIATION_TYPES.includes(deviationType)) {
        throw fail(400, 'Deviation type is invalid.');
    }

    if (status && !STATUSES.includes(status)) {
        throw fail(400, 'Status is invalid.');
    }

    const rows = await DeviationDA.getDeviations({
        ActingUserId: actingUserId,
        MonthStart: toMonthStart(query.month),
        UserId: optionalGuid(query.userId, 'User'),
        DivisionId: optionalGuid(query.divisionId, 'Division'),
        TerritoryId: optionalGuid(query.territoryId, 'Territory'),
        DeviationType: deviationType,
    });

    // Summary ignores the status filter so the cards stay meaningful.
    const summary = {
        total: rows.length,
        pending: rows.filter((r) => r.Status === 'PENDING').length,
        approved: rows.filter((r) => r.Status === 'APPROVED').length,
        rejected: rows.filter((r) => r.Status === 'REJECTED').length,
    };

    const deviations = (status ? rows.filter((r) => r.Status === status) : rows)
        .map((row) => withPermissions(row, actingUserId));

    return { summary, deviations };
};

exports.getDeviationById = async (actingUserId, deviationId) => {
    requireActingUser(actingUserId);

    return withPermissions(await loadVisible(actingUserId, deviationId), actingUserId);
};

exports.createDeviation = async (actingUserId, payload) => {
    requireActingUser(actingUserId);

    if (payload.UserId && !sameId(payload.UserId, actingUserId)) {
        throw fail(403, 'You can only submit your own deviation.');
    }

    const deviationDate = toIsoDate(payload.DeviationDate);

    if (deviationDate > new Date().toISOString().slice(0, 10)) {
        throw fail(400, 'Deviation date cannot be in the future.');
    }

    if (!DEVIATION_TYPES.includes(payload.DeviationType)) {
        throw fail(400, 'Deviation type is invalid.');
    }

    const reason = String(payload.Reason ?? '').trim();

    if (!reason || reason.length > 200) {
        throw fail(400, 'Reason is required (max 200 characters).');
    }

    const remarks = String(payload.Remarks ?? '').trim();

    if (remarks.length > 1000) {
        throw fail(400, 'Remarks cannot exceed 1000 characters.');
    }

    const actualTerritoryId = optionalGuid(payload.ActualTerritoryId, 'Actual territory');
    const actualAreaId = optionalGuid(payload.ActualAreaId, 'Actual area');

    if (!actualTerritoryId) {
        throw fail(400, 'Actual territory is required.');
    }

    const [user, territories, areas] = await Promise.all([
        DeviationDA.getUser(actingUserId),
        DeviationDA.getTerritoryIds(),
        DeviationDA.getAreaTerritories(),
    ]);

    if (!user) {
        throw fail(404, 'User not found.');
    }

    if (!user.ManagerId) {
        throw fail(400, 'No reporting manager is assigned, so the deviation cannot be submitted.');
    }

    if (!territories.some((t) => sameId(t.TerritoryId, actualTerritoryId))) {
        throw fail(400, 'Unknown actual territory.');
    }

    if (actualAreaId) {
        const area = areas.find((a) => sameId(a.AreaId, actualAreaId));

        if (!area || !sameId(area.TerritoryId, actualTerritoryId)) {
            throw fail(400, 'Area does not belong to the selected territory.');
        }
    }

    if (payload.DeviationType === 'Area Change' && !actualAreaId) {
        throw fail(400, 'Actual area is required for an area change.');
    }

    const planned = await DeviationDA.getPlannedForDate(
        actingUserId,
        `${deviationDate.slice(0, 8)}01`,
        deviationDate
    );

    if (
        planned &&
        sameId(planned.TerritoryId, actualTerritoryId) &&
        (!actualAreaId || sameId(planned.AreaId, actualAreaId))
    ) {
        throw fail(400, 'Actual territory and area match the plan, so there is no deviation.');
    }

    const DeviationId = generateUUID();

    await DeviationDA.createDeviation({
        DeviationId,
        UserId: actingUserId,
        DeviationDate: deviationDate,
        PlannedTerritoryId: planned?.TerritoryId || null,
        PlannedAreaId: planned?.AreaId || null,
        ActualTerritoryId: actualTerritoryId,
        ActualAreaId: actualAreaId,
        DeviationType: payload.DeviationType,
        Source: SOURCE,
        Reason: reason,
        Remarks: remarks || null,
        SubmittedOn: new Date(),
    });

    return { DeviationId, Status: 'PENDING' };
};

exports.reviewDeviation = async (actingUserId, deviationId, outcome, remarks) => {
    requireActingUser(actingUserId);

    const row = await loadVisible(actingUserId, deviationId);

    if (sameId(row.UserId, actingUserId) || !sameId(row.ManagerId, actingUserId)) {
        throw fail(403, 'Only the reporting manager can approve or reject this deviation.');
    }

    if (row.Status !== 'PENDING') {
        throw fail(409, 'Only pending deviations can be approved or rejected.');
    }

    const reviewRemarks = String(remarks ?? '').trim();

    if (reviewRemarks.length > 1000) {
        throw fail(400, 'Remarks cannot exceed 1000 characters.');
    }

    if (outcome === 'REJECTED' && !reviewRemarks) {
        throw fail(400, 'Remarks are required when rejecting a deviation.');
    }

    try {
        await DeviationDA.reviewDeviation({
            DeviationId: row.DeviationId,
            Status: outcome,
            ReviewedBy: actingUserId,
            ReviewedOn: new Date(),
            ReviewRemarks: reviewRemarks || null,
        });
    } catch (err) {
        throw mapDbError(err);
    }

    return { DeviationId: row.DeviationId, Status: outcome };
};
