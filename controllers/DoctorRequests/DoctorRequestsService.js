const DA = require('./DoctorRequestsDA');
const fileStore = require('../../utils/fileStore');

const { generateUUID } = require('../../utils/commonUtils');
const { auditQuery } = require('../../utils/audit');
const { getPermissions } = require('../../utils/permissions');
const { resolveScope } = require('../../utils/reportScope');
const { fail, isGuid, optionalText, requireActingUser, sameId, todayKey } = require('../../utils/access');
const {
    boundingBox,
    distanceMeters,
    nameSimilarity,
    normalizeName,
    normalizePhone,
    normalizeRegistration,
    normalizeSpeciality,
} = require('../../utils/doctorMatching');

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MIN_COMMENT = 10;
const WEAK_GPS_METERS = 100;
const PHOTO_ID = /^[0-9a-f-]{36}\.(jpg|png|webp)$/i;

// Why a new doctor was sent without a signboard photo (the manager sees it as a warning).
// Live GPS is still required; the doctor stays provisional until verified.
const NO_PHOTO_REASONS = {
    NO_SIGNBOARD: 'No signboard at the clinic',
    INSIDE_HOSPITAL: 'Doctor sits inside a hospital',
    HOME_CLINIC: 'Home clinic',
    NOT_ALLOWED: 'Photo not allowed at the clinic',
};

const DEFAULT_SETTINGS = {
    VERIFY_DAYS: 45,
    DUPLICATE_RADIUS_KM: 2,
    NAME_SIMILARITY: 0.88,
    CLUSTER_METERS: 50,
};

const loadSettings = async () => {
    const rows = await DA.getSettings().catch(() => []);
    return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map((row) => [row.SettingKey, Number(row.SettingValue)])) };
};

const addDays = (key, days) => {
    const date = new Date(`${key}T00:00:00`);
    date.setDate(date.getDate() + days);
    return todayKey(date);
};

const key = (value) => String(value || '').toLowerCase();

// The fields an MR may set when adding a doctor or request to change.
const EDITABLE = [
    'DoctorName', 'Qualification', 'Speciality', 'HospitalName', 'MobileNumber', 'EmailId', 'RegistrationNumber', 'Category', 'VisitsPerMonth', 'TerritoryId', 'AreaId',
    'CountryId', 'StateId', 'DateOfBirth', 'AnniversaryDate', 'IsActive',
];

// =========================================================
// INPUT
// =========================================================

const text = (value, max, label, { required = false, min = 0 } = {}) => {
    const clean = optionalText(value, max, label);
    if (required && !clean) throw fail(400, `${label} is required.`);
    if (clean && clean.length < min) throw fail(400, `${label} must be at least ${min} characters.`);
    return clean;
};

const parseDoctorFields = (payload, { partial = false } = {}) => {
    const fields = {};
    const has = (name) => !partial || Object.prototype.hasOwnProperty.call(payload, name);

    if (has('DoctorName')) fields.DoctorName = text(payload.DoctorName, 150, 'Doctor name', { required: true, min: 3 });
    if (has('Speciality')) fields.Speciality = text(payload.Speciality, 100, 'Speciality', { required: true });
    if (has('Qualification')) fields.Qualification = text(payload.Qualification, 200, 'Qualification');
    if (has('HospitalName')) fields.HospitalName = text(payload.HospitalName, 200, 'Clinic / hospital');
    if (has('EmailId')) {
        fields.EmailId = text(payload.EmailId, 150, 'Email');
        if (fields.EmailId && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.EmailId)) throw fail(400, 'Email is invalid.');
    }
    if (has('MobileNumber')) {
        const raw = text(payload.MobileNumber, 20, 'Phone number');
        if (raw && !normalizePhone(raw)) throw fail(400, 'Phone number must have at least 10 digits.');
        fields.MobileNumber = raw ? normalizePhone(raw) : null;
    }
    if (has('RegistrationNumber')) {
        const raw = text(payload.RegistrationNumber, 40, 'Registration number');
        if (raw && !normalizeRegistration(raw)) throw fail(400, 'Registration number is too short.');
        fields.RegistrationNumber = raw ? normalizeRegistration(raw) : null;
    }
    if (has('Category')) {
        const category = payload.Category ? String(payload.Category).toUpperCase() : null;
        if (category && !['A', 'B', 'C'].includes(category)) throw fail(400, 'Category must be A, B or C.');
        fields.Category = category;
    }
    if (has('VisitsPerMonth')) {
        const visits = payload.VisitsPerMonth === '' || payload.VisitsPerMonth == null ? null : Number(payload.VisitsPerMonth);
        if (visits != null && (!Number.isInteger(visits) || visits < 1 || visits > 31)) throw fail(400, 'Visits per month must be 1–31.');
        fields.VisitsPerMonth = visits;
    }
    // Optional extras from the full doctor form.
    if (has('CountryId')) {
        if (payload.CountryId && !isGuid(payload.CountryId)) throw fail(400, 'Country is invalid.');
        fields.CountryId = payload.CountryId ? String(payload.CountryId).toUpperCase() : null;
    }
    if (has('StateId')) {
        if (payload.StateId && !isGuid(payload.StateId)) throw fail(400, 'State is invalid.');
        fields.StateId = payload.StateId ? String(payload.StateId).toUpperCase() : null;
    }
    [['DateOfBirth', 'Date of birth'], ['AnniversaryDate', 'Anniversary date']].forEach(([name, label]) => {
        if (!has(name)) return;
        const value = payload[name] ? String(payload[name]).slice(0, 10) : null;
        if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))) throw fail(400, `${label} is invalid.`);
        fields[name] = value;
    });
    // Active / inactive (edit requests only; a new doctor always starts active).
    if (has('IsActive') && payload.IsActive != null) {
        const active = String(payload.IsActive).toLowerCase();
        if (!['yes', 'no'].includes(active)) throw fail(400, 'Status must be Yes or No.');
        fields.IsActive = active === 'yes' ? 'Yes' : 'No';
    }
    if (has('TerritoryId') || has('AreaId')) {
        if (!isGuid(payload.TerritoryId) || !isGuid(payload.AreaId)) throw fail(400, 'Choose the territory and area.');
        fields.TerritoryId = String(payload.TerritoryId).toUpperCase();
        fields.AreaId = String(payload.AreaId).toUpperCase();
    }

    return fields;
};

