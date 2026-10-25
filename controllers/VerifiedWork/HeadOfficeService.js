// Head office: rule values, territory boundaries, exceptions, hospitals, visit overrides, red flags.
// Managers only read (visits review, flags); every head-office change is written to the audit log.

const DA = require('./VerifiedWorkDA');
const rules = require('./rules');
const { loadSettings } = require('./territory');
const { describeReasons, resolveTarget, viewAll } = require('./VerifiedWorkService');

const { generateUUID } = require('../../utils/commonUtils');
const { auditQuery } = require('../../utils/audit');
const { fail, isGuid, optionalText, requireActingUser, sameId, toDateKey } = require('../../utils/access');

const MIN_REASON = 10;
const conflict = (error, message) => (error.number === 50409 ? fail(409, message || error.message) : error.number === 50404 ? fail(404, error.message) : error);

const reasonText = (value, label = 'Reason') => {
    const text = optionalText(value, 500, label);
    if (!text || text.length < MIN_REASON) throw fail(400, `${label} is required (at least ${MIN_REASON} characters).`);
    return text;
};

// =========================================================
// Settings (rule values per company)
// =========================================================

// Limits keep values sensible; anything else is refused.
const LIMITS = {
    GEOFENCE_METERS: [50, 1000],
    MIN_DWELL_MINUTES: [1, 60],
    MAX_WALK_KMH: [3, 40],
    BOUNDARY_MARGIN_KM: [0.5, 10],
    VISITS_CLASS_A: [1, 10],
    VISITS_CLASS_B: [1, 10],
    VISITS_CLASS_C: [1, 10],
    DA_MIN_VALID_VISITS: [0, 30],
    PING_INTERVAL_MINUTES: [5, 30],
    WORK_START_HOUR: [0, 23],
    WORK_END_HOUR: [1, 24],
    TIMING_MIN_VISITS: [1, 50],
    TIMING_MIN_SHARE: [0.3, 1],
    UNPINNED_CLINIC_VALID: [0, 1],
    REQUIRE_BOUNDARY: [0, 1],
    CLUSTER_METERS: [10, 500],
    MAX_TRAVEL_KMH: [20, 300],
    DUPLICATE_RADIUS_KM: [0.5, 20],
    NAME_SIMILARITY: [0.5, 1],
    VERIFY_DAYS: [1, 365],
    PROVISIONAL_TADA_PERCENT: [0, 100],
    // Business tracking
    CHEMIST_RADIUS_METERS: [50, 1000],
    ORDER_QTY_MULTIPLIER: [1.5, 20],
    FIRST_ORDER_MULTIPLIER: [1.5, 20],
    LARGE_ORDER_MULTIPLIER: [1, 20],
    NO_REORDER_DAYS: [15, 365],
    MONTH_END_SPIKE_MULTIPLIER: [1.2, 20],
    SLIP_HASH_DISTANCE: [0, 20],
    NEAR_EXPIRY_DAYS: [7, 365],
    FOLLOW_UP_AFTER_DAYS: [1, 30],
    INCENTIVE_HOLD_MONTHS: [0, 12],
    // Field ledger and doctor spend
    UNSUPPLIED_ALERT_DAYS: [1, 60],
    STOCKIST_FILL_RATE_MIN: [10, 100],
    MR_STOCK_LIMIT: [0, 10000000],
    MR_STOCK_HOLD_DAYS: [1, 180],
    CHEMIST_DUE_BLOCK_DAYS: [7, 365],
    SPEND_RATIO_MAX_PCT: [1, 500],
    SPEND_RATIO_MONTHS: [1, 12],
    FOCUS_VISIT_EFFORT: [0, 10000],
    SPEND_ON_TRACK_PCT: [10, 200],
    SPEND_PARTLY_PCT: [0, 100],
};

exports.getSettings = async () => {
    const rows = await DA.getSettings();
    return {
        settings: rows.map((row) => ({ key: row.SettingKey, value: Number(row.SettingValue), description: row.Description, limits: LIMITS[row.SettingKey] || null })),
    };
};

