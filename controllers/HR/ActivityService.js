const HRDA = require('./HRDA');

const { resolveScope } = require('../../utils/reportScope');
const { fail, toDateKey, todayKey } = require('../../utils/access');

const MAX_DAYS = 31;

const addDays = (key, days) => {
    const date = new Date(`${key}T00:00:00`);
    date.setDate(date.getDate() + days);
    return todayKey(date);
};

const at = (value) => (value ? new Date(value) : null);
const dayOf = (date) => todayKey(date);
const timeOf = (date) => date.toTimeString().slice(0, 5);
const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const label = (value) => String(value || '').replace(/_/g, ' ').toLowerCase();

// Day-by-day feed for one employee: attendance, visits, DCRs, orders, RCPA, leave, claims, tour plans.
exports.getActivity = async (actingUserId, query) => {
    const scope = await resolveScope(actingUserId, query.userId);
    const userId = scope.UserId || actingUserId;

    const ToDate = query.to ? toDateKey(query.to, 'To date') : todayKey();
    const FromDate = query.from ? toDateKey(query.from, 'From date') : addDays(ToDate, -6);
    if (FromDate > ToDate) throw fail(400, 'From date must be on or before the To date.');
    if (Math.round((new Date(`${ToDate}T00:00:00`) - new Date(`${FromDate}T00:00:00`)) / 86400000) >= MAX_DAYS) {
        throw fail(400, `Choose at most ${MAX_DAYS} days.`);
    }

    const inputs = { UserId: userId, FromDate, ToDate };
    const [user, attendance, visits, dcrs, orders, rcpa, leaves, claims, plans] = await Promise.all([
        HRDA.getUser({ UserId: userId }),
        HRDA.actAttendance(inputs),
        HRDA.actVisits(inputs),
        HRDA.actDcrs(inputs),
        HRDA.actOrders(inputs),
        HRDA.actRcpa(inputs),
        HRDA.actLeaves(inputs),
        HRDA.actClaims(inputs),
        HRDA.actTourPlans(inputs),
    ]);

    const events = [];
    const push = (date, type, title, detail, time) => {
        if (!date) return;
        events.push({ day: typeof date === 'string' ? date : dayOf(date), time: time ?? (typeof date === 'string' ? null : timeOf(date)), type, title, detail });
    };

    attendance.forEach((row) => {
        push(at(row.CheckInAt), 'CHECK_IN', 'Checked in', row.CheckInLocation === 'CAPTURED' ? 'GPS captured' : `GPS ${label(row.CheckInLocation)}`);
        if (row.CheckOutAt) push(at(row.CheckOutAt), 'CHECK_OUT', 'Checked out', row.CheckOutLocation === 'CAPTURED' ? 'GPS captured' : `GPS ${label(row.CheckOutLocation)}`);
    });

    visits.forEach((row) =>
        push(
            row.Day,
            'VISIT',
            `Visited Dr. ${row.DoctorName}${row.Category ? ` (Class ${row.Category})` : ''}`,
            [row.StartTime && row.EndTime ? `${row.StartTime}–${row.EndTime}` : null, row.Feedback ? `${label(row.Feedback)} feedback` : null, label(row.PlanStatus), row.LocationStatus === 'CAPTURED' ? 'GPS' : 'no GPS']
                .filter(Boolean)
                .join(' · '),
            row.StartTime || (row.CreatedOn ? timeOf(new Date(row.CreatedOn)) : null)
        )
    );

    dcrs.forEach((row) => push(at(row.SubmittedOn), 'DCR', `Sent DCR for ${row.Day}`, [`${row.VisitCount ?? 0} call(s)`, row.DistanceKm != null ? `${Number(row.DistanceKm)} km` : null, label(row.Status)].filter(Boolean).join(' · ')));
    orders.forEach((row) => push(at(row.CreatedOn), 'ORDER', `Booked ${row.OrderNumber}`, `${row.CustomerType === 'DOCTOR' ? 'Dr. ' : ''}${row.CustomerName} · ${money(row.NetAmount)} · ${label(row.Status)}`));
    rcpa.forEach((row) => push(at(row.CreatedOn), 'RCPA', `RCPA at ${row.PharmacyName}`, `For Dr. ${row.DoctorName}`));
    leaves.forEach((row) => push(at(row.SubmittedOn), 'LEAVE', `Applied for ${row.LeaveName}`, `${row.FromDate}${row.ToDate !== row.FromDate ? ` to ${row.ToDate}` : ''} · ${Number(row.Days)} day(s) · ${label(row.Status)}`));
    claims.forEach((row) => push(at(row.SubmittedOn), 'EXPENSE', `Submitted expense claim for ${row.ClaimMonth}`, `${money(row.ClaimedAmount)} · ${label(row.Status)}`));
    plans.forEach((row) => push(at(row.SubmittedOn), 'TOUR_PLAN', `Submitted tour plan for ${row.PlanMonth}`, null));

    // Newest day first; within a day, by time (untimed last).
    events.sort((a, b) => b.day.localeCompare(a.day) || String(a.time || '99:99').localeCompare(String(b.time || '99:99')));

    const days = [];
    for (let day = ToDate; day >= FromDate; day = addDays(day, -1)) {
        const list = events.filter((event) => event.day === day);
        days.push({
            day,
            events: list,
            summary: {
                visits: list.filter((event) => event.type === 'VISIT').length,
                checkIn: list.find((event) => event.type === 'CHECK_IN')?.time || null,
                checkOut: list.find((event) => event.type === 'CHECK_OUT')?.time || null,
                dcr: list.some((event) => event.type === 'DCR'),
            },
        });
    }

    return {
        user: user ? { UserId: user.UserId, Name: user.Name, ManagerName: user.ManagerName } : null,
        from: FromDate,
        to: ToDate,
        totals: {
            events: events.length,
            visits: events.filter((event) => event.type === 'VISIT').length,
            activeDays: days.filter((day) => day.events.length).length,
            orders: events.filter((event) => event.type === 'ORDER').length,
        },
        days,
    };
};
