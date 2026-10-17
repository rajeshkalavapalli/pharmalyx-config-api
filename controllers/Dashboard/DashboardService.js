const DashboardDA = require('./DashboardDA');

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TREND_DAYS = 14;
const FOLLOW_UP_SOON_DAYS = 7;
const DCR_DEADLINE_DAYS = 1;
const RECENT_LIMIT = 5;
const WEEKDAY_WEEKS = 8;
const TREND_MONTHS = 6;
const LOW_STOCK = 5;
const CATEGORY_ORDER = ['A', 'B', 'C', 'U'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : null);

const fail = (status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

const pad = (value) => String(value).padStart(2, '0');
const keyOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const addDays = (key, days) => {
    const date = new Date(`${key}T00:00:00`);
    date.setDate(date.getDate() + days);
    return keyOf(date);
};

const number = (value) => Number(value) || 0;

exports.getDashboard = async (actingUserId) => {
    if (!actingUserId || !GUID.test(actingUserId)) {
        throw fail(401, 'Acting user is required.');
    }

    const user = await DashboardDA.getUser(actingUserId);

    if (!user) throw fail(404, 'User not found.');

    const now = new Date();
    const today = keyOf(now);
    const monthStart = `${today.slice(0, 8)}01`;
    const monthEnd = keyOf(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    const prevMonthStart = keyOf(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    // Same day last month, clamped to that month's length.
    const prevMonthDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    const prevMonthSameDay = keyOf(
        new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), prevMonthDays))
    );
    const trendFrom = addDays(today, -(TREND_DAYS - 1));

    const [
        kpis,
        trendDays,
        monthVisitDays,
        dcrDates,
        todayPlan,
        planStatus,
        todayDcr,
        approvals,
        team,
        recent,
        followUps,
        schedule,
        plannedDays,
        territories,
    ] = await Promise.all([
        DashboardDA.getKpis({
            UserId: actingUserId,
            Today: today,
            MonthStart: monthStart,
            MonthEnd: monthEnd,
            PrevMonthStart: prevMonthStart,
            PrevMonthSameDay: prevMonthSameDay,
        }),
        DashboardDA.getVisitDays(actingUserId, trendFrom, today),
        DashboardDA.getVisitDays(actingUserId, monthStart, today),
        DashboardDA.getDcrDates(actingUserId, monthStart, today),
        DashboardDA.getTodayPlan(actingUserId, monthStart, today),
        DashboardDA.getMonthPlanStatus(actingUserId, monthStart),
        DashboardDA.getTodayDcr(actingUserId, today),
        DashboardDA.getApprovals(actingUserId),
        DashboardDA.getTeam(actingUserId, monthStart, monthEnd),
        DashboardDA.getRecentVisits(actingUserId, addDays(today, -30), today),
        DashboardDA.getOpenFollowUps(actingUserId),
        DashboardDA.getTodaySchedule(actingUserId, today),
        DashboardDA.getPlannedDays(actingUserId, trendFrom, today),
        DashboardDA.getTerritoryCoverage(actingUserId, monthStart, monthEnd, today),
    ]);

    // 14-day visit trend, zero-filled.
    const byDay = new Map(trendDays.map((row) => [row.VisitDate, number(row.VisitCount)]));
    const trend = Array.from({ length: TREND_DAYS }, (_, index) => {
        const date = addDays(trendFrom, index);
        return { date, visits: byDay.get(date) || 0 };
    });

    // Planned calls (pre-call) per day, next to completed visits.
    const plannedByDay = new Map(plannedDays.map((row) => [row.PlanDate, number(row.Planned)]));
    trend.forEach((day) => {
        day.planned = plannedByDay.get(day.date) || 0;
    });

    const territoryCoverage = summariseTerritories(territories);

    // Field days whose DCR deadline passed without one.
    const sentDates = new Set(dcrDates.map((row) => row.ReportDate));
    const deadlineCutoff = addDays(today, -DCR_DEADLINE_DAYS);
    const missedDcrs = monthVisitDays.filter(
        (row) => row.VisitDate < deadlineCutoff && !sentDates.has(row.VisitDate)
    ).length;

    const soonCutoff = addDays(today, FOLLOW_UP_SOON_DAYS);
    const dueFollowUps = followUps.filter((item) => item.FollowUpDate <= soonCutoff);

    const k = Object.fromEntries(Object.entries(kpis || {}).map(([key, value]) => [key, number(value)]));

    const insights = await buildInsights({
        userId: actingUserId,
        today,
        monthStart,
        monthEnd,
        isManager: team.length > 0,
        trend,
    });

    return {
        user: { Name: user.Name, DesignationName: user.DesignationName },
        today: {
            date: today,
            visits: k.VisitsToday,
            plan: todayPlan,
            dcrStatus: todayDcr,
            // Planned calls first (in call order), then unplanned visits by time.
            schedule: schedule
                .sort((a, b) => (a.Source === b.Source ? (a.CallOrder ?? 0) - (b.CallOrder ?? 0) || String(a.VisitTime).localeCompare(String(b.VisitTime)) : a.Source === 'PLAN' ? -1 : 1))
                .map(({ Source, ...row }) => ({ ...row, planned: Source === 'PLAN' })),
        },
        month: {
            start: monthStart,
            visits: k.VisitsMonth,
            visitsPrevMonthToDate: k.VisitsPrevMonthToDate,
            doctorsMapped: k.DoctorsMapped,
            doctorsVisited: k.DoctorsVisited,
            avgCallMinutes: k.AvgCallMinutes ? Math.round(k.AvgCallMinutes) : null,
            gpsRate: k.VisitsMonth ? Math.round((k.VisitsWithGps / k.VisitsMonth) * 100) : null,
            inPlanRate: k.VisitsMonth ? Math.round((k.VisitsInPlan / k.VisitsMonth) * 100) : null,
            dcrSent: k.DcrSent,
            dcrApproved: k.DcrApproved,
            dcrReturned: k.DcrReturned,
            dcrMissed: missedDcrs,
            distanceKm: k.DistanceKm,
            deviations: k.DeviationsMonth,
            planStatus,
        },
        trend,
        territoryCoverage,
        followUps: {
            due: dueFollowUps.length,
            overdue: dueFollowUps.filter((item) => item.FollowUpDate < today).length,
            items: dueFollowUps.slice(0, RECENT_LIMIT),
        },
        recentVisits: recent.slice(0, RECENT_LIMIT),
        approvals: {
            tourPlans: number(approvals?.TourPlans),
            dcrs: number(approvals?.Dcrs),
            deviations: number(approvals?.Deviations),
        },
        ...insights,
        team: team.map((row) => ({
            UserId: row.UserId,
            Name: row.Name,
            DesignationName: row.DesignationName,
            visits: number(row.Visits),
            doctorsVisited: number(row.DoctorsVisited),
            doctorsMapped: number(row.DoctorsMapped),
            dcrSent: number(row.DcrSent),
            lastVisitDate: row.LastVisitDate ? keyOf(new Date(row.LastVisitDate)) : null,
        })),
    };
};

