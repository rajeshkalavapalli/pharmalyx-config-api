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
        labels: ['Show alerts from the last (days)'],
    },
    {
        code: 'GPS_SAME_SPOT',
        group: 'GPS',
        title: 'Many clinics, one spot',
        description: 'Visits to doctors with different clinics were checked in from the same place.',
        t1: 30,
        t2: null,
        labels: ['Show alerts from the last (days)'],
    },
    {
        code: 'GPS_IMPOSSIBLE_TRAVEL',
        group: 'GPS',
        title: 'Unusual travel time',
        description: 'Two check-ins too far apart for the time between them.',
        t1: 30,
        t2: null,
        labels: ['Show alerts from the last (days)'],
    },
    {
        code: 'GPS_MOCK',
        group: 'GPS',
        title: 'Location app detected',
        description: 'The phone reported that a location-changing app was on.',
        t1: 30,
        t2: null,
        labels: ['Show alerts from the last (days)'],
    },
    {
        code: 'GPS_OUTSIDE_TERRITORY',
        group: 'GPS',
        title: 'Outside the territory',
        description: 'The work day started, or a visit was checked in, outside the approved territory boundary.',
        t1: 30,
        t2: null,
        labels: ['Show alerts from the last (days)'],
    },
    {
        code: 'GPS_DRIVE_BY',
        group: 'GPS',
        title: 'Very short visit',
        description: 'A visit was logged while the phone was moving in a vehicle.',
        t1: 30,
        t2: null,
        labels: ['Show alerts from the last (days)'],
    },
    {
        code: 'GPS_NO_GPS',
        group: 'GPS',
        title: 'Visit without GPS',
        description: 'A visit to a doctor with a pinned clinic was logged with location off. Off by default (often innocent).',
        t1: 30,
        t2: null,
        labels: ['Show alerts from the last (days)'],
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
    {
        code: 'CHEMIST_PRODUCT_MISSING',
        group: 'STOCK',
        title: 'Product missing at chemists',
        description: 'Reps found one of our products off the shelf at several chemists - prescriptions there go to competitors.',
        t1: 2,
        t2: 30,
        labels: ['Chemists missing it', 'Latest check within days'],
    },

    // Field truth: is the field work real? (only our own signals - doctors are never asked)
    {
        code: 'VISIT_JUST_ENOUGH',
        group: 'TRUTH',
        title: 'Visits stop right at the minimum stay',
        description: 'Most of a rep\'s visits end just after the minimum stay time - a pattern of waiting out the timer (for example in the reception) rather than meeting the doctor.',
        t1: 60,
        t2: 20,
        labels: ['Share of visits just above the minimum (%)', 'Minimum visits in the last 30 days'],
    },
    {
        code: 'VISIT_RAPID_CLUSTER',
        group: 'TRUTH',
        title: 'Many doctors in a few minutes',
        description: 'Check-ins at several different doctors within a few minutes - too fast for real calls.',
        t1: 4,
        t2: 20,
        labels: ['Doctors', 'Within minutes'],
    },
    {
        code: 'DOCTOR_NO_RX_AFTER_VISITS',
        group: 'TRUTH',
        title: 'Many visits, no prescriptions',
        description: 'A doctor was visited many times but shows no prescriptions (RCPA) and no business - the "still converting" excuse has run out.',
        t1: 8,
        t2: 90,
        labels: ['Visits at least', 'Within days'],
    },

    // Money & investments
    {
        code: 'REP_COST_OVER_BUSINESS',
        group: 'MONEY',
        title: 'Rep costs more than the business',
        description: 'Since joining, the rep\'s business is well below the expected ramp-up for their cost (salary set in Business tracking).',
        t1: 50,
        t2: 2,
        labels: ['Business below % of expected', 'Check from months after joining'],
    },
    {
        code: 'DOCTOR_INVESTMENT_BEHIND',
        group: 'MONEY',
        title: 'Doctor investment not paying back',
        description: 'A paid doctor investment (gift, CME, sponsorship) is behind the business promised for it.',
        t1: 34,
        t2: null,
        labels: ['Alert after % of the period has passed'],
    },

    // Manager accountability
    {
        code: 'MANAGER_APPROVES_ALL',
        group: 'MANAGER',
        title: 'Manager approves almost every deviation',
        description: 'A manager approved nearly all plan deviations of the team in the last 60 days.',
        t1: 90,
        t2: 5,
        labels: ['Approved %', 'Minimum decisions'],
    },
    {
        code: 'JOINT_GPS_MISMATCH',
        group: 'MANAGER',
        title: 'Joint visit without the colleague nearby',
        description: 'A visit was logged as joint work, but the colleague\'s phone was not near the clinic at that time.',
        t1: 30,
        t2: null,
        labels: ['Show alerts from the last (days)'],
    },
    {
        code: 'AUDIT_COVERAGE',
        group: 'MANAGER',
        title: 'Rep not audited this month',
        description: 'A rep had fewer joint audits done this month than required, or audits were skipped.',
        t1: 2,
        t2: 20,
        labels: ['Audits needed per month', 'Check from day of month'],
    },
    {
        code: 'AUDIT_FAILED',
        group: 'TRUTH',
        title: 'Joint audit failed',
        description: 'On a joint or cross audit the doctor or clinic was not found, or the doctor did not know the rep.',
        t1: 60,
        t2: null,
        labels: ['Show alerts from the last (days)'],
    },
];

const GROUPS = {
    DOCTOR: 'Doctor risk',
    REP: 'Rep performance',
    STOCK: 'Business & stock',
    GPS: 'GPS & location',
    TRUTH: 'Field truth',
    MONEY: 'Money & investments',
    MANAGER: 'Manager accountability',
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
