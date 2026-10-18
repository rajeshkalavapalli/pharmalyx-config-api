// Standard Tour Plan: patches (HQ / Ex-HQ / Outstation) and which patch is worked on each weekday.
// Prepared by the MR and their manager, approved by head office. The monthly tour plan is generated from it.

const sql = require('./stpSql');
const DA = require('./VerifiedWorkDA');
const rules = require('./rules');

const TourPlanDA = require('../TourPlan/TourPlanDA');
const TourPlanService = require('../TourPlan/TourPlanServer');

const { customQuery, runInTransaction } = require('../../utils/dbFunctions');
const { generateUUID } = require('../../utils/commonUtils');
const { auditQuery } = require('../../utils/audit');
const { getPermissions } = require('../../utils/permissions');
const { fail, isGuid, optionalText, requireActingUser, sameId, toMonthStart } = require('../../utils/access');

const PATCH_TYPES = ['HQ', 'EX_HQ', 'OUTSTATION'];
const first = async (promise) => (await promise)[0] || null;
const conflict = (error) => (error.number === 50409 ? fail(409, error.message) : error);
const lower = (value) => String(value || '').toLowerCase();

// The MR themselves or their reporting manager may prepare the STP; head office may see any.
const assertCanEdit = async (actingUserId, userId) => {
    if (sameId(actingUserId, userId)) return;
    const target = await DA.getUser(userId);
    if (!target) throw fail(404, 'User not found.');
    if (!sameId(target.ManagerId, actingUserId)) throw fail(403, 'Only the MR or their reporting manager can prepare this plan.');
};

const assertCanView = async (actingUserId, userId) => {
    if (sameId(actingUserId, userId)) return;
    const permissions = await getPermissions(actingUserId);
    if (permissions.has('stp.approve')) return;
    await assertCanEdit(actingUserId, userId);
};

const loadStp = async (stp) => {
    if (!stp) return null;
    const [patches, days] = await Promise.all([customQuery(sql.GET_PATCHES(), { StpId: stp.StpId }), customQuery(sql.GET_DAYS(), { StpId: stp.StpId })]);
    return { ...stp, patches, days: days.map((day) => ({ ...day, overnight: false })) };
};

// Outstation patch on consecutive days = an overnight stay.
const markOvernights = (stp) => {
    if (!stp) return stp;
    const type = new Map(stp.patches.map((patch) => [lower(patch.AreaId), patch.PatchType]));
    const slot = new Map(stp.days.map((day) => [`${day.CycleWeek}:${day.Weekday}`, day]));
    stp.days.forEach((day) => {
        const next = slot.get(`${day.CycleWeek}:${day.Weekday + 1}`);
        day.overnight = Boolean(day.AreaId && type.get(lower(day.AreaId)) === 'OUTSTATION' && next && sameId(next.AreaId, day.AreaId));
    });
    return stp;
};

exports.getStp = async (actingUserId, query) => {
    requireActingUser(actingUserId);
    const userId = query.userId || actingUserId;
    if (!isGuid(userId)) throw fail(400, 'User is invalid.');
    await assertCanView(actingUserId, userId);

    const [rows, areas, user, team] = await Promise.all([
        customQuery(sql.GET_STPS(), { UserId: userId }),
        DA.territoryAreas(userId),
        DA.getUser(userId),
        customQuery(sql.DIRECT_REPORTS(), { UserId: actingUserId }),
    ]);
    const open = rows.find((row) => row.Status !== 'APPROVED') || null;
    const approved = rows.find((row) => row.Status === 'APPROVED') || null;
    const canEdit = sameId(actingUserId, userId) || sameId(user?.ManagerId, actingUserId);

    return {
        user: user ? { UserId: user.UserId, Name: user.Name } : null,
        team,
        open: markOvernights(await loadStp(open)),
        approved: markOvernights(await loadStp(approved)),
        areas,
        patchTypes: PATCH_TYPES,
        canEdit: canEdit && (!open || ['DRAFT', 'RETURNED'].includes(open.Status)),
        canApprove: (await getPermissions(actingUserId)).has('stp.approve') && open?.Status === 'SUBMITTED',
    };
};

