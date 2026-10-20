const ApprovalsDA = require('./ApprovalsDA');
const TourPlanService = require('../TourPlan/TourPlanServer');
const DeviationService = require('../DeviationTourPlan/DeviationService');
const DcrService = require('../Dcr/DcrService');
const LeaveService = require('../HR/LeaveService');
const HRDA = require('../HR/HRDA');
const DoctorRequestsDA = require('../DoctorRequests/DoctorRequestsDA');
const DoctorVerificationDA = require('../DoctorVerification/DoctorVerificationDA');
const StpService = require('../VerifiedWork/StpService');
const OrdersDA = require('../Orders/OrdersDA');
const { loadSettings: loadBusinessSettings } = require('../BusinessTracking/settings');

const { getPermissions } = require('../../utils/permissions');
const { fail, isGuid, optionalText, requireActingUser, todayKey } = require('../../utils/access');

// Waiting longer than this many days is flagged as overdue.
const OVERDUE_DAYS = 2;

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const monthLabel = (month) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
const dayLabel = (day) => new Date(`${day}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// type -> how to load, describe and (optionally) decide it here.
// `permission`: only shown to users with it. `inline`: approve / return from the inbox.
const TYPES = {
    // POB still "Raised" after N days: the manager reminds the MR (opened on the POB screen).
    POB_FOLLOW_UP: {
        label: 'POB follow-up',
        load: async (UserId) => OrdersDA.followUpDue(UserId, (await loadBusinessSettings()).FOLLOW_UP_AFTER_DAYS).catch(() => []),
        permission: 'orders.view',
        link: '/sales/orders',
        inline: false,
        describe: (row) => ({ period: `${row.OrderNumber}: ${row.CustomerName}`, summary: `${money(row.NetAmount)} · raised ${dayLabel(row.OrderDate)}, not marked supplied yet` }),
    },
    TOUR_PLAN: {
        label: 'Tour plan',
        load: ApprovalsDA.getTourPlans,
        link: '/field-operation/tour-plan',
        inline: true,
        returnLabel: 'Reject',
        describe: (row) => ({ period: monthLabel(row.Period), summary: `${row.WorkingDays} working day(s) of ${row.DaysPlanned} planned` }),
        decide: (actingUserId, id, approve, remarks) =>
            approve ? TourPlanService.approveTourPlan(actingUserId, id, remarks) : TourPlanService.rejectTourPlan(actingUserId, id, remarks),
    },
    DEVIATION: {
        label: 'Plan deviation',
        load: ApprovalsDA.getDeviations,
        link: '/field-operation/plan-deviation',
        inline: true,
        returnLabel: 'Reject',
        describe: (row) => ({
            period: dayLabel(row.Period),
            summary: [
                row.PlannedTerritory || row.ActualTerritory ? `${row.PlannedTerritory || '—'} → ${row.ActualTerritory || '—'}` : null,
                row.Reason,
            ]
                .filter(Boolean)
                .join(' · ') || 'Worked away from the tour plan',
        }),
        decide: (actingUserId, id, approve, remarks) => DeviationService.reviewDeviation(actingUserId, id, approve ? 'APPROVED' : 'REJECTED', remarks),
    },
    DCR: {
        label: 'Daily call report',
        load: ApprovalsDA.getDcrs,
        link: '/field-operation/dcr',
        inline: true,
        returnLabel: 'Return',
        describe: (row) => ({
            period: dayLabel(row.Period),
            summary: [`${row.VisitCount ?? 0} call(s)`, row.TravelMode ? `${row.TravelMode.toLowerCase()}${row.DistanceKm != null ? ` · ${Number(row.DistanceKm)} km` : ''}` : null].filter(Boolean).join(' · '),
        }),
        decide: (actingUserId, id, approve, remarks) => DcrService.reviewDcr(actingUserId, id, approve ? 'APPROVED' : 'RETURNED', remarks),
    },
    LEAVE: {
        label: 'Leave',
        load: (UserId) => HRDA.pendingLeavesForManager({ UserId }),
        permission: 'leave.approve',
        link: '/hr/leave',
        inline: true,
        returnLabel: 'Reject',
        describe: (row) => ({
            period: row.FromDate === row.ToDate ? dayLabel(row.FromDate) : `${dayLabel(row.FromDate)} – ${dayLabel(row.ToDate)}`,
            summary: `${row.LeaveName} · ${Number(row.Days)} day(s) · ${row.Reason}`,
        }),
        decide: (actingUserId, id, approve, remarks) => LeaveService.review(actingUserId, id, approve, remarks),
    },
    DOCTOR_REQUEST: {
        label: 'Doctor request',
        // Requests without a manager go to admins; `isAdmin` is resolved in getInbox.
        load: (UserId, isAdmin) => DoctorRequestsDA.pendingForApprover({ UserId, IsAdmin: isAdmin ? 1 : 0 }).catch(() => []),
        permission: 'doctorrequests.approve',
        link: '/field-operation/doctor-requests',
        describe: (row) => {
            let duplicates = 0;
            let resubmit = false;
            try {
                const snapshot = JSON.parse(row.FlagsSnapshot || '{}');
                duplicates = (snapshot.duplicates || []).length;
                resubmit = Boolean(snapshot.resubmitOf);
            } catch {
                duplicates = 0;
            }
            const action = { CREATE: 'New doctor', EDIT: 'Edit', DELETE: 'Delete' }[row.RequestType];
            return {
                period: `${action}: Dr. ${row.DoctorName}`,
                summary: [resubmit ? 'Sent again after rejection' : null, row.Speciality, row.AreaName, duplicates ? `${duplicates} possible duplicate(s)` : null, row.Comment].filter(Boolean).join(' · '),
            };
        },
    },
    DOCTOR_VERIFICATION: {
        label: 'Doctor verification',
        load: (UserId, isAdmin) => DoctorVerificationDA.pendingForApprover({ UserId, IsAdmin: isAdmin ? 1 : 0 }).catch(() => []),
        permission: 'doctorrequests.approve',
        link: '/field-operation/doctor-requests?tab=verification&view=proofs',
        describe: (row) => ({
            period: `Verify Dr. ${row.DoctorName}`,
            summary: [{ REGISTRATION_NO: 'Registration no.', PHONE: 'Phone', DOCUMENT: 'Photo' }[row.Method], row.Value, row.Speciality, row.AreaName].filter(Boolean).join(' · '),
        }),
    },
    // Standard tour plans sent to head office; Review opens that person's plan.
    STP: {
        label: 'Standard tour plan',
        load: async (UserId) =>
            (await StpService.listSubmitted()).plans
                .filter((plan) => String(plan.UserId).toLowerCase() !== String(UserId).toLowerCase()) // nobody approves their own
                .map((plan) => ({ ...plan, Id: plan.StpId })),
        permission: 'stp.approve',
        link: (row) => `/field-operation/stp?user=${row.UserId}`,
        describe: (row) => ({
            period: `${row.CycleWeeks}-week cycle`,
            summary: [`${row.Patches} patch(es)`, row.SubmittedByName && row.SubmittedByName !== row.UserName ? `sent by ${row.SubmittedByName}` : null, row.ManagerName ? `manager ${row.ManagerName}` : null].filter(Boolean).join(' · '),
        }),
    },
    STATEMENT: {
        label: 'Secondary sales statement',
        load: ApprovalsDA.getStatements,
        permission: 'secondary.approve',
        link: '/sales/secondary',
        describe: (row) => ({ period: monthLabel(row.Period), summary: `${row.StockistName || 'Stockist'} · ${money(row.SalesValue)} sales · ${row.TotalSalesQty} units` }),
    },
    DOCTOR_PLAN: {
        label: 'Doctor business plan',
        load: ApprovalsDA.getDoctorPlans,
        permission: 'doctorplan.approve',
        link: '/planning/doctor-plan',
        describe: (row) => ({ period: monthLabel(row.Period), summary: `${row.Doctors} doctor(s) planned` }),
    },
    CLAIM: {
        label: 'Expense claim',
        load: ApprovalsDA.getClaimsForManager,
        permission: 'expenses.approve',
        link: '/expenses/claims',
        describe: (row) => ({ period: monthLabel(row.Period), summary: `${money(row.ClaimedAmount)} claimed` }),
    },
    PAYMENT: {
        label: 'Expense payment',
        load: ApprovalsDA.getClaimsForFinance,
        permission: 'expensefinance.approve',
        link: '/expenses/payments',
        describe: (row) => ({ period: monthLabel(row.Period), summary: `${money(row.ApprovedAmount ?? row.ClaimedAmount)} approved by manager` }),
    },
};

const ageInDays = (value) => {
    if (!value) return null;
    const submitted = new Date(value);
    return Math.max(0, Math.round((new Date(`${todayKey()}T00:00:00`) - new Date(todayKey(submitted) + 'T00:00:00')) / 86400000));
};

exports.getInbox = async (actingUserId) => {
    requireActingUser(actingUserId);

    const permissions = await getPermissions(actingUserId);
    const visible = Object.entries(TYPES).filter(([, type]) => !type.permission || permissions.has(type.permission));

    const admin = permissions.has('masters.edit');
    const loaded = await Promise.all(visible.map(([, type]) => type.load(actingUserId, admin)));

    const items = visible
        .flatMap(([code, type], index) =>
            loaded[index].map((row) => {
                const age = ageInDays(row.SubmittedOn);

                return {
                    key: `${code}:${row.Id}`,
                    type: code,
                    typeLabel: type.label,
                    id: row.Id,
                    userName: row.UserName,
                    submittedOn: row.SubmittedOn,
                    ageDays: age,
                    overdue: age != null && age > OVERDUE_DAYS,
                    inline: Boolean(type.inline),
                    returnLabel: type.returnLabel || 'Return',
                    link: typeof type.link === 'function' ? type.link(row) : type.link,
                    ...type.describe(row),
                };
            })
        )
        .sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0));

    return {
        overdueDays: OVERDUE_DAYS,
        types: visible.map(([code, type]) => ({ type: code, label: type.label, count: items.filter((item) => item.type === code).length })),
        total: items.length,
        overdue: items.filter((item) => item.overdue).length,
        items,
    };
};

// Approve / return straight from the inbox (tour plans, deviations, DCRs). The module's own rules apply.
exports.decide = async (actingUserId, typeCode, id, decision, payload) => {
    requireActingUser(actingUserId);

    const type = TYPES[typeCode];
    if (!type) throw fail(404, 'Unknown approval type.');
    if (!type.inline) throw fail(400, `Open ${type.label.toLowerCase()}s on their own screen to review them.`);
    if (!isGuid(id)) throw fail(400, 'Item is invalid.');
    if (!['approve', 'return'].includes(decision)) throw fail(400, 'Choose approve or return.');

    const approve = decision === 'approve';
    const remarks = optionalText(payload.Remarks, 1000, 'Remarks');
    if (!approve && !remarks) throw fail(400, `Give a reason to ${type.returnLabel.toLowerCase()}.`);

    await type.decide(actingUserId, id, approve, remarks);

    return { message: `${type.label} ${approve ? 'approved' : type.returnLabel === 'Reject' ? 'rejected' : 'returned'}.` };
};
