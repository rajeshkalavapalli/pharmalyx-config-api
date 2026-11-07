const DA = require('./TourPlanDA');
const { generateUUID } = require('../../utils/commonUtils');
const { fail, sameId } = require('../../utils/access');

// Joint work in the tour plan. A senior (ASM, RSM ...) plans a day as "joint work with <team member>":
//   - no acceptance: in the hierarchy the team member works with their senior that day;
//   - but a senior can't take a team member's off day, Sunday or leave (pending or approved);
//   - the day's area is the team member's planned area for that date;
//   - once the senior's plan is saved (not a draft) the day is confirmed and locked in the team
//     member's plan: only the senior changes it.

const lower = (value) => String(value ?? '').toLowerCase();
const isSunday = (key) => new Date(`${key}T00:00:00Z`).getUTCDay() === 0;
const monthEnd = (monthStart) => {
    const [y, m] = monthStart.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const notSetUp = () => fail(503, 'Joint work in the tour plan is not set up yet. Please tell your administrator.');

/**
 * Checks the senior's joint work days and fills each one's area from the team member's plan.
 * Changes `details` in place. Returns [{ UserId, WorkDate }] for the joint days.
 */
exports.prepare = async (seniorId, monthStart, details) => {
    const joint = details.filter((detail) => detail.JointWithUserId);
    if (!joint.length) return [];
    if (!(await DA.hasJointColumn())) throw notSetUp();

    const from = monthStart;
    const to = monthEnd(monthStart);
    const members = new Map();
    for (const id of new Set(joint.map((detail) => lower(detail.JointWithUserId)))) {
        if (sameId(id, seniorId)) throw fail(400, 'Joint work is planned with a team member, not yourself.');
        if (!(await DA.isInTeam(id, seniorId))) throw fail(400, 'Joint work in your plan is with your own team members.');
        const [owner, days, leave] = await Promise.all([DA.getOwner(id), DA.memberDays(id, monthStart), DA.memberLeave(id, from, to)]);
        members.set(id, { name: owner?.Name || 'This team member', days: new Map(days.map((day) => [day.PlanDate, day])), leave });
    }

    for (const detail of joint) {
        const member = members.get(lower(detail.JointWithUserId));
        const date = detail.PlanDate;
        const onLeave = member.leave.find((leave) => leave.FromDate <= date && date <= leave.ToDate);
        if (onLeave) throw fail(409, `${member.name} has ${onLeave.Status === 'APPROVED' ? 'approved' : 'applied'} leave on ${date}. Choose another day or team member.`);
        const day = member.days.get(date);
        if (day && day.DayType !== 'working') throw fail(409, `${member.name} has ${date} as an off day. Choose another day or team member.`);
        if (!day && isSunday(date)) throw fail(409, `${date} is a Sunday, a holiday for ${member.name}. Choose another day.`);
        // The area comes from the team member's plan (empty until they plan that day).
        detail.TerritoryId = day?.TerritoryId || null;
        detail.AreaId = day?.AreaId || null;
    }

    return joint.map((detail) => ({ UserId: detail.JointWithUserId, WorkDate: detail.PlanDate }));
};

// Days a senior planned with this person can't be made off days or moved to another area by them.
exports.assertLocks = async (userId, monthStart, details, previous = []) => {
    if (!(await DA.hasJointColumn())) return;
    const locks = await DA.locks(userId, monthStart, monthEnd(monthStart));
    if (!locks.length) return;

    const next = new Map(details.map((detail) => [detail.PlanDate, detail]));
    const before = new Map(previous.map((detail) => [String(detail.PlanDate).slice(0, 10), detail]));
    for (const lock of locks) {
        const day = next.get(lock.PlanDate);
        if (!day) continue; // a draft may leave days empty; submitting needs every date anyway
        const message = `${lock.PlanDate}: ${lock.ColleagueName} planned joint work with you. Ask them to change this day.`;
        if (day.DayType !== 'working') throw fail(409, message);
        const old = before.get(lock.PlanDate);
        if (old && old.DayType === 'working' && old.AreaId && !sameId(old.AreaId, day.AreaId)) throw fail(409, message);
    }
};

// After the senior's plan is saved (not as a draft): their joint days for the month become exactly the planned ones.
exports.sync = async (seniorId, monthStart, jointDays) => {
    if (!(await DA.hasJointColumn())) return;
    await DA.syncPlanJointDays({ ColleagueUserId: seniorId, From: monthStart, To: monthEnd(monthStart), days: jointDays, Now: new Date(), newId: generateUUID });
};

// Locks for showing in the person's plan: { 'YYYY-MM-DD': colleague name }.
exports.locksFor = async (userId, monthStart) => {
    if (!(await DA.hasJointColumn())) return {};
    try {
        const rows = await DA.locks(userId, monthStart, monthEnd(monthStart));
        return Object.fromEntries(rows.map((row) => [row.PlanDate, row.ColleagueName]));
    } catch {
        return {};
    }
};
