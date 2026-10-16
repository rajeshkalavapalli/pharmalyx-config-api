const FeedbackDA = require('./FeedbackDA');

const { resolveViewUser, todayKey, toMonthStart } = require('../../utils/access');

const monthEnd = (monthStart) => {
    const date = new Date(`${monthStart}T00:00:00`);
    return todayKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
};

const number = (value) => Number(value) || 0;

exports.getFeedback = async (actingUserId, query) => {
    const userId = await resolveViewUser(actingUserId, query.userId, 'feedback');
    const fromDate = toMonthStart(query.month || todayKey().slice(0, 7));
    const inputs = { UserId: userId, FromDate: fromDate, ToDate: monthEnd(fromDate) };

    const [counts, doctors, attention] = await Promise.all([
        FeedbackDA.getCounts(inputs),
        FeedbackDA.getByDoctor(inputs),
        FeedbackDA.getAttention(inputs),
    ]);

    const byType = Object.fromEntries(counts.map((row) => [row.Feedback, number(row.Visits)]));
    const positive = byType.POSITIVE || 0;
    const neutral = byType.NEUTRAL || 0;
    const negative = byType.NEGATIVE || 0;
    const rated = positive + neutral + negative;

    return {
        month: fromDate,
        summary: {
            visits: rated + (byType.NONE || 0),
            rated,
            unrated: byType.NONE || 0,
            positive,
            neutral,
            negative,
            // Net sentiment: % positive minus % negative, among rated calls.
            netScore: rated ? Math.round(((positive - negative) / rated) * 100) : null,
        },
        doctors: doctors.map((row) => ({
            ...row,
            Positive: number(row.Positive),
            Neutral: number(row.Neutral),
            Negative: number(row.Negative),
            Visits: number(row.Visits),
        })),
        attention,
    };
};