exports.saveSettings = async (actingUserId, payload) => {
    requireActingUser(actingUserId);
    const reason = reasonText(payload.Reason);
    const current = new Map((await DA.getSettings()).map((row) => [row.SettingKey, Number(row.SettingValue)]));
    const changes = Object.entries(payload.Values || {}).filter(([key, value]) => current.has(key) && Number(value) !== current.get(key));
    if (!changes.length) throw fail(400, 'Nothing was changed.');

    const rows = changes.map(([key, value]) => {
        const number = Number(value);
        const [min, max] = LIMITS[key] || [0, 100000];
        if (!Number.isFinite(number) || number < min || number > max) throw fail(400, `${key} must be between ${min} and ${max}.`);
        return { SettingKey: key, SettingValue: number, ActorId: actingUserId, Now: new Date() };
    });

    const before = Object.fromEntries(changes.map(([key]) => [key, current.get(key)]));
    const after = Object.fromEntries(rows.map((row) => [row.SettingKey, row.SettingValue]));
    await DA.updateSettings(rows, auditQuery({ entityType: 'SETTINGS', entityId: 'ANTI_FRAUD', action: 'UPDATE', actorId: actingUserId, reason, before, after }));
    return { message: `${rows.length} rule value(s) saved.` };
};

// =========================================================
// Territory boundaries
// =========================================================

const parseJson = (value) => {
    try {
        return value ? JSON.parse(value) : null;
    } catch {
        return null;
    }
};

exports.listBoundaries = async (actingUserId) => {
    requireActingUser(actingUserId);
    const rows = await DA.boundaryList({ ActingUserId: actingUserId, ViewAll: await viewAll(actingUserId) });
    return {
        users: rows.map((row) => ({
            UserId: row.UserId,
            Name: row.Name,
            RoleName: row.RoleName,
            pinnedDoctors: row.PinnedDoctors,
            approved: row.ApprovedId ? { BoundaryId: row.ApprovedId, polygon: parseJson(row.ApprovedPolygon), source: row.ApprovedSource, approvedOn: row.ApprovedOn } : null,
            draft: row.DraftId ? { BoundaryId: row.DraftId, polygon: parseJson(row.DraftPolygon), source: row.DraftSource, marginKm: row.DraftMarginKm, createdOn: row.DraftCreatedOn } : null,
        })),
    };
};

// Draft boundary: AUTO (around the MR's pinned clinics with a margin) or DRAWN (points given by head office).
exports.draftBoundary = async (actingUserId, userId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(userId)) throw fail(400, 'User is invalid.');

    const settings = await loadSettings();
    const source = String(payload.Source || 'AUTO').toUpperCase();
    let polygon;
    let marginKm = null;

    if (source === 'AUTO') {
        marginKm = Number(payload.MarginKm ?? settings.BOUNDARY_MARGIN_KM);
        if (!Number.isFinite(marginKm) || marginKm < 0.5 || marginKm > 10) throw fail(400, 'Margin must be 0.5 to 10 km.');
        const clinics = (await DA.clinicsOfUser(userId)).map((row) => [Number(row.Latitude), Number(row.Longitude)]);
        if (!clinics.length) throw fail(409, 'None of this person\'s doctors have a pinned clinic yet, so a boundary can\'t be created automatically.');
        polygon = rules.autoBoundary(clinics, marginKm);
    } else if (source === 'DRAWN') {
        polygon = rules.parsePolygon(payload.Polygon);
        if (!polygon) throw fail(400, 'The boundary needs 3 to 200 points with valid latitude and longitude.');
    } else {
        throw fail(400, 'Choose AUTO or DRAWN.');
    }

    const boundaryId = generateUUID();
    const notes = optionalText(payload.Notes, 500, 'Notes');
    await DA.insertBoundary(
        { BoundaryId: boundaryId, UserId: userId, Polygon: JSON.stringify(polygon), Source: source, MarginKm: marginKm, Notes: notes, ActorId: actingUserId, Now: new Date() },
        auditQuery({ entityType: 'BOUNDARY', entityId: boundaryId, action: `DRAFT_${source}`, actorId: actingUserId, reason: notes, after: { userId, points: polygon.length, marginKm } })
    );
    return { message: 'Draft boundary saved. Check it and approve it.', BoundaryId: boundaryId, polygon };
};

