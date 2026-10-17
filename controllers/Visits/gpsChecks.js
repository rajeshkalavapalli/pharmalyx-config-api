const { customQuery } = require('../../utils/dbFunctions');
const { generateUUID } = require('../../utils/commonUtils');
const { boundingBox, distanceMeters } = require('../../utils/doctorMatching');

// GPS checks for a visit being logged. Flag only: the visit is always saved; flags go to the
// manager via Risk & alerts. Every rule gives honest MRs the benefit of the doubt:
//   * Geofence      GPS accuracy (up to 100 m) is subtracted before comparing with the limit.
//   * Same spot     doctors whose saved clinics are close (a hospital, a polyclinic) never count.
//   * Travel        short hops (< 1 km) are ignored; speed uses device GPS times.

const DEFAULTS = { GEOFENCE_METERS: 200, CLUSTER_METERS: 50, MAX_TRAVEL_KMH: 80 };
const SAME_SPOT_DAYS = 30;
const SAME_SPOT_MIN_DOCTORS = 2; // other doctors (so 3 clinics) from one spot
const TRAVEL_WINDOW_HOURS = 12;
const MIN_TRAVEL_METERS = 1000;

const SETTINGS = `SELECT SettingKey, SettingValue FROM dbo.AntiFraudSettings`;

// This MR's other GPS visits near this spot (last 30 days), with each doctor's saved clinic.
const NEARBY_VISITS = `
    SELECT v.DoctorId, d.DoctorName, d.AreaId, d.ClinicLatitude, d.ClinicLongitude, v.Latitude, v.Longitude,
           CONVERT(VARCHAR(10), v.VisitDate, 23) AS VisitDate
    FROM dbo.Visits v
    INNER JOIN dbo.Doctor d ON d.DoctorId = v.DoctorId
    WHERE v.UserId = @UserId AND v.DoctorId <> @DoctorId AND v.LocationStatus = 'CAPTURED'
      AND v.VisitDate >= @Since
      AND v.Latitude BETWEEN @MinLat AND @MaxLat AND v.Longitude BETWEEN @MinLng AND @MaxLng
`;

// The MR's GPS check-ins just before and just after this one (device GPS time).
const NEIGHBOUR_VISITS = `
    SELECT * FROM (
        SELECT TOP 1 'BEFORE' AS Side, v.VisitId, d.DoctorName, v.Latitude, v.Longitude, COALESCE(v.LocationCapturedAt, v.RecordedAt) AS At
        FROM dbo.Visits v INNER JOIN dbo.Doctor d ON d.DoctorId = v.DoctorId
        WHERE v.UserId = @UserId AND v.LocationStatus = 'CAPTURED'
          AND COALESCE(v.LocationCapturedAt, v.RecordedAt) BETWEEN DATEADD(HOUR, -${TRAVEL_WINDOW_HOURS}, @At) AND @At
        ORDER BY COALESCE(v.LocationCapturedAt, v.RecordedAt) DESC
    ) b
    UNION ALL
    SELECT * FROM (
        SELECT TOP 1 'AFTER' AS Side, v.VisitId, d.DoctorName, v.Latitude, v.Longitude, COALESCE(v.LocationCapturedAt, v.RecordedAt) AS At
        FROM dbo.Visits v INNER JOIN dbo.Doctor d ON d.DoctorId = v.DoctorId
        WHERE v.UserId = @UserId AND v.LocationStatus = 'CAPTURED'
          AND COALESCE(v.LocationCapturedAt, v.RecordedAt) > @At
          AND COALESCE(v.LocationCapturedAt, v.RecordedAt) <= DATEADD(HOUR, ${TRAVEL_WINDOW_HOURS}, @At)
        ORDER BY COALESCE(v.LocationCapturedAt, v.RecordedAt)
    ) a
`;

const INSERT_FLAG = `
    INSERT INTO dbo.FraudFlags (FlagId, FlagType, Severity, UserId, DoctorId, VisitId, Details, Data, Status, CreatedOn)
    VALUES (@FlagId, @FlagType, @Severity, @UserId, @DoctorId, @VisitId, @Details, @Data, 'OPEN', @Now)
`;

const loadSettings = async () => {
    try {
        const rows = await customQuery(SETTINGS);
        return { ...DEFAULTS, ...Object.fromEntries(rows.map((row) => [row.SettingKey, Number(row.SettingValue)])) };
    } catch {
        return DEFAULTS;
    }
};