// Live GPS is required: a doctor's clinic must be pinned where the MR is standing.
const parseLocation = (payload, label = 'Clinic location') => {
    if (String(payload.LocationStatus || '').toUpperCase() !== 'CAPTURED') {
        throw fail(400, `${label} is required. Turn on location and capture it at the clinic.`);
    }

    const latitude = Number(payload.Latitude);
    const longitude = Number(payload.Longitude);
    const accuracy = payload.Accuracy == null ? null : Number(payload.Accuracy);

    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
        throw fail(400, `${label} coordinates are invalid.`);
    }
    if (accuracy != null && (!Number.isFinite(accuracy) || accuracy < 0)) throw fail(400, 'Location accuracy is invalid.');

    return { Latitude: Number(latitude.toFixed(6)), Longitude: Number(longitude.toFixed(6)), Accuracy: accuracy == null ? null : Math.round(accuracy * 100) / 100 };
};

// =========================================================
// PHOTOS: uploaded first (raw image body), then attached when the request is submitted
// =========================================================

const draftKey = (userId, photoId) => `drafts/${key(userId)}/${photoId.toLowerCase()}`;

exports.uploadPhoto = async (actingUserId, buffer) => {
    requireActingUser(actingUserId);

    if (!Buffer.isBuffer(buffer) || !buffer.length) throw fail(400, 'No photo received.');
    if (buffer.length > MAX_PHOTO_BYTES) throw fail(413, 'Photo is larger than 5 MB.');

    const type = fileStore.sniffImage(buffer);
    if (!type) throw fail(400, 'Only JPEG, PNG or WebP photos are accepted.');

    const photoId = `${generateUUID()}.${type.ext}`;
    await fileStore.put(draftKey(actingUserId, photoId), buffer);

    return { photoId, sizeBytes: buffer.length };
};

// Moves an uploaded draft photo to the doctor's evidence folder; returns the DoctorEvidence row inputs.
const claimPhoto = async (actingUserId, photoId, doctorId, kind, location, now) => {
    if (!PHOTO_ID.test(String(photoId || ''))) throw fail(400, 'Take the clinic signboard photo first.');

    let buffer;
    try {
        buffer = await fileStore.get(draftKey(actingUserId, photoId));
    } catch {
        throw fail(400, 'The photo upload was not found. Take the photo again.');
    }

    const type = fileStore.sniffImage(buffer);
    const evidenceId = generateUUID();
    const storageKey = `doctor-evidence/${key(doctorId)}/${evidenceId}.${type.ext}`;
    const stored = await fileStore.put(storageKey, buffer);
    await fileStore.remove(draftKey(actingUserId, photoId));

    return {
        EvidenceId: evidenceId,
        DoctorId: doctorId,
        Kind: kind,
        StorageDriver: stored.driver,
        StorageKey: stored.key,
        ContentType: type.contentType,
        SizeBytes: buffer.length,
        Latitude: location?.Latitude ?? null,
        Longitude: location?.Longitude ?? null,
        Accuracy: location?.Accuracy ?? null,
        Now: now,
        UploadedBy: actingUserId,
    };
};

// Shared with doctor verification (prescription pad / visiting card photos).
exports.claimPhoto = claimPhoto;

// =========================================================
// DUPLICATE DETECTION
// =========================================================

const publicDoctor = (row) =>
    row && {
        DoctorId: row.DoctorId,
        DoctorName: row.DoctorName,
        Speciality: row.Speciality,
        Qualification: row.Qualification,
        HospitalName: row.HospitalName,
        TerritoryName: row.TerritoryName,
        AreaName: row.AreaName,
        Category: row.Category,
        VerificationStatus: row.VerificationStatus,
        ApprovalStatus: row.ApprovalStatus,
        Source: row.Source,
        CreatedByName: row.CreatedByName,
        HasPhone: Boolean(row.MobileNumber),
        HasRegistration: Boolean(row.RegistrationNumber),
        ClinicLatitude: row.ClinicLatitude == null ? null : Number(row.ClinicLatitude),
        ClinicLongitude: row.ClinicLongitude == null ? null : Number(row.ClinicLongitude),
        SignboardId: row.SignboardId,
    };