// Save the draft (creates one, copying nothing, if there is no open plan).
exports.saveStp = async (actingUserId, payload) => {
    requireActingUser(actingUserId);
    const userId = payload.UserId || actingUserId;
    if (!isGuid(userId)) throw fail(400, 'User is invalid.');
    await assertCanEdit(actingUserId, userId);

    const cycleWeeks = Number(payload.CycleWeeks || 4);
    if (!Number.isInteger(cycleWeeks) || cycleWeeks < 1 || cycleWeeks > 4) throw fail(400, 'Cycle must be 1 to 4 weeks.');

    // Patches must be areas of the MR's own territory.
    const allowed = new Set((await DA.territoryAreas(userId)).map((area) => lower(area.AreaId)));
    const patches = (Array.isArray(payload.Patches) ? payload.Patches : []).map((patch) => {
        const type = String(patch.PatchType || '').toUpperCase();
        if (!isGuid(patch.AreaId) || !allowed.has(lower(patch.AreaId))) throw fail(400, 'A patch is not an area of this territory.');
        if (!PATCH_TYPES.includes(type)) throw fail(400, 'Patch type must be HQ, Ex-HQ or Outstation.');
        return { AreaId: patch.AreaId, PatchType: type };
    });
    if (new Set(patches.map((p) => lower(p.AreaId))).size !== patches.length) throw fail(400, 'Each area can be a patch only once.');
    const patchIds = new Set(patches.map((p) => lower(p.AreaId)));

    const seen = new Set();
    const days = (Array.isArray(payload.Days) ? payload.Days : []).map((day) => {
        const week = Number(day.CycleWeek);
        const weekday = Number(day.Weekday);
        if (!Number.isInteger(week) || week < 1 || week > cycleWeeks || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw fail(400, 'A day is outside the cycle.');
        const key = `${week}:${weekday}`;
        if (seen.has(key)) throw fail(400, 'Each weekday can have only one patch.');
        seen.add(key);
        if (day.AreaId && !patchIds.has(lower(day.AreaId))) throw fail(400, 'A day uses an area that is not in the patch list.');
        return { CycleWeek: week, Weekday: weekday, AreaId: day.AreaId || null };
    });

    const rows = await customQuery(sql.GET_STPS(), { UserId: userId });
    const open = rows.find((row) => row.Status !== 'APPROVED');
    const now = new Date();
    const stpId = open?.StpId || generateUUID();

    const steps = open
        ? [{ sqlQuery: sql.UPDATE_STP(), inputs: { StpId: stpId, CycleWeeks: cycleWeeks, Now: now } }]
        : [{ sqlQuery: sql.INSERT_STP(), inputs: { StpId: stpId, UserId: userId, CycleWeeks: cycleWeeks, ActorId: actingUserId, Now: now } }];

    try {
        await runInTransaction([
            ...steps,
            ...patches.map((patch) => ({ sqlQuery: sql.INSERT_PATCH(), inputs: { StpId: stpId, ...patch } })),
            ...days.map((day) => ({ sqlQuery: sql.INSERT_DAY(), inputs: { StpId: stpId, ...day } })),
            auditQuery({ entityType: 'STP', entityId: stpId, action: open ? 'UPDATE' : 'CREATE', actorId: actingUserId, after: { userId, cycleWeeks, patches, days: days.length } }),
        ]);
    } catch (error) {
        throw conflict(error);
    }
    return { message: 'Standard tour plan saved as a draft.', StpId: stpId };
};

exports.submitStp = async (actingUserId, stpId) => {
    requireActingUser(actingUserId);
    if (!isGuid(stpId)) throw fail(400, 'Plan is invalid.');
    const stp = await first(customQuery(sql.GET_STP(), { StpId: stpId }));
    if (!stp) throw fail(404, 'Plan not found.');
    await assertCanEdit(actingUserId, stp.UserId);

    const [patches, days] = await Promise.all([customQuery(sql.GET_PATCHES(), { StpId: stpId }), customQuery(sql.GET_DAYS(), { StpId: stpId })]);
    if (!patches.length) throw fail(400, 'Add at least one patch.');
    if (!days.some((day) => day.AreaId)) throw fail(400, 'Assign a patch to at least one weekday.');

    try {
        await runInTransaction([
            { sqlQuery: sql.SUBMIT_STP(), inputs: { StpId: stpId, ActorId: actingUserId, Now: new Date() } },
            auditQuery({ entityType: 'STP', entityId: stpId, action: 'SUBMIT', actorId: actingUserId }),
        ]);
    } catch (error) {
        throw conflict(error);
    }
    return { message: 'Sent to head office for approval.' };
};

exports.withdrawStp = async (actingUserId, stpId) => {
    requireActingUser(actingUserId);
    if (!isGuid(stpId)) throw fail(400, 'Plan is invalid.');
    const stp = await first(customQuery(sql.GET_STP(), { StpId: stpId }));
    if (!stp) throw fail(404, 'Plan not found.');
    await assertCanEdit(actingUserId, stp.UserId);

    try {
        await runInTransaction([
            { sqlQuery: sql.WITHDRAW_STP(), inputs: { StpId: stpId, Now: new Date() } },
            auditQuery({ entityType: 'STP', entityId: stpId, action: 'WITHDRAW', actorId: actingUserId }),
        ]);
    } catch (error) {
        throw conflict(error);
    }
    return { message: 'Taken back from head office. Make your changes and send it again.' };
};

exports.listSubmitted = async () => ({ plans: await customQuery(sql.SUBMITTED_STPS()) });

exports.decideStp = async (actingUserId, stpId, approve, payload) => {
    requireActingUser(actingUserId);
    if (!isGuid(stpId)) throw fail(400, 'Plan is invalid.');
    const stp = await first(customQuery(sql.GET_STP(), { StpId: stpId }));
    if (!stp) throw fail(404, 'Plan not found.');
    if (sameId(stp.UserId, actingUserId)) throw fail(403, 'You cannot approve your own plan.');

    const remarks = optionalText(payload.Remarks, 500, 'Remarks');
    if (!approve && (!remarks || remarks.length < 10)) throw fail(400, 'Say what needs to change (at least 10 characters).');

    try {
        await runInTransaction([
            { sqlQuery: approve ? sql.APPROVE_STP() : sql.RETURN_STP(), inputs: { StpId: stpId, UserId: stp.UserId, ActorId: actingUserId, Remarks: remarks, Now: new Date() } },
            auditQuery({ entityType: 'STP', entityId: stpId, action: approve ? 'APPROVE' : 'RETURN', actorId: actingUserId, reason: remarks }),
        ]);
    } catch (error) {
        throw conflict(error);
    }
    return { message: approve ? 'Standard tour plan approved.' : 'Sent back with your remarks.' };
};

// Month tour plan from the approved STP. Past days keep what was planned; today onwards follows the STP.
// Saved as approved: changes inside the territory need no manager approval.
exports.generateMonth = async (actingUserId, payload) => {
    requireActingUser(actingUserId);
    const userId = payload.UserId || actingUserId;
    if (!sameId(userId, actingUserId)) throw fail(403, 'You can only generate your own tour plan.');

    const month = toMonthStart(payload.Month);
    const today = rules.istDateKey();
    const monthEnd = rules.monthDates(month).slice(-1)[0];
    if (monthEnd < today) throw fail(400, 'This month is already over.');

    const stp = await loadStp(await first(customQuery(sql.APPROVED_FOR_USER(), { UserId: userId })));
    if (!stp) throw fail(409, 'There is no approved standard tour plan yet. Prepare it and send it to head office first.');

    const leaves = await DA.leaveDates(userId, month, monthEnd);
    const leaveDates = new Set();
    leaves.forEach((leave) => rules.monthDates(month).forEach((date) => date >= leave.FromDate && date <= leave.ToDate && leaveDates.add(date)));

    const [areaTerritories, existing, statuses] = await Promise.all([
        TourPlanDA.getAreaTerritories(),
        TourPlanDA.getTourPlanByUserMonth(userId, month),
        TourPlanService.getStatuses(),
    ]);
    const territoryOf = new Map(areaTerritories.map((row) => [lower(row.AreaId), row.TerritoryId]));
    const kept = existing ? await TourPlanDA.getTourPlanDetails(existing.TourPlanId) : [];
    const keptByDate = new Map(kept.map((detail) => [String(detail.PlanDate).slice(0, 10), detail]));

    const details = rules.planFromStp(month, stp, stp.days, leaveDates).map((day) => {
        const previous = keptByDate.get(day.date);
        if (day.date < today && previous) {
            return { PlanDate: day.date, DayType: previous.DayType, TerritoryId: previous.TerritoryId || null, AreaId: previous.AreaId || null, Remarks: previous.Remarks || null };
        }
        return { PlanDate: day.date, DayType: day.dayType, TerritoryId: day.areaId ? territoryOf.get(lower(day.areaId)) || null : null, AreaId: day.areaId, Remarks: day.remarks };
    });

    const now = new Date();
    if (existing) {
        await TourPlanDA.replaceOwnPlan({ TourPlanId: existing.TourPlanId, StatusId: statuses.APPROVED, Now: now, Remarks: 'Generated from the standard tour plan', details });
    } else {
        await TourPlanDA.createTourPlan({
            TourPlanId: generateUUID(),
            UserId: userId,
            PlanMonth: month,
            StatusId: statuses.APPROVED,
            SubmittedOn: now,
            CreatedOn: now,
            ModifiedOn: null,
            details,
        });
    }

    return { message: `Tour plan for ${month.slice(0, 7)} generated from your standard tour plan.`, workingDays: details.filter((d) => d.DayType === 'working').length };
};

exports._internals = { markOvernights };
