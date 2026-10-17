// Alert rule catalogue: defaults live here; admins override them in dbo.InsightRules.
// t1 / t2 are the two thresholds a rule can use; `labels` say what they mean.

const RULES = [
    // Doctor risk
    {
        code: 'DOCTOR_NOT_VISITED',
        group: 'DOCTOR',
        title: 'Key doctor not visited',
        description: 'A Class A or B doctor has gone too long without a visit.',
        t1: 30,
        t2: 45,
        labels: ['Days for Class A', 'Days for Class B'],
    },
    {
        code: 'DOCTOR_NEGATIVE_FEEDBACK',
        group: 'DOCTOR',
        title: 'Repeated negative feedback',
        description: 'A doctor gave negative feedback on several recent calls.',
        t1: 2,
        t2: 60,
        labels: ['Negative calls', 'Within days'],
    },
    {
        code: 'DOCTOR_VERIFICATION_OVERDUE',
        group: 'DOCTOR',
        title: 'Doctor verification overdue',
        description: 'A provisional doctor was not verified before the deadline.',
        t1: 15,
        t2: null,
        labels: ['Days overdue that count as high'],
    },
    {
        code: 'DOCTOR_RX_SHARE_DROP',
        group: 'DOCTOR',
        title: 'Rx share dropping',
        description: "Our share of the doctor's prescriptions (RCPA) fell between the last two audits.",
        t1: 15,
        t2: null,
        labels: ['Drop in share (points)'],
    },

    // Rep performance
    {
        code: 'REP_CALLS_DROP',
        group: 'REP',
        title: 'Calls down vs last month',
        description: 'Calls this month so far are well below the same days last month.',
        t1: 25,
        t2: 10,
        labels: ['Drop %', 'Minimum calls last month'],
    },
    {
        code: 'REP_LOW_COVERAGE',
        group: 'REP',
        title: 'Low doctor coverage',
        description: 'Too few assigned doctors visited this month, checked after a set day of the month.',
        t1: 50,
        t2: 15,
        labels: ['Coverage below %', 'Check from day of month'],
    },
    {
        code: 'REP_LOW_GPS',
        group: 'REP',
        title: 'Low GPS check-ins',
        description: 'Too many calls this month without a GPS location.',
        t1: 70,
        t2: 10,
        labels: ['GPS below %', 'Minimum calls'],
    },
    {
        code: 'REP_DCR_MISSED',
        group: 'REP',
        title: 'DCRs not sent',
        description: 'Field days this month whose DCR deadline passed without a report.',
        t1: 2,
        t2: null,
        labels: ['Missed DCRs'],
    },
    {
        code: 'REP_NO_ACTIVITY',
        group: 'REP',
        title: 'No field activity',
        description: 'No visits logged for several days.',
        t1: 5,
        t2: null,
        labels: ['Days without visits'],
    },
    {
        code: 'REP_BELOW_TARGET',
        group: 'REP',
        title: 'Below sales target',
        description: 'Secondary sales in the last reported month were well below target.',
        t1: 80,
        t2: null,
        labels: ['Achievement below %'],
    },

    // GPS & location (flags written when visits are logged; t1 = how many days of flags to show)
    {
        code: 'GPS_OUTSIDE_GEOFENCE',
        group: 'GPS',
        title: 'Check-in away from the clinic',
        description: 'A visit was logged outside the allowed distance from the doctor\'s saved clinic.',
        t1: 30,
        t2: null,
        labels: ['Show flags from the last (days)'],
    },
    {
        code: 'GPS_SAME_SPOT',
        group: 'GPS',
        title: 'Many clinics, one spot',
        description: 'Visits to doctors with different clinics were checked in from the same place.',
        t1: 30,
        t2: null,
        labels: ['Show flags from the last (days)'],
    },
    {
        code: 'GPS_IMPOSSIBLE_TRAVEL',
        group: 'GPS',
        title: 'Impossible travel',
        description: 'Two check-ins too far apart for the time between them.',
        t1: 30,
        t2: null,
        labels: ['Show flags from the last (days)'],
    },
    {
        code: 'GPS_MOCK',
        group: 'GPS',
        title: 'Fake (mock) GPS',
        description: 'The phone reported a mock location app (Android app).',
        t1: 30,
        t2: null,
        labels: ['Show flags from the last (days)'],
    },
    {
        code: 'GPS_NO_GPS',
        group: 'GPS',
        title: 'Visit without GPS',
        description: 'A visit to a doctor with a pinned clinic was logged with location off. Off by default (often innocent).',
        t1: 30,
        t2: null,
        labels: ['Show flags from the last (days)'],
        defaultEnabled: false,
    },

    // Business / stock
    {
        code: 'STOCK_OUT',
        group: 'STOCK',
        title: 'Stock-out at stockist',
        description: 'A selling product closed the last statement with no stock.',
        t1: null,
        t2: null,
        labels: [],
    },
    {
        code: 'STOCK_LOW_COVER',
        group: 'STOCK',
        title: 'Low stock cover',
        description: 'Stock lasts fewer days than the threshold at the last month’s sales rate.',
        t1: 15,
        t2: null,
        labels: ['Cover below days'],
    },
    {
        code: 'STOCK_OVERSTOCK',
        group: 'STOCK',
        title: 'Overstock',
        description: 'Stock covers more days of sales than the threshold.',
        t1: 60,
        t2: null,
        labels: ['Cover above days'],
    },
    {
        code: 'POB_NOT_SUPPLIED',
        group: 'STOCK',
        title: 'POB not supplied',
        description: 'An order is still booked or confirmed after several days.',
        t1: 7,
        t2: null,
        labels: ['Days since order'],
    },
];

const GROUPS = {
    DOCTOR: 'Doctor risk',
    REP: 'Rep performance',
    STOCK: 'Business & stock',
    GPS: 'GPS & location',
};

// Defaults merged with saved overrides: [{ ...rule, enabled, t1, t2, customised }]
const mergeRules = (overrides = []) => {
    const byCode = new Map(overrides.map((row) => [row.RuleCode, row]));

    return RULES.map((rule) => {
        const saved = byCode.get(rule.code);

        return {
            ...rule,
            groupLabel: GROUPS[rule.group],
            enabled: saved ? Boolean(saved.IsEnabled) : rule.defaultEnabled !== false,
            t1: saved?.Threshold1 != null && rule.t1 != null ? Number(saved.Threshold1) : rule.t1,
            t2: saved?.Threshold2 != null && rule.t2 != null ? Number(saved.Threshold2) : rule.t2,
            defaults: { t1: rule.t1, t2: rule.t2 },
            customised: Boolean(saved),
        };
    });
};

module.exports = { RULES, GROUPS, mergeRules };