const metres = (value) => (value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`);

// Pure rule for the geofence, used by the service and by tests.
const geofence = ({ clinic, location, limit }) => {
    if (clinic?.latitude == null || clinic?.longitude == null) return { status: 'NO_CLINIC_GPS', distance: null };
    if (location.LocationStatus !== 'CAPTURED') return { status: 'NO_GPS', distance: null };

    const distance = distanceMeters(location.Latitude, location.Longitude, Number(clinic.latitude), Number(clinic.longitude));
    const slack = Math.min(Number(location.LocationAccuracy) || 0, 100);

    return { status: distance - slack > limit ? 'OUTSIDE' : 'INSIDE', distance };
};

// Runs every check; returns the visit's GPS columns and the FraudFlags rows (as transaction steps).
const checkVisit = async ({ userId, visitId, doctor, location, isMock, reason, now = new Date() }) => {
    const settings = await loadSettings();
    const flags = [];
    const flag = (type, severity, details, data) =>
        flags.push({
            FlagId: generateUUID(),
            FlagType: type,
            Severity: severity,
            UserId: userId,
            DoctorId: doctor.DoctorId,
            VisitId: visitId,
            Details: details.slice(0, 500),
            Data: JSON.stringify(data),
            Now: now,
        });

    // 1. Geofence: was the MR at the clinic?
    const fence = geofence({ clinic: { latitude: doctor.ClinicLatitude, longitude: doctor.ClinicLongitude }, location, limit: settings.GEOFENCE_METERS });
    if (fence.status === 'OUTSIDE') {
        flag(
            'OUTSIDE_GEOFENCE',
            fence.distance > 2000 ? 'HIGH' : 'MEDIUM',
            `Checked in ${metres(fence.distance)} from Dr. ${doctor.DoctorName}'s clinic (limit ${settings.GEOFENCE_METERS} m)${reason ? `. MR's reason: ${reason}` : ''}.`,
            { distance: fence.distance, accuracy: location.LocationAccuracy, limit: settings.GEOFENCE_METERS, reason }
        );
    } else if (fence.status === 'NO_GPS' && doctor.ClinicLatitude != null) {
        flag('NO_GPS', 'LOW', `Visit to Dr. ${doctor.DoctorName} logged without GPS (${String(location.LocationStatus).toLowerCase().replace('_', ' ')}).`, { status: location.LocationStatus });
    }

    // 2. Mock / fake GPS reported by the device (the Android app will send this).
    if (isMock) flag('MOCK_GPS', 'HIGH', `The phone reported a fake (mock) GPS location for the visit to Dr. ${doctor.DoctorName}.`, {});

    if (location.LocationStatus === 'CAPTURED') {
        // 3. Same spot: several different clinics "visited" from one place.
        const since = new Date(now);
        since.setDate(since.getDate() - SAME_SPOT_DAYS);
        const nearby = await customQuery(NEARBY_VISITS, {
            UserId: userId,
            DoctorId: doctor.DoctorId,
            Since: since,
            ...boundingBox(location.Latitude, location.Longitude, settings.CLUSTER_METERS),
        });

        const others = new Map();
        nearby.forEach((row) => {
            const spot = distanceMeters(location.Latitude, location.Longitude, Number(row.Latitude), Number(row.Longitude));
            if (spot == null || spot > settings.CLUSTER_METERS) return;

            const clinicGap = distanceMeters(doctor.ClinicLatitude, doctor.ClinicLongitude, row.ClinicLatitude, row.ClinicLongitude);
            const differentClinic = clinicGap != null ? clinicGap > settings.GEOFENCE_METERS * 2 : String(row.AreaId || '').toLowerCase() !== String(doctor.AreaId || '').toLowerCase();
            if (differentClinic) others.set(String(row.DoctorId).toLowerCase(), row);
        });

        if (others.size >= SAME_SPOT_MIN_DOCTORS) {
            const names = [...others.values()].map((row) => `Dr. ${row.DoctorName}`);
            flag(
                'SAME_SPOT',
                others.size >= 4 ? 'HIGH' : 'MEDIUM',
                `Visits to ${others.size + 1} doctors with different clinics were checked in from the same spot (within ${settings.CLUSTER_METERS} m): Dr. ${doctor.DoctorName}, ${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''}.`,
                { doctors: [...others.values()].map((row) => ({ doctorId: row.DoctorId, visitDate: row.VisitDate })) }
            );
        }

        // 4. Impossible travel between this check-in and the one before / after.
        const at = location.LocationCapturedAt || now;
        const neighbours = await customQuery(NEIGHBOUR_VISITS, { UserId: userId, At: at });
        neighbours.forEach((row) => {
            const distance = distanceMeters(location.Latitude, location.Longitude, Number(row.Latitude), Number(row.Longitude));
            if (distance == null || distance < MIN_TRAVEL_METERS) return;

            const hours = Math.abs(new Date(at) - new Date(row.At)) / 3600000;
            const speed = hours > 0 ? distance / 1000 / hours : Infinity;
            if (speed <= settings.MAX_TRAVEL_KMH) return;

            const minutes = Math.round(hours * 60);
            flag(
                'IMPOSSIBLE_TRAVEL',
                speed > settings.MAX_TRAVEL_KMH * 2 ? 'HIGH' : 'MEDIUM',
                `${metres(distance)} ${row.Side === 'BEFORE' ? 'from the previous' : 'to the next'} check-in (Dr. ${row.DoctorName}) in ${minutes} min, about ${Number.isFinite(speed) ? Math.round(speed) : '∞'} km/h (limit ${settings.MAX_TRAVEL_KMH} km/h).`,
                { otherVisitId: row.VisitId, distance, minutes, speed: Number.isFinite(speed) ? Math.round(speed) : null }
            );
        });
    }

    return {
        columns: {
            DistanceFromClinicM: fence.distance,
            GeofenceStatus: fence.status,
            GeofenceReason: fence.status === 'OUTSIDE' ? reason || null : null,
            IsMockLocation: isMock ? 1 : null,
        },
        flags,
        flagQueries: flags.map((inputs) => ({ sqlQuery: INSERT_FLAG, inputs })),
        geofenceLimit: settings.GEOFENCE_METERS,
    };
};

module.exports = { checkVisit, geofence };