// Possible duplicates of `subject` (a new or edited doctor):
//   REGISTRATION_NO / PHONE: exact match, always a duplicate.
//   NAME_NEARBY: similar name + same speciality + clinic within the radius
//                (or, for older doctors without a clinic location, in the same area).
//   SAME_SPOT:   any doctor from a different area within the cluster distance.
const findDuplicates = async (subject, settings, excludeId = null) => {
    const radius = settings.DUPLICATE_RADIUS_KM * 1000;
    const speciality = normalizeSpeciality(subject.Speciality);
    const hasGps = subject.Latitude != null && subject.Longitude != null;

    const [nearby, sameArea, byPhone, byRegistration] = await Promise.all([
        hasGps ? DA.candidatesNearby({ ExcludeId: excludeId, ...boundingBox(subject.Latitude, subject.Longitude, radius) }) : [],
        isGuid(subject.AreaId) ? DA.candidatesSameArea({ ExcludeId: excludeId, AreaId: subject.AreaId }) : [],
        subject.MobileNumber ? DA.candidatesPhone({ ExcludeId: excludeId, Phone: normalizePhone(subject.MobileNumber) }) : [],
        subject.RegistrationNumber ? DA.candidatesRegistration({ ExcludeId: excludeId, Registration: normalizeRegistration(subject.RegistrationNumber) }) : [],
    ]);

    const matches = new Map();
    const add = (doctor, reason, score = null, distance = null) => {
        const id = key(doctor.DoctorId);
        if (!matches.has(id)) matches.set(id, { doctor: publicDoctor(doctor), reasons: [] });
        if (!matches.get(id).reasons.some((item) => item.reason === reason)) matches.get(id).reasons.push({ reason, score, distanceM: distance });
    };

    byRegistration.forEach((doctor) => add(doctor, 'REGISTRATION_NO'));
    byPhone.forEach((doctor) => add(doctor, 'PHONE'));

    nearby.forEach((doctor) => {
        const distance = distanceMeters(subject.Latitude, subject.Longitude, Number(doctor.ClinicLatitude), Number(doctor.ClinicLongitude));
        if (distance == null || distance > radius) return;

        const score = nameSimilarity(subject.DoctorName, doctor.DoctorName);
        if (score >= settings.NAME_SIMILARITY && normalizeSpeciality(doctor.Speciality) === speciality) add(doctor, 'NAME_NEARBY', score, distance);

        const differentArea = subject.AreaId && doctor.AreaId && key(subject.AreaId) !== key(doctor.AreaId);
        if (distance <= settings.CLUSTER_METERS && differentArea) add(doctor, 'SAME_SPOT', null, distance);
    });

    sameArea.forEach((doctor) => {
        const score = nameSimilarity(subject.DoctorName, doctor.DoctorName);
        if (score >= settings.NAME_SIMILARITY && normalizeSpeciality(doctor.Speciality) === speciality) add(doctor, 'NAME_NEARBY', score, null);
    });

    const weight = { REGISTRATION_NO: 0, PHONE: 1, NAME_NEARBY: 2, SAME_SPOT: 3 };
    return [...matches.values()].sort((a, b) => Math.min(...a.reasons.map((r) => weight[r.reason])) - Math.min(...b.reasons.map((r) => weight[r.reason])));
};

const flagRows = (doctorId, duplicates, now) =>
    duplicates.flatMap((match) =>
        match.reasons.map((reason) => ({
            FlagId: generateUUID(),
            DoctorId: doctorId,
            MatchDoctorId: match.doctor.DoctorId,
            Reason: reason.reason,
            Score: reason.score,
            DistanceM: reason.distanceM,
            Now: now,
        }))
    );

// A registration number belongs to one doctor: an exact match with an approved doctor is refused.
const refuseRegistrationClash = (duplicates) => {
    const clash = duplicates.find((match) => match.doctor.ApprovalStatus === 'APPROVED' && match.reasons.some((r) => r.reason === 'REGISTRATION_NO'));
    if (clash) {
        throw fail(409, `This registration number already belongs to Dr. ${clash.doctor.DoctorName}${clash.doctor.AreaName ? ` (${clash.doctor.AreaName})` : ''}. Ask your manager to assign that doctor to you instead.`);
    }
};

// Live check while the MR fills in the form (nothing is saved).
exports.checkDuplicates = async (actingUserId, payload) => {
    requireActingUser(actingUserId);
    const settings = await loadSettings();

    const subject = {
        DoctorName: String(payload.DoctorName || ''),
        Speciality: String(payload.Speciality || ''),
        AreaId: isGuid(payload.AreaId) ? payload.AreaId : null,
        MobileNumber: normalizePhone(payload.MobileNumber),
        RegistrationNumber: normalizeRegistration(payload.RegistrationNumber),
        Latitude: Number.isFinite(Number(payload.Latitude)) && payload.Latitude !== '' && payload.Latitude != null ? Number(payload.Latitude) : null,
        Longitude: Number.isFinite(Number(payload.Longitude)) && payload.Longitude !== '' && payload.Longitude != null ? Number(payload.Longitude) : null,
    };

    if (normalizeName(subject.DoctorName).length < 3 && !subject.MobileNumber && !subject.RegistrationNumber) return { duplicates: [] };

    return { duplicates: await findDuplicates(subject, settings, isGuid(payload.ExcludeDoctorId) ? payload.ExcludeDoctorId : null) };
};

// One-off (and repeatable) scan of all doctors: fills normalised names and records duplicate flags.
exports.scanDuplicates = async (actingUserId) => {
    requireActingUser(actingUserId);
    const settings = await loadSettings();
    const doctors = await DA.allLiveDoctors();
    const now = new Date();

    const names = doctors
        .filter((doctor) => doctor.NormalizedName !== normalizeName(doctor.DoctorName))
        .map((doctor) => ({ DoctorId: doctor.DoctorId, NormalizedName: normalizeName(doctor.DoctorName) }));

    const flags = [];
    const push = (a, b, reason, score = null, distance = null) =>
        flags.push({ FlagId: generateUUID(), DoctorId: a.DoctorId, MatchDoctorId: b.DoctorId, Reason: reason, Score: score, DistanceM: distance, Now: now });

    // Exact phone / registration matches.
    ['MobileNumber', 'RegistrationNumber'].forEach((field) => {
        const normalise = field === 'MobileNumber' ? normalizePhone : normalizeRegistration;
        const groups = new Map();
        doctors.forEach((doctor) => {
            const value = normalise(doctor[field]);
            if (value) groups.set(value, [...(groups.get(value) || []), doctor]);
        });
        groups.forEach((group) => {
            for (let i = 0; i < group.length; i += 1) for (let j = i + 1; j < group.length; j += 1) push(group[i], group[j], field === 'MobileNumber' ? 'PHONE' : 'REGISTRATION_NO');
        });
    });

    // Similar names within the same speciality (compared only inside each speciality).
    const bySpeciality = new Map();
    doctors.forEach((doctor) => {
        const speciality = normalizeSpeciality(doctor.Speciality);
        bySpeciality.set(speciality, [...(bySpeciality.get(speciality) || []), doctor]);
    });

    const radius = settings.DUPLICATE_RADIUS_KM * 1000;
    bySpeciality.forEach((group) => {
        for (let i = 0; i < group.length; i += 1) {
            for (let j = i + 1; j < group.length; j += 1) {
                const a = group[i];
                const b = group[j];
                const score = nameSimilarity(a.DoctorName, b.DoctorName);
                if (score < settings.NAME_SIMILARITY) continue;

                const distance = distanceMeters(a.ClinicLatitude, a.ClinicLongitude, b.ClinicLatitude, b.ClinicLongitude);
                const close = distance != null ? distance <= radius : key(a.AreaId) && key(a.AreaId) === key(b.AreaId);
                if (close) push(a, b, 'NAME_NEARBY', score, distance);
            }
        }
    });

    await DA.saveScan(names, flags);

    return { message: `Checked ${doctors.length} doctor(s): ${flags.length} possible duplicate pair(s) flagged.`, doctors: doctors.length, flagged: flags.length, namesUpdated: names.length };
};

