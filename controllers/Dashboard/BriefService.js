const { requireActingUser } = require('../../utils/access');
const { getPermissions } = require('../../utils/permissions');
const Overview = require('./OverviewService');

// The weekly owner brief: 5-7 plain lines a busy owner reads in 30 seconds (Monday morning).
// Built from the team overview and the open high alerts. Email / WhatsApp delivery can send the same lines later.

const rupees = (value) => {
    const n = Math.round(Number(value) || 0);
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
    if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
    return `₹${n}`;
};

exports.getBrief = async (actingUserId) => {
    requireActingUser(actingUserId);
    const overview = await Overview.getOverview(actingUserId);
    if (!overview.available) return { available: false, lines: [] };

    const h = overview.headline;
    const lines = [];
    lines.push({
        tone: 'info',
        text: `${h.visitsMonth} visits this month${h.validPct != null ? `, ${h.validPct}% verified at the clinic` : ''}; ${h.repsActiveToday} of ${overview.people} people in the field today.`,
    });
    lines.push({ tone: 'info', text: `Business: ${rupees(h.pobValue)} POB booked, ${rupees(h.secondaryValue)} secondary sales, ${rupees(h.collected)} collected${h.cashWithMrs ? ` (${rupees(h.cashWithMrs)} still with reps)` : ''}.` });

    const board = overview.leaderboard.filter((p) => p.visits > 0);
    if (board.length) lines.push({ tone: 'success', text: `Top performer: ${board[0].Name} - ${board[0].visits} visits, ${board[0].validPct ?? 0}% valid, ${rupees(board[0].pobValue)} POB.` });
    const idle = overview.leaderboard.filter((p) => p.visits === 0);
    if (idle.length) lines.push({ tone: 'warning', text: `${idle.length} ${idle.length === 1 ? 'person has' : 'people have'} no visits this month: ${idle.slice(0, 3).map((p) => String(p.Name).trim()).join(', ')}${idle.length > 3 ? ` and ${idle.length - 3} more` : ''}.` });

    // The open high alerts, if this person may see alerts.
    let alerts = [];
    if ((await getPermissions(actingUserId)).has('alerts.view')) {
        try {
            const Insights = require('../Insights/InsightsService');
            alerts = (await Insights.getAlerts(actingUserId, {})).alerts.filter((a) => a.status === 'OPEN' && a.severity === 'HIGH');
        } catch (error) {
            console.error('Brief alerts skipped:', error.message);
        }
    }
    if (alerts.length) {
        const byTitle = new Map();
        alerts.forEach((a) => byTitle.set(a.title, (byTitle.get(a.title) || 0) + 1));
        const top = [...byTitle.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
        lines.push({ tone: 'error', text: `Needs action: ${top.map(([title, count]) => `${title} (${count})`).join(' · ')}.`, link: '/insights/risk' });
    }
    const a = overview.attention;
    const asks = [
        a.paymentsToConfirm && `${a.paymentsToConfirm} payment(s) to confirm`,
        a.missedDcrs && `${a.missedDcrs} missed DCR(s)`,
        a.lowStock && `${a.lowStock} sample item(s) running low`,
    ].filter(Boolean);
    if (asks.length) lines.push({ tone: 'warning', text: `Also: ${asks.join(', ')}.` });

    return { available: true, headOffice: overview.headOffice, generatedOn: new Date(), lines: lines.slice(0, 7) };
};
