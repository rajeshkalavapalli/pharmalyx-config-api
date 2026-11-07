const { runInTransaction, customQuery } = require('../../utils/dbFunctions');
const { canViewUser, fail, isGuid, requireActingUser, sameId } = require('../../utils/access');
const { auditQuery } = require('../../utils/audit');
const { notifyLater } = require('../../utils/push');

// When a rep leaves (or a territory changes hands): move their doctors to another person in one step.
// The doctors' history (visits, samples, RCPA, business) stays with the company and shows to the new rep.

const PREVIEW = `
    SELECT COUNT(*) AS Doctors, COUNT(t.DoctorId) AS AlreadyWithNew
    FROM dbo.UserDoctorMapping m
    LEFT JOIN dbo.UserDoctorMapping t ON t.UserId = @ToUserId AND t.DoctorId = m.DoctorId AND ISNULL(t.IsActive, 'Yes') <> 'No'
    WHERE m.UserId = @FromUserId AND ISNULL(m.IsActive, 'Yes') <> 'No'`;

// New rep gets every active doctor of the old rep they don't have yet; the old rep's links are closed.
const MOVE = `
    UPDATE t SET IsActive = 'Yes', ModifiedOn = @Now
    FROM dbo.UserDoctorMapping t
    WHERE t.UserId = @ToUserId AND ISNULL(t.IsActive, 'Yes') = 'No'
      AND t.DoctorId IN (SELECT m.DoctorId FROM dbo.UserDoctorMapping m WHERE m.UserId = @FromUserId AND ISNULL(m.IsActive, 'Yes') <> 'No');

    INSERT INTO dbo.UserDoctorMapping (UserDoctorMappingId, UserId, DoctorId, IsActive, CreatedOn, ModifiedOn)
    SELECT NEWID(), @ToUserId, m.DoctorId, 'Yes', @Now, @Now
    FROM dbo.UserDoctorMapping m
    WHERE m.UserId = @FromUserId AND ISNULL(m.IsActive, 'Yes') <> 'No'
      AND NOT EXISTS (SELECT 1 FROM dbo.UserDoctorMapping t WHERE t.UserId = @ToUserId AND t.DoctorId = m.DoctorId);

    UPDATE dbo.UserDoctorMapping SET IsActive = 'No', ModifiedOn = @Now
    WHERE UserId = @FromUserId AND ISNULL(IsActive, 'Yes') <> 'No';`;

const USER = `SELECT UserId, COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(FirstName, ' ', LastName))), ''), UserName) AS Name, IsActive FROM Users WHERE UserId = @UserId`;

const check = async (actingUserId, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(payload.FromUserId) || !isGuid(payload.ToUserId)) throw fail(400, 'Choose who is leaving and who takes over.');
    if (sameId(payload.FromUserId, payload.ToUserId)) throw fail(400, 'Choose two different people.');
    for (const id of [payload.FromUserId, payload.ToUserId]) {
        if (!(await canViewUser(actingUserId, id))) throw fail(403, 'You can only hand over doctors inside your team.');
    }
    const [[from], [to]] = await Promise.all([customQuery(USER, { UserId: payload.FromUserId }), customQuery(USER, { UserId: payload.ToUserId })]);
    if (!from || !to) throw fail(404, 'Person not found.');
    if (to.IsActive === false || to.IsActive === 0) throw fail(400, `${to.Name} is not active.`);
    return { from, to };
};

exports.preview = async (actingUserId, payload) => {
    const { from, to } = await check(actingUserId, payload);
    const [row] = await customQuery(PREVIEW, { FromUserId: payload.FromUserId, ToUserId: payload.ToUserId });
    return { from: from.Name, to: to.Name, doctors: Number(row?.Doctors) || 0, alreadyWithNew: Number(row?.AlreadyWithNew) || 0 };
};

exports.handover = async (actingUserId, payload) => {
    const { from, to } = await check(actingUserId, payload);
    const [row] = await customQuery(PREVIEW, { FromUserId: payload.FromUserId, ToUserId: payload.ToUserId });
    const doctors = Number(row?.Doctors) || 0;
    if (!doctors) throw fail(409, `${from.Name} has no doctors to hand over.`);
    await runInTransaction([
        { sqlQuery: MOVE, inputs: { FromUserId: payload.FromUserId, ToUserId: payload.ToUserId, Now: new Date() } },
        auditQuery({ entityType: 'USER', entityId: payload.FromUserId, action: 'DOCTORS_HANDOVER', actorId: actingUserId, after: { to: payload.ToUserId, doctors } }),
    ]);
    notifyLater([payload.ToUserId], { title: 'New doctors assigned', body: `${doctors} doctor(s) from ${from.Name} are now yours, with their visit history.`, data: { screen: 'Doctors' } });
    return { message: `${doctors} doctor(s) moved from ${from.Name} to ${to.Name}. Their visits, samples and prescriptions stay with each doctor.` };
};