// =========================================================
// REQUESTS: create
// =========================================================

const approverFor = async (userId) => (await DA.getUser(userId))?.ManagerId || null;

const validateArea = async (fields) => {
    if (fields.TerritoryId && !(await DA.areaInTerritory(fields.AreaId, fields.TerritoryId))) throw fail(400, 'That area is not in the chosen territory.');
};

exports.requestNewDoctor = async (actingUserId, payload) => {
    requireActingUser(actingUserId);

    const settings = await loadSettings();
    const { IsActive: _ignored, ...fields } = parseDoctorFields(payload);
    const location = parseLocation(payload);
    await validateArea(fields);

    const doctorId = generateUUID();
    const now = new Date();
    const duplicates = await findDuplicates({ ...fields, ...location }, settings);
    refuseRegistrationClash(duplicates);

    // The signboard photo is optional; without one the MR says why.
    const warnings = [];
    let evidence = null;
    if (payload.PhotoId) {
        evidence = await claimPhoto(actingUserId, payload.PhotoId, doctorId, 'SIGNBOARD', location, now);
    } else {
        const missing = NO_PHOTO_REASONS[String(payload.NoPhotoReason || '').toUpperCase()];
        if (!missing) throw fail(400, 'Take the clinic signboard photo, or choose why there is none.');
        warnings.push({ reason: 'NO_SIGNBOARD_PHOTO', detail: missing });
    }

    if (location.Accuracy != null && location.Accuracy > WEAK_GPS_METERS) warnings.push({ reason: 'WEAK_GPS', detail: `Location accuracy was ${Math.round(location.Accuracy)} m.` });

    const doctor = {
        DoctorId: doctorId,
        NormalizedName: normalizeName(fields.DoctorName),
        Qualification: null,
        HospitalName: null,
        MobileNumber: null,
        EmailId: null,
        RegistrationNumber: null,
        Category: null,
        VisitsPerMonth: null,
        CountryId: null,
        StateId: null,
        DateOfBirth: null,
        AnniversaryDate: null,
        ...fields,
        Now: now,
        CreatedBy: actingUserId,
        ...location,
        VerificationDueOn: addDays(todayKey(), settings.VERIFY_DAYS),
    };

    try {
        await DA.createDoctorRequest({
            doctor,
            evidence,
            request: {
                RequestId: generateUUID(),
                DoctorId: doctorId,
                RequestType: 'CREATE',
                RequestedBy: actingUserId,
                Comment: text(payload.Comment, 1000, 'Comment'),
                CurrentData: null,
                ProposedData: JSON.stringify(fields),
                FlagsSnapshot: JSON.stringify({ duplicates, warnings }),
                ApproverId: await approverFor(actingUserId),
                Now: now,
            },
            flags: flagRows(doctorId, duplicates, now),
            audit: auditQuery({ entityType: 'DOCTOR', entityId: doctorId, action: 'REQUEST_CREATE', actorId: actingUserId, after: { ...fields, ...location } }),
        });
    } catch (error) {
        if (evidence) await fileStore.remove(evidence.StorageKey);
        throw error;
    }

    return {
        message: duplicates.length
            ? `Dr. ${fields.DoctorName} sent to your manager, flagged as a possible duplicate of ${duplicates.length} doctor(s).`
            : `Dr. ${fields.DoctorName} sent to your manager for approval.`,
        DoctorId: doctorId,
        duplicates: duplicates.length,
    };
};

const isConflict = (error) => error.number === 50409 || /already (a pending|sent|decided)/i.test(error.message);