// Territory coverage: covered (a doctor visited), pending (still on the tour plan), not planned.
const summariseTerritories = (territories) => {
    const territoryRows = territories
        .map((row) => {
            const doctors = number(row.Doctors);
            const visited = number(row.DoctorsVisited);

            return {
                TerritoryId: row.TerritoryId,
                TerritoryName: row.TerritoryName,
                doctors,
                doctorsVisited: visited,
                visits: number(row.Visits),
                coverage: doctors ? Math.round((visited / doctors) * 100) : 0,
                status: visited > 0 ? 'COVERED' : number(row.PlannedAhead) ? 'PENDING' : 'NOT_PLANNED',
            };
        })
        .sort((x, y) => y.coverage - x.coverage || y.visits - x.visits || String(x.TerritoryName).localeCompare(String(y.TerritoryName)));

    return {
        total: territoryRows.length,
        covered: territoryRows.filter((row) => row.status === 'COVERED').length,
        pending: territoryRows.filter((row) => row.status === 'PENDING').length,
        notPlanned: territoryRows.filter((row) => row.status === 'NOT_PLANNED').length,
        top: territoryRows.slice(0, 5),
    };

};

// Engagement, charts and the team view. Optional sections come back as null.
const buildInsights = async ({ userId, today, monthStart, monthEnd, isManager }) => {
    const weekdayFrom = addDays(today, -(WEEKDAY_WEEKS * 7 - 1));
    const firstMonth = new Date(`${monthStart}T00:00:00`);
    firstMonth.setMonth(firstMonth.getMonth() - (TREND_MONTHS - 1));
    const trendFrom = keyOf(firstMonth);

    const [stock, business, rcpa, feedback, coverage, weekdayDays, monthly] = await Promise.all([
        DashboardDA.getStockSummary(userId, monthStart, monthEnd, LOW_STOCK),
        DashboardDA.getBusinessSummary(userId, monthStart),
        DashboardDA.getRcpaSummary(userId, monthStart, monthEnd),
        DashboardDA.getFeedbackSummary(userId, monthStart, monthEnd),
        DashboardDA.getCoverageByCategory(userId, monthStart, monthEnd),
        DashboardDA.getVisitDays(userId, weekdayFrom, today),
        DashboardDA.getMonthlyVisits(userId, trendFrom, today),
    ]);

    // Feedback mix and net score.
    const fb = Object.fromEntries(feedback.map((row) => [row.Feedback, number(row.Visits)]));
    const rated = (fb.POSITIVE || 0) + (fb.NEUTRAL || 0) + (fb.NEGATIVE || 0);

    // Average visits per weekday over the window.
    const weekdayTotals = WEEKDAYS.map(() => 0);
    weekdayDays.forEach((row) => {
        const day = (new Date(`${row.VisitDate}T00:00:00`).getDay() + 6) % 7;
        weekdayTotals[day] += number(row.VisitCount);
    });

    const byMonth = new Map(monthly.map((row) => [row.VisitMonth, number(row.Visits)]));
    const monthlyVisits = Array.from({ length: TREND_MONTHS }, (_, index) => {
        const date = new Date(firstMonth);
        date.setMonth(firstMonth.getMonth() + index);
        const key = keyOf(date).slice(0, 7);
        return { month: key, visits: byMonth.get(key) || 0 };
    });

    const result = {
        engagement: {
            samplesGiven: stock ? number(stock.SamplesGiven) : null,
            giftsGiven: stock ? number(stock.GiftsGiven) : null,
            doctorsReached: stock ? number(stock.DoctorsReached) : null,
            itemsHeld: stock ? number(stock.ItemsHeld) : null,
            lowStockItems: stock ? number(stock.LowStockItems) : null,
            businessExpected: business ? number(business.Expected) : null,
            businessActual: business ? number(business.Actual) : null,
            businessAchievement: business ? percent(number(business.Actual), number(business.Expected)) : null,
            rcpaAudits: rcpa ? number(rcpa.Audits) : null,
            rcpaShare: rcpa ? percent(number(rcpa.Ours), number(rcpa.Ours) + number(rcpa.Theirs)) : null,
            feedback: {
                positive: fb.POSITIVE || 0,
                neutral: fb.NEUTRAL || 0,
                negative: fb.NEGATIVE || 0,
                netScore: rated ? Math.round((((fb.POSITIVE || 0) - (fb.NEGATIVE || 0)) / rated) * 100) : null,
            },
        },
        charts: {
            coverageByCategory: CATEGORY_ORDER.map((category) => {
                const row = coverage.find((item) => item.Category === category);
                return { category, mapped: number(row?.Mapped), visited: number(row?.Visited) };
            }).filter((row) => row.mapped > 0),
            visitsByWeekday: WEEKDAYS.map((label, index) => ({
                label,
                visits: weekdayTotals[index],
                average: Math.round((weekdayTotals[index] / WEEKDAY_WEEKS) * 10) / 10,
            })),
            monthlyVisits,
            weekdayWeeks: WEEKDAY_WEEKS,
        },
        teamSummary: null,
    };

    if (isManager) {
        const trendFromDay = addDays(today, -(TREND_DAYS - 1));
        const [teamDays, teamToday, teamBusiness, teamSamples, teamPlannedDays, membersToday, plannedToday, teamTerritories] = await Promise.all([
            DashboardDA.getTeamVisitDays(userId, trendFromDay, today),
            DashboardDA.getTeamToday(userId, today, monthStart, monthEnd),
            DashboardDA.getTeamBusiness(userId, monthStart),
            DashboardDA.getTeamSamples(userId, monthStart, monthEnd),
            DashboardDA.getTeamPlannedDays(userId, trendFromDay, today),
            DashboardDA.getTeamMembersToday(userId, today, monthStart),
            DashboardDA.getTeamPlannedToday(userId, today),
            DashboardDA.getTeamTerritoryCoverage(userId, monthStart, monthEnd, today),
        ]);

        const teamPlannedByDay = new Map(teamPlannedDays.map((row) => [row.PlanDate, number(row.Planned)]));
        const plannedByUser = new Map(plannedToday.map((row) => [String(row.UserId).toLowerCase(), number(row.Planned)]));

        const teamByDay = new Map(teamDays.map((row) => [row.VisitDate, number(row.VisitCount)]));

        result.teamSummary = {
            reps: number(teamToday?.Reps),
            repsActiveToday: number(teamToday?.RepsActiveToday),
            visitsToday: number(teamToday?.VisitsToday),
            deviationsMonth: number(teamToday?.DeviationsMonth),
            businessExpected: teamBusiness ? number(teamBusiness.Expected) : null,
            businessActual: teamBusiness ? number(teamBusiness.Actual) : null,
            businessAchievement: teamBusiness ? percent(number(teamBusiness.Actual), number(teamBusiness.Expected)) : null,
            samplesGiven: teamSamples ? number(teamSamples.Given) : null,
            trend: Array.from({ length: TREND_DAYS }, (_, index) => {
                const date = addDays(trendFromDay, index);
                return { date, visits: teamByDay.get(date) || 0, planned: teamPlannedByDay.get(date) || 0 };
            }),
            plannedToday: plannedToday.reduce((sum, row) => sum + number(row.Planned), 0),
            // Field status per rep today: off day / no activity / in field / DCR sent.
            membersToday: membersToday.map((row) => {
                const visits = number(row.VisitsToday);
                const status = row.DcrStatus ? 'DCR_SENT' : visits ? 'IN_FIELD' : row.DayType === 'non-working' ? 'OFF' : 'NOT_STARTED';

                return {
                    UserId: row.UserId,
                    visits,
                    planned: plannedByUser.get(String(row.UserId).toLowerCase()) || 0,
                    firstVisit: row.FirstVisit,
                    lastVisit: row.LastVisit,
                    territory: row.TerritoryName,
                    dcrStatus: row.DcrStatus,
                    status,
                };
            }),
            territoryCoverage: summariseTerritories(teamTerritories),
        };
    }

    return result;
};