exports.approveBoundary = async (actingUserId, boundaryId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(boundaryId)) throw fail(400, 'Boundary is invalid.');
    const boundary = await DA.getBoundary(boundaryId);
    if (!boundary) throw fail(404, 'Boundary not found.');
    const remarks = optionalText(payload.Remarks, 500, 'Remarks');

    try {
        await DA.approveBoundary(
            { BoundaryId: boundaryId, UserId: boundary.UserId, ActorId: actingUserId, Now: new Date() },
            auditQuery({ entityType: 'BOUNDARY', entityId: boundaryId, action: 'APPROVE', actorId: actingUserId, reason: remarks, after: { userId: boundary.UserId } })
        );
    } catch (error) {
        throw conflict(error);
    }
    return { message: 'Boundary approved. Visits are checked against it from now on.' };
};

// =========================================================
// Exceptions (head office only)
// =========================================================

const TYPES = ['DOCTOR', 'COVER', 'SPECIAL_DUTY'];

exports.listExceptions = async (actingUserId) => {
    requireActingUser(actingUserId);
    return { exceptions: await DA.listExceptions({ ActingUserId: actingUserId, ViewAll: await viewAll(actingUserId) }) };
};

exports.grantException = async (actingUserId, payload) => {
    requireActingUser(actingUserId);
    const type = String(payload.ExceptionType || '').toUpperCase();
    if (!TYPES.includes(type)) throw fail(400, 'Choose a doctor exception, leave cover or special duty.');
    if (!isGuid(payload.UserId)) throw fail(400, 'Choose the employee.');

    const reason = reasonText(payload.Reason);
    const from = payload.FromDate ? toDateKey(payload.FromDate, 'From date') : null;
    const to = payload.ToDate ? toDateKey(payload.ToDate, 'To date') : null;
    if ((type === 'COVER' || type === 'SPECIAL_DUTY') && (!from || !to)) throw fail(400, 'Leave cover and special duty need from and to dates.');
    if (from && to && to < from) throw fail(400, 'To date must be on or after the from date.');
    if (type === 'DOCTOR' && !isGuid(payload.DoctorId)) throw fail(400, 'Choose the doctor.');
    if (type === 'COVER' && (!isGuid(payload.CoverUserId) || sameId(payload.CoverUserId, payload.UserId))) throw fail(400, 'Choose the colleague whose territory is covered.');

    const exceptionId = generateUUID();
    const row = {
        ExceptionId: exceptionId,
        UserId: payload.UserId,
        ExceptionType: type,
        DoctorId: type === 'DOCTOR' ? payload.DoctorId : null,
        CoverUserId: type === 'COVER' ? payload.CoverUserId : null,
        FromDate: from,
        ToDate: to,
        Reason: reason,
        ActorId: actingUserId,
        Now: new Date(),
    };
    await DA.insertException(row, auditQuery({ entityType: 'TERRITORY_EXCEPTION', entityId: exceptionId, action: `GRANT_${type}`, actorId: actingUserId, reason, after: row }));
    return { message: 'Exception granted.' };
};

exports.revokeException = async (actingUserId, exceptionId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(exceptionId)) throw fail(400, 'Exception is invalid.');
    const existing = await DA.getException(exceptionId);
    if (!existing) throw fail(404, 'Exception not found.');
    const reason = reasonText(payload.Reason);

    try {
        await DA.revokeException(
            { ExceptionId: exceptionId, ActorId: actingUserId, Now: new Date() },
            auditQuery({ entityType: 'TERRITORY_EXCEPTION', entityId: exceptionId, action: 'REVOKE', actorId: actingUserId, reason, before: existing })
        );
    } catch (error) {
        throw conflict(error);
    }
    return { message: 'Exception revoked.' };
};