// Edit or delete an assigned doctor: a comment is required; nothing changes until the manager approves.
// `resubmitOf` links a request sent again after a rejection (kept in FlagsSnapshot for the history).
exports.requestChange = async (actingUserId, doctorId, payload, resubmitOf = null) => {
    requireActingUser(actingUserId);
    if (!isGuid(doctorId)) throw fail(400, 'Doctor is invalid.');

    const type = String(payload.RequestType || '').toUpperCase();
    if (!['EDIT', 'DELETE'].includes(type)) throw fail(400, 'Choose edit or delete.');

    const comment = text(payload.Comment, 1000, 'Reason', { required: true, min: MIN_COMMENT });

    const doctor = await DA.getDoctor(doctorId);
    if (!doctor || doctor.IsActive === 'No') throw fail(404, 'Doctor not found.');
    if (doctor.ApprovalStatus !== 'APPROVED') throw fail(409, 'This doctor is still waiting for approval.');
    if (!(await DA.isMapped(actingUserId, doctorId))) throw fail(403, 'You can only request changes for doctors assigned to you.');

    const pending = await DA.pendingForDoctor(doctorId);
    if (pending) throw fail(409, `There is already a pending ${pending.RequestType.toLowerCase()} request for this doctor.`);

    const current = Object.fromEntries(EDITABLE.map((field) => [field, doctor[field] ?? null]));
    const now = new Date();
    let proposed = null;
    let evidence = null;
    let duplicates = [];
    const warnings = [];

    if (type === 'EDIT') {
        const fields = parseDoctorFields(payload.Changes || {}, { partial: true });
        if (fields.TerritoryId) await validateArea(fields);

        const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
        proposed = Object.fromEntries(Object.entries(fields).filter(([field, value]) => !same(value, current[field])));

        // Moving the clinic: needs live GPS at the new place, and is always shown to the manager.
        let location = null;
        if (payload.MoveClinic) {
            location = parseLocation(payload, 'New clinic location');
            proposed.ClinicLatitude = location.Latitude;
            proposed.ClinicLongitude = location.Longitude;
            proposed.ClinicGpsAccuracy = location.Accuracy;
            const moved = distanceMeters(doctor.ClinicLatitude, doctor.ClinicLongitude, location.Latitude, location.Longitude);
            warnings.push({ reason: 'CLINIC_MOVED', detail: moved == null ? 'Clinic location set for the first time.' : `Clinic moved by ${moved} m.` });
            if (payload.PhotoId) evidence = await claimPhoto(actingUserId, payload.PhotoId, doctorId, 'SIGNBOARD', location, now);
        }

        if (!Object.keys(proposed).length) throw fail(400, 'Nothing was changed.');

        const settings = await loadSettings();
        const after = { ...current, ...proposed };
        duplicates = await findDuplicates(
            { ...after, Latitude: proposed.ClinicLatitude ?? doctor.ClinicLatitude, Longitude: proposed.ClinicLongitude ?? doctor.ClinicLongitude },
            settings,
            doctorId
        );
        refuseRegistrationClash(duplicates);
    }

    try {
        await DA.createChangeRequest({
            evidence,
            request: {
                RequestId: generateUUID(),
                DoctorId: doctorId,
                RequestType: type,
                RequestedBy: actingUserId,
                Comment: comment,
                CurrentData: JSON.stringify({ ...current, ClinicLatitude: doctor.ClinicLatitude, ClinicLongitude: doctor.ClinicLongitude }),
                ProposedData: proposed ? JSON.stringify(proposed) : null,
                FlagsSnapshot: JSON.stringify({ duplicates, warnings, ...(resubmitOf ? { resubmitOf } : {}) }),
                ApproverId: await approverFor(actingUserId),
                Now: now,
            },
            audit: auditQuery({
                entityType: 'DOCTOR',
                entityId: doctorId,
                action: `${resubmitOf ? 'RESUBMIT' : 'REQUEST'}_${type}`,
                actorId: actingUserId,
                reason: comment,
                before: current,
                after: resubmitOf ? { ...proposed, resubmitOf: resubmitOf.requestId } : proposed,
            }),
        });
    } catch (error) {
        if (evidence) await fileStore.remove(evidence.StorageKey);
        if (isConflict(error)) throw fail(409, 'There is already a pending request for this doctor.');
        throw error;
    }

    return { message: `${type === 'EDIT' ? 'Edit' : 'Delete'} request for Dr. ${doctor.DoctorName} sent to your manager${resubmitOf ? ' again' : ''}.` };
};

// =========================================================
// REQUESTS: fix and send again after a rejection
// =========================================================

// Why a rejected request can't be sent again (null when it can). Only the requester, once per rejection.
const resubmitBlocker = async (actingUserId, request) => {
    if (!sameId(request.RequestedBy, actingUserId)) return 'Only the person who raised the request can send it again.';
    if (request.Status !== 'REJECTED') return 'Only rejected requests can be sent again.';
    if (await DA.resubmissionOf(request.RequestId, request.DoctorId)) return 'This request was already sent again.';
    if (request.RequestType === 'CREATE' && (await DA.flagsForDoctor(request.DoctorId)).some((flag) => flag.Status === 'CONFIRMED')) {
        return 'Your manager confirmed this doctor already exists, so it cannot be sent again.';
    }
    return null;
};

