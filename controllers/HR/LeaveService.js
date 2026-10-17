const HRDA = require('./HRDA');

const { generateUUID } = require('../../utils/commonUtils');
const { resolveScope } = require('../../utils/reportScope');
const { fail, isGuid, optionalText, requireActingUser, sameId, toDateKey, todayKey } = require('../../utils/access');

const MAX_BACKDATE_DAYS = 30;
const MAX_AHEAD_DAYS = 365;

const addDays = (key, days) => {
    const date = new Date(`${key}T00:00:00`);
    date.setDate(date.getDate() + days);
    return todayKey(date);
};

// Working days in the range (Sundays excluded).
const workingDays = (from, to) => {
    let count = 0;
    for (let day = from; day <= to; day = addDays(day, 1)) {
        if (new Date(`${day}T00:00:00`).getDay() !== 0) count += 1;
    }
    return count;
};

const balancesFor = async (userId, year) => {
    const [types, used] = await Promise.all([HRDA.getLeaveTypes(true), HRDA.getLeaveUsed({ UserId: userId, Year: year })]);
    const usedById = new Map(used.map((row) => [String(row.LeaveTypeId).toLowerCase(), row]));

    return types.map((type) => {
        const row = usedById.get(String(type.LeaveTypeId).toLowerCase());
        const approved = Number(row?.Approved || 0);
        const pending = Number(row?.Pending || 0);
        const quota = Number(type.AnnualQuota);

        return {
            ...type,
            AnnualQuota: quota,
            approved,
            pending,
            available: type.IsPaid ? Math.max(0, quota - approved - pending) : null,
        };
    });
};

// =========================================================
// READS
// =========================================================

exports.getLeave = async (actingUserId, query) => {
    const scope = await resolveScope(actingUserId, query.userId);
    const year = Number(query.year) || new Date().getFullYear();
    if (year < 2000 || year > 2100) throw fail(400, 'Year is invalid.');

    const [requests, balances] = await Promise.all([HRDA.listLeaves({ ...scope, Year: year }), balancesFor(scope.UserId || actingUserId, year)]);

    return {
        year,
        balances,
        requests: requests.map((row) => ({
            ...row,
            Days: Number(row.Days),
            isOwn: sameId(row.UserId, actingUserId),
            canReview: row.Status === 'PENDING' && sameId(row.ManagerId, actingUserId) && !sameId(row.UserId, actingUserId),
            canCancel: sameId(row.UserId, actingUserId) && (row.Status === 'PENDING' || (row.Status === 'APPROVED' && row.FromDate > todayKey())),
        })),
    };
};

exports.getTypes = async () => ({ types: await HRDA.getLeaveTypes(false) });

// =========================================================
// APPLY / CANCEL / REVIEW
// =========================================================

exports.apply = async (actingUserId, payload) => {
    requireActingUser(actingUserId);

    if (!isGuid(payload.LeaveTypeId)) throw fail(400, 'Choose a leave type.');
    const types = await HRDA.getLeaveTypes(true);
    const type = types.find((item) => sameId(item.LeaveTypeId, payload.LeaveTypeId));
    if (!type) throw fail(400, 'This leave type is not available.');

    const from = toDateKey(payload.FromDate, 'From date');
    const to = toDateKey(payload.ToDate || payload.FromDate, 'To date');
    const today = todayKey();

    if (to < from) throw fail(400, 'To date must be on or after the From date.');
    if (from < addDays(today, -MAX_BACKDATE_DAYS)) throw fail(400, `Leave older than ${MAX_BACKDATE_DAYS} days can't be applied for.`);
    if (to > addDays(today, MAX_AHEAD_DAYS)) throw fail(400, 'Leave can be applied up to a year ahead.');
    if (from.slice(0, 4) !== to.slice(0, 4)) throw fail(400, 'Split leave across the new year into two requests.');

    const halfDay = Boolean(payload.HalfDay);
    if (halfDay && from !== to) throw fail(400, 'A half day must be a single date.');
    if (halfDay && !type.AllowHalfDay) throw fail(400, `${type.Name} can't be taken as a half day.`);

    const working = workingDays(from, to);
    if (!working) throw fail(400, 'The selected dates are all Sundays.');
    const days = halfDay ? 0.5 : working;

    const reason = optionalText(payload.Reason, 500, 'Reason');
    if (!reason) throw fail(400, 'Give a reason for the leave.');

    const overlap = await HRDA.findOverlap({ UserId: actingUserId, FromDate: from, ToDate: to });
    if (overlap) throw fail(409, `You already have ${overlap.Status.toLowerCase()} leave from ${overlap.FromDate} to ${overlap.ToDate}.`);

    if (type.IsPaid) {
        const balance = (await balancesFor(actingUserId, Number(from.slice(0, 4)))).find((item) => sameId(item.LeaveTypeId, type.LeaveTypeId));
        if (days > balance.available) throw fail(400, `Only ${balance.available} day(s) of ${type.Name} left for ${from.slice(0, 4)}.`);
    }

    await HRDA.createLeave({ LeaveId: generateUUID(), UserId: actingUserId, LeaveTypeId: type.LeaveTypeId, FromDate: from, ToDate: to, HalfDay: halfDay ? 1 : 0, Days: days, Reason: reason, Now: new Date() });

    return { message: `${type.Name} for ${days} day(s) sent to your manager.` };
};