// =========================================================
// Hospitals (several doctors at one place)
// =========================================================

const hospitalInput = (payload) => {
    const name = optionalText(payload.HospitalName, 200, 'Hospital name');
    if (!name) throw fail(400, 'Hospital name is required.');
    const lat = Number(payload.Latitude);
    const lng = Number(payload.Longitude);
    if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) throw fail(400, 'Hospital location is invalid.');
    const radius = payload.RadiusM == null || payload.RadiusM === '' ? 200 : Number(payload.RadiusM);
    if (!Number.isInteger(radius) || radius < 50 || radius > 1000) throw fail(400, 'Radius must be 50 to 1000 m.');
    if (payload.AreaId && !isGuid(payload.AreaId)) throw fail(400, 'Area is invalid.');
    return { HospitalName: name, AreaId: payload.AreaId || null, Latitude: Number(lat.toFixed(6)), Longitude: Number(lng.toFixed(6)), RadiusM: radius };
};

exports.listHospitals = async () => ({ hospitals: await DA.listHospitals() });

exports.saveHospital = async (actingUserId, hospitalId, payload) => {
    requireActingUser(actingUserId);
    const input = hospitalInput(payload);
    const now = new Date();

    try {
        if (hospitalId) {
            if (!isGuid(hospitalId)) throw fail(400, 'Hospital is invalid.');
            const row = { ...input, HospitalId: hospitalId, IsActive: payload.IsActive === false ? 0 : 1, Now: now };
            await DA.updateHospital(row, auditQuery({ entityType: 'HOSPITAL', entityId: hospitalId, action: 'UPDATE', actorId: actingUserId, after: row }));
            return { message: 'Hospital saved.', HospitalId: hospitalId };
        }
        const id = generateUUID();
        const row = { ...input, HospitalId: id, ActorId: actingUserId, Now: now };
        await DA.insertHospital(row, auditQuery({ entityType: 'HOSPITAL', entityId: id, action: 'CREATE', actorId: actingUserId, after: row }));
        return { message: 'Hospital added.', HospitalId: id };
    } catch (error) {
        throw conflict(error);
    }
};

exports.hospitalDoctors = async (hospitalId, query) => {
    if (!isGuid(hospitalId)) throw fail(400, 'Hospital is invalid.');
    return { doctors: await DA.hospitalDoctors({ HospitalId: hospitalId, AreaId: isGuid(query.areaId) ? query.areaId : null }) };
};

// Sets which doctors sit in the hospital (others in the list are removed from it).
exports.setHospitalDoctors = async (actingUserId, hospitalId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(hospitalId)) throw fail(400, 'Hospital is invalid.');
    const add = (payload.Add || []).filter(isGuid);
    const remove = (payload.Remove || []).filter(isGuid);
    if (!add.length && !remove.length) throw fail(400, 'Nothing was changed.');

    const now = new Date();
    const rows = [...add.map((DoctorId) => ({ DoctorId, HospitalId: hospitalId, Now: now })), ...remove.map((DoctorId) => ({ DoctorId, HospitalId: null, Now: now }))];
    await DA.setDoctorHospitals(rows, auditQuery({ entityType: 'HOSPITAL', entityId: hospitalId, action: 'DOCTORS', actorId: actingUserId, after: { add, remove } }));
    return { message: 'Hospital doctors updated.' };
};

// =========================================================
// Visit validity: managers view, head office overrides
// =========================================================

const VALIDITY_FILTERS = ['VALID', 'REVIEW', 'INVALID', 'UNCHECKED'];