// A rejected new doctor: same doctor record, corrected details, back to the manager.
const resubmitNewDoctor = async (actingUserId, request, payload, resubmitOf) => {
    const comment = text(payload.Comment, 1000, 'What you fixed', { required: true, min: MIN_COMMENT });
    const doctorId = request.DoctorId;
    const doctor = await DA.getDoctor(doctorId);
    if (!doctor || doctor.ApprovalStatus !== 'REJECTED') throw fail(409, 'This doctor can no longer be sent again.');

    const settings = await loadSettings();
    const { IsActive: _ignored, ...fields } = parseDoctorFields(payload.Changes || {});
    await validateArea(fields);

    const now = new Date();
    const warnings = [];
    let location = null;
    let evidence = null;
    if (payload.MoveClinic) {
        location = parseLocation(payload, 'New clinic location');
        const moved = distanceMeters(doctor.ClinicLatitude, doctor.ClinicLongitude, location.Latitude, location.Longitude);
        warnings.push({ reason: 'CLINIC_MOVED', detail: moved == null ? 'Clinic location set.' : `Clinic re-pinned ${moved} m from the first pin.` });
        if (location.Accuracy != null && location.Accuracy > WEAK_GPS_METERS) warnings.push({ reason: 'WEAK_GPS', detail: `Location accuracy was ${Math.round(location.Accuracy)} m.` });
    }

    const latitude = location ? location.Latitude : doctor.ClinicLatitude == null ? null : Number(doctor.ClinicLatitude);
    const longitude = location ? location.Longitude : doctor.ClinicLongitude == null ? null : Number(doctor.ClinicLongitude);
    const duplicates = await findDuplicates({ ...fields, Latitude: latitude, Longitude: longitude }, settings, doctorId);
    refuseRegistrationClash(duplicates);

    if (location && payload.PhotoId) evidence = await claimPhoto(actingUserId, payload.PhotoId, doctorId, 'SIGNBOARD', location, now);

    const previous = Object.fromEntries(EDITABLE.map((field) => [field, doctor[field] ?? null]));

    try {
        await DA.resubmitNewDoctor({
            doctor: {
                DoctorId: doctorId,
                ...fields,
                NormalizedName: normalizeName(fields.DoctorName),
                MoveClinic: location ? 1 : 0,
                Latitude: location?.Latitude ?? null,
                Longitude: location?.Longitude ?? null,
                Accuracy: location?.Accuracy ?? null,
                VerificationDueOn: addDays(todayKey(), settings.VERIFY_DAYS),
                Now: now,
            },
            evidence,
            request: {
                RequestId: generateUUID(),
                DoctorId: doctorId,
                RequestType: 'CREATE',
                RequestedBy: actingUserId,
                Comment: comment,
                CurrentData: JSON.stringify(previous),
                ProposedData: JSON.stringify(fields),
                FlagsSnapshot: JSON.stringify({ duplicates, warnings, resubmitOf }),
                ApproverId: await approverFor(actingUserId),
                Now: now,
            },
            flags: flagRows(doctorId, duplicates, now),
            audit: auditQuery({
                entityType: 'DOCTOR',
                entityId: doctorId,
                action: 'RESUBMIT_CREATE',
                actorId: actingUserId,
                reason: comment,
                before: previous,
                after: { ...fields, ...(location || {}), resubmitOf: resubmitOf.requestId },
            }),
        });
    } catch (error) {
        if (evidence) await fileStore.remove(evidence.StorageKey);
        if (isConflict(error)) throw fail(409, 'This doctor was already sent again.');
        throw error;
    }

    return {
        message: duplicates.length
            ? `Dr. ${fields.DoctorName} sent to your manager again, flagged as a possible duplicate of ${duplicates.length} doctor(s).`
            : `Dr. ${fields.DoctorName} sent to your manager again.`,
        DoctorId: doctorId,
        duplicates: duplicates.length,
    };
};

exports.resubmit = async (actingUserId, requestId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(requestId)) throw fail(400, 'Request is invalid.');

    const request = await DA.getRequest(requestId);
    if (!request || !sameId(request.RequestedBy, actingUserId)) throw fail(404, 'Request not found.');

    const blocker = await resubmitBlocker(actingUserId, request);
    if (blocker) throw fail(409, blocker);

    const resubmitOf = {
        requestId: String(request.RequestId).toUpperCase(),
        remarks: request.ReviewRemarks || null,
        reviewedBy: request.ReviewedByName || null,
        reviewedOn: request.ReviewedOn || null,
    };

    if (request.RequestType === 'CREATE') return resubmitNewDoctor(actingUserId, request, payload, resubmitOf);
    return exports.requestChange(actingUserId, request.DoctorId, { ...payload, RequestType: request.RequestType }, resubmitOf);
};

exports.cancelRequest = async (actingUserId, requestId) => {
    requireActingUser(actingUserId);
    if (!isGuid(requestId)) throw fail(400, 'Request is invalid.');

    const request = await DA.getRequest(requestId);
    if (!request || !sameId(request.RequestedBy, actingUserId)) throw fail(404, 'Request not found.');
    if (request.Status !== 'PENDING') throw fail(409, 'Only pending requests can be cancelled.');

    const now = new Date();
    try {
        await DA.cancelRequest(
            { RequestId: requestId, ActorId: actingUserId, Now: now },
            // A cancelled new-doctor request leaves no live doctor behind.
            request.RequestType === 'CREATE' ? { DoctorId: request.DoctorId, Now: now } : null,
            auditQuery({ entityType: 'DOCTOR_REQUEST', entityId: requestId, action: 'CANCEL', actorId: actingUserId })
        );
    } catch (error) {
        if (error.number === 50409 || /already decided/i.test(error.message)) throw fail(409, 'This request was already decided.');
        throw error;
    }

    return { message: 'Request cancelled.' };
};

// =========================================================
// REQUESTS: read
// =========================================================

const isAdmin = async (userId) => (await getPermissions(userId)).has('masters.edit');
// Can decide at all: the role must allow approving (same check as the approve / reject routes).
const canApprove = async (userId) => (await getPermissions(userId)).has('doctorrequests.approve');

const parseJson = (value) => {
    try {
        return value ? JSON.parse(value) : null;
    } catch {
        return null;
    }
};

exports.listRequests = async (actingUserId, query) => {
    const scope = await resolveScope(actingUserId, null);
    const status = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(String(query.status || '').toUpperCase()) ? String(query.status).toUpperCase() : null;
    const [admin, approver] = await Promise.all([isAdmin(actingUserId), canApprove(actingUserId)]);

    const rows = await DA.listRequests({ ...scope, Status: status, IsAdmin: admin ? 1 : 0 });

    return {
        requests: rows.map((row) => {
            const flags = parseJson(row.FlagsSnapshot) || {};
            return {
                ...row,
                FlagsSnapshot: undefined,
                duplicateCount: (flags.duplicates || []).length,
                warningCount: (flags.warnings || []).length,
                isResubmit: Boolean(flags.resubmitOf),
                isMine: sameId(row.RequestedBy, actingUserId),
                canReview: approver && row.Status === 'PENDING' && !sameId(row.RequestedBy, actingUserId) && (sameId(row.ApproverId, actingUserId) || (!row.ApproverId && admin)),
            };
        }),
    };
};