exports.cancel = async (actingUserId, leaveId) => {
    requireActingUser(actingUserId);
    if (!isGuid(leaveId)) throw fail(400, 'Leave is invalid.');

    const leave = await HRDA.getLeave({ LeaveId: leaveId });
    if (!leave || !sameId(leave.UserId, actingUserId)) throw fail(404, 'Leave not found.');

    const cancellable = leave.Status === 'PENDING' || (leave.Status === 'APPROVED' && leave.FromDate > todayKey());
    if (!cancellable) throw fail(409, 'Only pending leave, or approved leave that has not started, can be cancelled.');

    const changed = await HRDA.setLeaveStatus({ LeaveId: leaveId, FromStatus: leave.Status, Status: 'CANCELLED', ReviewedBy: actingUserId, Remarks: 'Cancelled by the employee', Now: new Date() });
    if (!changed) throw fail(409, 'This leave was updated meanwhile. Refresh and try again.');

    return { message: 'Leave cancelled.' };
};

// Only the reporting manager decides. Used by the Leave page and the Approvals inbox.
exports.review = async (actingUserId, leaveId, approve, remarks) => {
    requireActingUser(actingUserId);
    if (!isGuid(leaveId)) throw fail(400, 'Leave is invalid.');

    const leave = await HRDA.getLeave({ LeaveId: leaveId });
    if (!leave) throw fail(404, 'Leave not found.');
    if (sameId(leave.UserId, actingUserId) || !sameId(leave.ManagerId, actingUserId)) throw fail(403, 'Only the reporting manager can approve or reject this leave.');
    if (leave.Status !== 'PENDING') throw fail(409, 'This leave has already been decided.');

    const note = optionalText(remarks, 500, 'Remarks');
    if (!approve && !note) throw fail(400, 'Give a reason to reject.');

    const changed = await HRDA.setLeaveStatus({ LeaveId: leaveId, FromStatus: 'PENDING', Status: approve ? 'APPROVED' : 'REJECTED', ReviewedBy: actingUserId, Remarks: note, Now: new Date() });
    if (!changed) throw fail(409, 'This leave was updated meanwhile. Refresh and try again.');

    return { message: `${leave.UserName}'s leave ${approve ? 'approved' : 'rejected'}.` };
};

// =========================================================
// ADMIN: leave types
// =========================================================

exports.saveType = async (actingUserId, leaveTypeId, payload) => {
    requireActingUser(actingUserId);
    if (leaveTypeId && !isGuid(leaveTypeId)) throw fail(400, 'Leave type is invalid.');

    const code = String(payload.Code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{1,10}$/.test(code)) throw fail(400, 'Code must be 1–10 letters or digits.');
    const name = optionalText(payload.Name, 60, 'Name');
    if (!name) throw fail(400, 'Name is required.');

    const quota = Number(payload.AnnualQuota ?? 0);
    if (!Number.isFinite(quota) || quota < 0 || quota > 365 || Math.round(quota * 2) !== quota * 2) throw fail(400, 'Yearly quota must be 0–365, in half days.');

    if (await HRDA.findLeaveTypeCode({ Code: code, LeaveTypeId: leaveTypeId || null })) throw fail(409, `Code ${code} is already used.`);

    const inputs = {
        LeaveTypeId: leaveTypeId || generateUUID(),
        Code: code,
        Name: name,
        AnnualQuota: quota,
        AllowHalfDay: payload.AllowHalfDay ? 1 : 0,
        IsPaid: payload.IsPaid === false ? 0 : 1,
        IsActive: payload.IsActive === false ? 0 : 1,
        ModifiedBy: actingUserId,
        Now: new Date(),
    };

    await (leaveTypeId ? HRDA.updateLeaveType(inputs) : HRDA.createLeaveType(inputs));

    return { message: `${name} saved.` };
};