exports.listVisits = async (actingUserId, query) => {
    requireActingUser(actingUserId);
    const today = rules.istDateKey();
    const from = query.from ? toDateKey(query.from, 'From') : `${today.slice(0, 8)}01`;
    const to = query.to ? toDateKey(query.to, 'To') : today;
    if (to < from) throw fail(400, 'To date must be on or after the from date.');
    const userId = query.userId ? await resolveTarget(actingUserId, query.userId) : null;
    const validity = VALIDITY_FILTERS.includes(String(query.validity || '').toUpperCase()) ? String(query.validity).toUpperCase() : null;

    const rows = await DA.listVisits({ ActingUserId: actingUserId, ViewAll: await viewAll(actingUserId), From: from, To: to, UserId: userId, Validity: validity });
    const visits = rows.map((row) => ({ ...row, ...describeReasons(row.InvalidReasons), InvalidReasons: undefined }));

    return {
        from,
        to,
        summary: {
            total: visits.length,
            valid: visits.filter((v) => v.FinalValidity === 'VALID').length,
            review: visits.filter((v) => v.FinalValidity === 'REVIEW').length,
            invalid: visits.filter((v) => v.FinalValidity === 'INVALID').length,
            unchecked: visits.filter((v) => !v.FinalValidity).length,
            overridden: visits.filter((v) => v.ValidityOverride).length,
        },
        visits,
    };
};

exports.overrideVisit = async (actingUserId, visitId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(visitId)) throw fail(400, 'Visit is invalid.');
    const visit = await DA.getVisit(visitId);
    if (!visit) throw fail(404, 'Visit not found.');

    const value = payload.Validity == null ? null : String(payload.Validity).toUpperCase();
    if (value != null && !['VALID', 'INVALID'].includes(value)) throw fail(400, 'Choose valid, not counted, or clear the override.');
    const reason = reasonText(payload.Reason);
    if (value === (visit.ValidityOverride || null)) throw fail(400, 'That is already the result.');

    const before = { validity: visit.Validity, override: visit.ValidityOverride, final: visit.ValidityOverride || visit.Validity };
    const after = { validity: visit.Validity, override: value, final: value || visit.Validity };

    try {
        await DA.overrideVisit(
            { VisitId: visitId, ValidityOverride: value, ActorId: actingUserId, Reason: reason, Now: new Date() },
            auditQuery({ entityType: 'VISIT', entityId: visitId, action: value ? `OVERRIDE_${value}` : 'OVERRIDE_CLEARED', actorId: actingUserId, reason, before, after })
        );
    } catch (error) {
        throw conflict(error);
    }
    return { message: value ? `Visit marked ${value === 'VALID' ? 'valid' : 'not counted'} by head office.` : 'Override removed; the system result applies again.' };
};

// =========================================================
// Red flags (day start / visits outside the territory, drive-bys, fake GPS ...)
// =========================================================

exports.listFlags = async (actingUserId, query) => {
    requireActingUser(actingUserId);
    const status = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(String(query.status || '').toUpperCase()) ? String(query.status).toUpperCase() : null;
    const [flags, shared] = await Promise.all([DA.listFlags({ ActingUserId: actingUserId, ViewAll: await viewAll(actingUserId), Status: status }), DA.sharedDoctors()]);
    return { flags, sharedDoctors: shared };
};

exports.actOnFlag = async (actingUserId, flagId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(flagId)) throw fail(400, 'Flag is invalid.');
    const status = String(payload.Status || '').toUpperCase();
    if (!['ACKNOWLEDGED', 'RESOLVED', 'OPEN'].includes(status)) throw fail(400, 'Choose acknowledge, resolve or reopen.');
    const note = status === 'RESOLVED' ? reasonText(payload.Note, 'Note') : optionalText(payload.Note, 500, 'Note');

    try {
        await DA.actOnFlag(
            { FlagId: flagId, Status: status, ActorId: actingUserId, Note: note, Now: new Date() },
            auditQuery({ entityType: 'FRAUD_FLAG', entityId: flagId, action: status, actorId: actingUserId, reason: note })
        );
    } catch (error) {
        throw conflict(error);
    }
    return { message: 'Flag updated.' };
};