// Full request: current vs proposed, duplicates side by side (re-checked now), and photos.
exports.getRequest = async (actingUserId, requestId) => {
    requireActingUser(actingUserId);
    if (!isGuid(requestId)) throw fail(400, 'Request is invalid.');

    const request = await DA.getRequest(requestId);
    if (!request) throw fail(404, 'Request not found.');

    const scope = await resolveScope(actingUserId, null);
    if (!(await DA.canSeeDoctor({ ...scope, DoctorId: request.DoctorId }))) throw fail(403, 'You can only see requests from your team.');

    const [doctor, settings, admin, approver] = await Promise.all([DA.getDoctor(request.DoctorId), loadSettings(), isAdmin(actingUserId), canApprove(actingUserId)]);
    const proposed = parseJson(request.ProposedData);
    const snapshot = parseJson(request.FlagsSnapshot) || { duplicates: [], warnings: [] };

    // Re-run the duplicate check against today's data while the request is pending.
    let duplicates = snapshot.duplicates || [];
    if (request.Status === 'PENDING' && request.RequestType !== 'DELETE') {
        const subject = { ...doctor, ...(proposed || {}) };
        duplicates = await findDuplicates(
            { ...subject, Latitude: subject.ClinicLatitude == null ? null : Number(subject.ClinicLatitude), Longitude: subject.ClinicLongitude == null ? null : Number(subject.ClinicLongitude) },
            settings,
            request.DoctorId
        );
    }

    return {
        request: {
            RequestId: request.RequestId,
            RequestType: request.RequestType,
            Status: request.Status,
            Comment: request.Comment,
            CreatedOn: request.CreatedOn,
            RequestedByName: request.RequestedByName,
            ApproverName: request.ApproverName,
            ReviewedByName: request.ReviewedByName,
            ReviewedOn: request.ReviewedOn,
            ReviewRemarks: request.ReviewRemarks,
        },
        doctor: { ...publicDoctor(doctor), MobileNumber: doctor.MobileNumber, RegistrationNumber: doctor.RegistrationNumber, EmailId: doctor.EmailId, VisitsPerMonth: doctor.VisitsPerMonth, TerritoryId: doctor.TerritoryId, AreaId: doctor.AreaId, VerificationDueOn: doctor.VerificationDueOn, IsActive: doctor.IsActive },
        current: parseJson(request.CurrentData),
        proposed,
        duplicates,
        warnings: snapshot.warnings || [],
        flagged: duplicates.length > 0 || (snapshot.warnings || []).length > 0,
        previous: snapshot.resubmitOf || null,
        resubmittedAs: request.Status === 'REJECTED' ? (await DA.resubmissionOf(request.RequestId, request.DoctorId))?.RequestId || null : null,
        canResubmit: request.Status === 'REJECTED' && !(await resubmitBlocker(actingUserId, request)),
        // The manager can't decide yet: their role is missing "Doctor requests · Approve".
        approveBlocked: !approver && request.Status === 'PENDING' && sameId(request.RequesterManagerId, actingUserId),
        // The requester's current primary manager decides (admin when they have none).
        canReview: approver && request.Status === 'PENDING' && !sameId(request.RequestedBy, actingUserId) && (sameId(request.RequesterManagerId, actingUserId) || (!request.RequesterManagerId && admin)),
        canCancel: request.Status === 'PENDING' && sameId(request.RequestedBy, actingUserId),
    };
};

// =========================================================
// REQUESTS: decide
// =========================================================

const editStatement = (fields) => {
    const allowed = [...EDITABLE, 'ClinicLatitude', 'ClinicLongitude', 'ClinicGpsAccuracy'];
    const columns = Object.keys(fields).filter((field) => allowed.includes(field));
    const extra = columns.includes('DoctorName') ? ', NormalizedName = @NormalizedName' : '';
    const gps = columns.includes('ClinicLatitude') ? ', ClinicGpsCapturedAt = @Now' : '';
    return `UPDATE dbo.Doctor SET ${columns.map((column) => `${column} = @${column}`).join(', ')}${extra}${gps}, ModifiedOn = @Now WHERE DoctorId = @DoctorId`;
};

exports.decide = async (actingUserId, requestId, approve, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(requestId)) throw fail(400, 'Request is invalid.');

    const detail = await exports.getRequest(actingUserId, requestId);
    if (!detail.canReview) throw fail(403, 'Only the requester\'s reporting manager can decide this request.');

    const remarks = text(payload.Remarks, 1000, 'Remarks');
    if (!approve && (!remarks || remarks.length < MIN_COMMENT)) throw fail(400, `Give a reason to reject (at least ${MIN_COMMENT} characters).`);
    if (approve && detail.flagged && (!remarks || remarks.length < MIN_COMMENT)) {
        throw fail(400, `This request is flagged. Type why you are approving it (at least ${MIN_COMMENT} characters); it is saved in the audit log.`);
    }

    const { RequestType: type } = detail.request;
    const doctorId = detail.doctor.DoctorId;
    const now = new Date();
    const request = await DA.getRequest(requestId);
    const effects = [];

    if (approve && type === 'CREATE') {
        effects.push({ sqlQuery: DA.sql.APPROVE_NEW_DOCTOR(), inputs: { DoctorId: doctorId, Now: now } });
        effects.push({ sqlQuery: DA.sql.MAP_DOCTOR(), inputs: { MappingId: generateUUID(), UserId: request.RequestedBy, DoctorId: doctorId, Now: now } });
    } else if (approve && type === 'EDIT') {
        const fields = detail.proposed || {};
        effects.push({ sqlQuery: editStatement(fields), inputs: { ...fields, NormalizedName: fields.DoctorName ? normalizeName(fields.DoctorName) : null, DoctorId: doctorId, Now: now } });
    } else if (approve && type === 'DELETE') {
        effects.push({ sqlQuery: DA.sql.DEACTIVATE_DOCTOR(), inputs: { DoctorId: doctorId, Now: now } });
    } else if (!approve && type === 'CREATE') {
        effects.push({ sqlQuery: DA.sql.REJECT_NEW_DOCTOR(), inputs: { DoctorId: doctorId, Now: now } });
    }

    // Duplicate flags on a new doctor: approving means "not a duplicate"; rejecting as duplicate confirms them.
    if (type === 'CREATE' && (approve || payload.IsDuplicate)) {
        effects.push({ sqlQuery: DA.sql.RESOLVE_DOCTOR_FLAGS(), inputs: { DoctorId: doctorId, Status: approve ? 'DISMISSED' : 'CONFIRMED', ActorId: actingUserId, Note: remarks, Now: now } });
    }

    effects.push(
        auditQuery({
            entityType: 'DOCTOR_REQUEST',
            entityId: requestId,
            action: approve ? 'APPROVE' : 'REJECT',
            actorId: actingUserId,
            reason: remarks,
            before: { type, doctorId, current: detail.current, flagged: detail.flagged, duplicates: detail.duplicates.map((match) => ({ doctorId: match.doctor.DoctorId, name: match.doctor.DoctorName, reasons: match.reasons })) },
            after: approve ? detail.proposed : { rejectedAsDuplicate: Boolean(payload.IsDuplicate) },
        })
    );

    try {
        await DA.decide({ RequestId: requestId, Status: approve ? 'APPROVED' : 'REJECTED', ActorId: actingUserId, Remarks: remarks, Now: now }, effects);
    } catch (error) {
        if (error.number === 50409 || /already decided/i.test(error.message)) throw fail(409, 'This request was already decided. Refresh to see the result.');
        throw error;
    }

    const name = detail.doctor.DoctorName;
    const verb = type === 'CREATE' ? 'added' : type === 'EDIT' ? 'updated' : 'deactivated';
    return { message: approve ? `Dr. ${name} ${verb}.` : `Request for Dr. ${name} rejected.` };
};

// =========================================================
// FLAGS, OPTIONS, PHOTOS
// =========================================================

exports.listFlags = async (actingUserId, query) => {
    const scope = await resolveScope(actingUserId, null);
    const status = ['OPEN', 'DISMISSED', 'CONFIRMED'].includes(String(query.status || '').toUpperCase()) ? String(query.status).toUpperCase() : 'OPEN';
    const flags = await DA.listFlags({ ...scope, Status: status });

    const ids = [...new Set(flags.flatMap((flag) => [key(flag.DoctorId), key(flag.MatchDoctorId)]))];
    const doctors = new Map((await Promise.all(ids.map((id) => DA.getDoctor(id)))).filter(Boolean).map((doctor) => [key(doctor.DoctorId), publicDoctor(doctor)]));

    return {
        flags: flags.map((flag) => {
            const a = doctors.get(key(flag.DoctorId));
            const b = doctors.get(key(flag.MatchDoctorId));
            return { ...flag, Score: flag.Score == null ? null : Number(flag.Score), doctor: a, match: b, distanceM: flag.DistanceM ?? distanceMeters(a?.ClinicLatitude, a?.ClinicLongitude, b?.ClinicLatitude, b?.ClinicLongitude) };
        }),
    };
};

exports.resolveFlag = async (actingUserId, flagId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(flagId)) throw fail(400, 'Flag is invalid.');

    const status = String(payload.Status || '').toUpperCase();
    if (!['DISMISSED', 'CONFIRMED'].includes(status)) throw fail(400, 'Choose "not a duplicate" or "is a duplicate".');
    const note = text(payload.Note, 500, 'Note', { required: true, min: MIN_COMMENT });

    const flag = await DA.getFlag(flagId);
    if (!flag) throw fail(404, 'Flag not found.');

    const scope = await resolveScope(actingUserId, null);
    if (!(await DA.canSeeDoctor({ ...scope, DoctorId: flag.DoctorId }))) throw fail(403, 'This flag is outside your team.');

    const changed = await DA.resolveFlag(
        { FlagId: flagId, Status: status, ActorId: actingUserId, Note: note, Now: new Date() },
        auditQuery({ entityType: 'DUPLICATE_FLAG', entityId: flagId, action: status, actorId: actingUserId, reason: note, before: flag })
    );
    if (!changed) throw fail(409, 'This flag was already resolved.');

    return { message: status === 'CONFIRMED' ? 'Marked as a duplicate.' : 'Marked as not a duplicate.' };
};

exports.getOptions = async () => {
    const [areas, specialities] = await Promise.all([DA.getAreas(), DA.getSpecialities()]);
    const territories = [];
    areas.forEach((row) => {
        let territory = territories.find((item) => sameId(item.TerritoryId, row.TerritoryId));
        if (!territory) {
            territory = { TerritoryId: row.TerritoryId, TerritoryName: row.TerritoryName, areas: [] };
            territories.push(territory);
        }
        territory.areas.push({ AreaId: row.AreaId, AreaName: row.AreaName });
    });

    return { territories, specialities: specialities.map((row) => row.Speciality) };
};

exports.getPhoto = async (actingUserId, evidenceId) => {
    requireActingUser(actingUserId);
    if (!isGuid(evidenceId)) throw fail(400, 'Photo is invalid.');

    const evidence = await DA.getEvidence(evidenceId);
    if (!evidence) throw fail(404, 'Photo not found.');

    const scope = await resolveScope(actingUserId, null);
    if (!(await DA.canSeeDoctor({ ...scope, DoctorId: evidence.DoctorId }))) throw fail(403, 'You cannot see this photo.');

    return { buffer: await fileStore.get(evidence.StorageKey), contentType: evidence.ContentType, capturedAt: evidence.CapturedAt };
};

