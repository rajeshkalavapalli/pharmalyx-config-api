const InsightsDA = require('./InsightsDA');

const { RULES, mergeRules } = require('./InsightsRules');
const { resolveScope } = require('../../utils/reportScope');
const { getPermissions } = require('../../utils/permissions');
const { fail, optionalText, requireActingUser, todayKey } = require('../../utils/access');

const DCR_DEADLINE_DAYS = 1;
const LOOKBACK_DAYS = 90;
const VISIT_LIMIT = 50000;

const number = (value) => Number(value) || 0;
const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : null);
const money = (value) => Math.round(Number(value || 0) * 100) / 100;

const addDays = (key, days) => {
    const date = new Date(`${key}T00:00:00`);
    date.setDate(date.getDate() + days);
    return todayKey(date);
};

const daysBetween = (from, to) => Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000);

// "This month so far" vs "the same days last month".
const periods = () => {
    const now = new Date();
    const today = todayKey(now);
    const prevDays = new Date(now.getFullYear(), now.getMonth(), 0).getDate();

    return {
        Today: today,
        MonthStart: `${today.slice(0, 8)}01`,
        PrevStart: todayKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        PrevSameDay: todayKey(new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), prevDays))),
        DcrCutoff: addDays(today, -DCR_DEADLINE_DAYS - 1),
        dayOfMonth: now.getDate(),
        daysInMonth: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
    };
};

const change = (current, previous) => (previous ? Math.round(((current - previous) / previous) * 100) : null);

const loadRules = async () => mergeRules(await InsightsDA.getRules());

// =========================================================
// RULE SETTINGS (admin)
// =========================================================

exports.getRules = async () => ({ rules: await loadRules() });

exports.saveRule = async (actingUserId, ruleCode, payload) => {
    requireActingUser(actingUserId);

    const rule = RULES.find((item) => item.code === ruleCode);
    if (!rule) throw fail(404, 'Rule not found.');

    if (payload.Reset) {
        await InsightsDA.deleteRule({ RuleCode: ruleCode });
        return { message: `${rule.title} reset to defaults.` };
    }

    const threshold = (value, fallback, label) => {
        if (fallback == null) return null;
        const parsed = value === '' || value == null ? fallback : Number(value);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100000) throw fail(400, `${label} must be a number from 0 to 100000.`);
        return Math.round(parsed * 100) / 100;
    };

    await InsightsDA.upsertRule({
        RuleCode: ruleCode,
        IsEnabled: payload.IsEnabled === false ? 0 : 1,
        Threshold1: threshold(payload.Threshold1, rule.t1, rule.labels[0]),
        Threshold2: threshold(payload.Threshold2, rule.t2, rule.labels[1]),
        ModifiedBy: actingUserId,
        Now: new Date(),
    });

    return { message: `${rule.title} saved.` };
};

// =========================================================
// ALERT ENGINE
// =========================================================

const alert = (rule, key, fields) => ({
    key: `${rule.code}|${key}`,
    ruleCode: rule.code,
    group: rule.group,
    groupLabel: rule.groupLabel,
    title: rule.title,
    ...fields,
});

const buildAlerts = async (inputs, rules) => {
    const p = periods();
    const on = (code) => rules.find((rule) => rule.code === code && rule.enabled);

    const notVisited = on('DOCTOR_NOT_VISITED');
    const negative = on('DOCTOR_NEGATIVE_FEEDBACK');
    const rxDrop = on('DOCTOR_RX_SHARE_DROP');
    const stockRules = [on('STOCK_OUT'), on('STOCK_LOW_COVER'), on('STOCK_OVERSTOCK')];
    const pobRule = on('POB_NOT_SUPPLIED');

    const [keyDoctors, negatives, shares, reps, sales, stock, pending] = await Promise.all([
        notVisited ? InsightsDA.getKeyDoctorLastVisits(inputs) : [],
        negative ? InsightsDA.getNegativeFeedback({ ...inputs, Since: addDays(p.Today, -negative.t2) }) : [],
        rxDrop ? InsightsDA.getRcpaShares({ ...inputs, Since: addDays(p.Today, -180) }) : [],
        InsightsDA.getRepStats({ ...inputs, ...p }),
        InsightsDA.getRepSales({ ...inputs, SalesFrom: todayKey(new Date(new Date().getFullYear(), new Date().getMonth() - 3, 1)) }),
        stockRules.some(Boolean) ? InsightsDA.getLatestStock(inputs) : [],
        pobRule ? InsightsDA.getPobPending({ ...inputs, Cutoff: addDays(p.Today, -pobRule.t1) }) : [],
    ]);

    const alerts = [];

    // ---- Doctor risk ----
    if (notVisited) {
        keyDoctors.forEach((row) => {
            const limit = row.Category === 'A' ? notVisited.t1 : notVisited.t2;
            const gap = row.LastVisit ? daysBetween(row.LastVisit, p.Today) : null;
            if (gap != null && gap < limit) return;

            alerts.push(
                alert(notVisited, `${row.UserId}|${row.DoctorId}|${row.LastVisit || 'never'}`, {
                    severity: row.Category === 'A' ? 'HIGH' : 'MEDIUM',
                    subject: `Dr. ${row.DoctorName}`,
                    category: row.Category,
                    employee: row.EmployeeName,
                    detail: gap == null ? `Class ${row.Category} doctor never visited.` : `Class ${row.Category} doctor not visited for ${gap} days (limit ${limit}).`,
                    since: row.LastVisit,
                    link: '/field-operation/doctors',
                })
            );
        });
    }

    if (negative) {
        negatives
            .filter((row) => number(row.Negatives) >= negative.t1)
            .forEach((row) =>
                alerts.push(
                    alert(negative, `${row.UserId}|${row.DoctorId}|${row.LastNegative}`, {
                        severity: row.Category === 'A' ? 'HIGH' : 'MEDIUM',
                        subject: `Dr. ${row.DoctorName}`,
                        category: row.Category,
                        employee: row.EmployeeName,
                        detail: `${row.Negatives} negative calls in the last ${negative.t2} days.`,
                        since: row.LastNegative,
                        link: '/doctor-engagement/feedback',
                    })
                )
            );
    }

    if (rxDrop) {
        const byDoctor = new Map();
        shares.forEach((row) => {
            const id = `${row.UserId}|${row.DoctorId}`;
            byDoctor.set(id, [...(byDoctor.get(id) || []), row]);
        });

        byDoctor.forEach((audits) => {
            if (audits.length < 2) return;
            const [previous, latest] = audits.slice(-2);
            const share = (row) => percent(number(row.Ours), number(row.Ours) + number(row.Theirs));
            const before = share(previous);
            const now = share(latest);
            if (before == null || now == null || before - now < rxDrop.t1) return;

            alerts.push(
                alert(rxDrop, `${latest.UserId}|${latest.DoctorId}|${latest.AuditDate}`, {
                    severity: before - now >= rxDrop.t1 * 2 ? 'HIGH' : 'MEDIUM',
                    subject: `Dr. ${latest.DoctorName}`,
                    category: latest.Category,
                    employee: latest.EmployeeName,
                    detail: `Our Rx share fell from ${before}% to ${now}% (RCPA ${previous.AuditDate} → ${latest.AuditDate}).`,
                    since: latest.AuditDate,
                    link: '/doctor-engagement/rcpa',
                })
            );
        });
    }

    // ---- Rep performance ----
    const month = p.MonthStart.slice(0, 7);
    const repRule = (code) => on(code);

    reps.forEach((row) => {
        const calls = number(row.Calls);
        const prevCalls = number(row.PrevCalls);
        const mapped = number(row.DoctorsMapped);
        const base = { employee: row.Name, subject: row.Name, link: '/reports/kpi' };

        const drop = repRule('REP_CALLS_DROP');
        if (drop && prevCalls >= drop.t2) {
            const delta = change(calls, prevCalls);
            if (delta != null && -delta >= drop.t1) {
                alerts.push(alert(drop, `${row.UserId}|${month}`, { ...base, severity: -delta >= 50 ? 'HIGH' : 'MEDIUM', detail: `${calls} calls so far vs ${prevCalls} by this day last month (${delta}%).`, since: p.MonthStart }));
            }
        }

        const coverage = repRule('REP_LOW_COVERAGE');
        if (coverage && mapped && p.dayOfMonth >= coverage.t2) {
            const pct = percent(number(row.DoctorsVisited), mapped);
            if (pct < coverage.t1) {
                alerts.push(alert(coverage, `${row.UserId}|${month}`, { ...base, severity: pct < coverage.t1 / 2 ? 'HIGH' : 'MEDIUM', detail: `${pct}% of ${mapped} doctors visited this month (below ${coverage.t1}%).`, since: p.MonthStart, link: '/reports/coverage' }));
            }
        }

        const gps = repRule('REP_LOW_GPS');
        if (gps && calls >= gps.t2) {
            const pct = percent(number(row.WithGps), calls);
            if (pct < gps.t1) {
                alerts.push(alert(gps, `${row.UserId}|${month}`, { ...base, severity: 'MEDIUM', detail: `Only ${pct}% of ${calls} calls this month had GPS (below ${gps.t1}%).`, since: p.MonthStart, link: '/reports/dcr' }));
            }
        }

        const dcr = repRule('REP_DCR_MISSED');
        if (dcr && number(row.MissedDcrs) >= dcr.t1) {
            alerts.push(alert(dcr, `${row.UserId}|${month}|${row.MissedDcrs}`, { ...base, severity: 'MEDIUM', detail: `${row.MissedDcrs} field day(s) this month without a DCR after the deadline.`, since: p.MonthStart, link: '/field-operation/dcr' }));
        }

        const idle = repRule('REP_NO_ACTIVITY');
        if (idle && mapped) {
            const gap = row.LastVisit ? daysBetween(row.LastVisit, p.Today) : null;
            if (gap == null || gap >= idle.t1) {
                alerts.push(alert(idle, `${row.UserId}|${row.LastVisit || 'never'}`, { ...base, severity: 'HIGH', detail: gap == null ? 'No visits logged yet.' : `No visits for ${gap} days (last on ${row.LastVisit}).`, since: row.LastVisit, link: '/field-operation/visits' }));
            }
        }
    });

    const target = repRule('REP_BELOW_TARGET');
    if (target) {
        const nameById = new Map(reps.map((row) => [String(row.UserId).toLowerCase(), row.Name]));
        const latestByRep = new Map();
        sales.filter((row) => number(row.Target) > 0 && row.SalesMonth < month).forEach((row) => {
            const id = String(row.UserId).toLowerCase();
            if (!latestByRep.has(id) || latestByRep.get(id).SalesMonth < row.SalesMonth) latestByRep.set(id, row);
        });

        latestByRep.forEach((row, id) => {
            const pct = percent(number(row.Secondary), number(row.Target));
            if (pct >= target.t1) return;
            alerts.push(
                alert(target, `${id}|${row.SalesMonth}`, {
                    severity: pct < target.t1 / 2 ? 'HIGH' : 'MEDIUM',
                    subject: nameById.get(id) || '—',
                    employee: nameById.get(id) || '—',
                    detail: `${pct}% of target in ${row.SalesMonth} (${money(row.Secondary)} of ${money(row.Target)}).`,
                    since: `${row.SalesMonth}-01`,
                    link: '/reports/sales',
                })
            );
        });
    }

    // ---- Business / stock ----
    const [stockOut, lowCover, overstock] = stockRules;
    stock.forEach((row) => {
        const sold = number(row.SalesQty);
        const closing = number(row.ClosingQty);
        const cover = sold > 0 ? Math.round((closing / sold) * 30) : null;
        const base = {
            subject: `${row.ProductName} at ${row.StockistName || 'stockist'}`,
            employee: row.EmployeeName,
            since: `${row.StatementMonth}-01`,
            link: '/sales/stock',
        };

        if (stockOut && closing === 0 && sold > 0) {
            alerts.push(alert(stockOut, `${row.StatementId}|${row.ProductId}`, { ...base, severity: 'HIGH', detail: `Out of stock after ${row.StatementMonth}; ${sold} units sold that month.` }));
        } else if (lowCover && cover != null && closing > 0 && cover < lowCover.t1) {
            alerts.push(alert(lowCover, `${row.StatementId}|${row.ProductId}`, { ...base, severity: 'MEDIUM', detail: `${closing} units left ≈ ${cover} days of sales (below ${lowCover.t1}).` }));
        } else if (overstock && closing > 0 && (cover == null || cover > overstock.t1)) {
            alerts.push(alert(overstock, `${row.StatementId}|${row.ProductId}`, { ...base, severity: 'LOW', detail: cover == null ? `${closing} units in stock with no sales in ${row.StatementMonth}.` : `${closing} units ≈ ${cover} days of sales (above ${overstock.t1}).` }));
        }
    });

    if (pobRule) {
        pending.forEach((row) =>
            alerts.push(
                alert(pobRule, row.OrderId, {
                    severity: 'MEDIUM',
                    subject: `${row.OrderNumber} · ${row.CustomerType === 'DOCTOR' ? `Dr. ${row.CustomerName}` : row.CustomerName}`,
                    employee: row.EmployeeName,
                    detail: `${row.Status === 'BOOKED' ? 'Booked' : 'Confirmed'} on ${row.OrderDate}, not supplied after ${daysBetween(row.OrderDate, p.Today)} days (${money(row.NetAmount)} via ${row.StockistName || 'stockist'}).`,
                    since: row.OrderDate,
                    link: '/sales/orders',
                })
            )
        );
    }

    return alerts;
};

const SEVERITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };

exports.getAlerts = async (actingUserId, query) => {
    const inputs = await resolveScope(actingUserId, query.userId);
    const [rules, actions, permissions] = await Promise.all([loadRules(), InsightsDA.getActions(), getPermissions(actingUserId)]);
    const actionByKey = new Map(actions.map((row) => [row.AlertKey, row]));

    const all = (await buildAlerts(inputs, rules)).map((item) => {
        const action = actionByKey.get(item.key);
        return {
            ...item,
            status: action?.Status || 'OPEN',
            note: action?.Note || null,
            actedBy: action?.ActedByName || null,
            actedOn: action?.ActedOn || null,
        };
    });

    const alerts = all
        .filter((item) => item.status !== 'RESOLVED')
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || String(b.since || '').localeCompare(String(a.since || '')));

    const count = (fn) => alerts.filter(fn).length;

    return {
        canAct: permissions.has('alerts.act'),
        summary: {
            open: count((item) => item.status === 'OPEN'),
            high: count((item) => item.status === 'OPEN' && item.severity === 'HIGH'),
            acknowledged: count((item) => item.status === 'ACKNOWLEDGED'),
            resolved: all.length - alerts.length,
            byGroup: ['DOCTOR', 'REP', 'STOCK'].map((group) => ({ group, open: count((item) => item.group === group && item.status === 'OPEN') })),
        },
        rules: rules.map(({ code, title, group, groupLabel, enabled }) => ({ code, title, group, groupLabel, enabled })),
        alerts,
    };
};

exports.actOnAlert = async (actingUserId, payload) => {
    requireActingUser(actingUserId);

    const status = String(payload.Status || '').toUpperCase();
    const key = String(payload.AlertKey || '');
    const ruleCode = key.split('|')[0];

    if (!RULES.some((rule) => rule.code === ruleCode) || key.length > 200) throw fail(400, 'Alert is invalid.');

    if (status === 'REOPEN') {
        await InsightsDA.deleteAction({ AlertKey: key });
        return { message: 'Alert reopened.' };
    }

    if (!['ACKNOWLEDGED', 'RESOLVED'].includes(status)) throw fail(400, 'Choose acknowledge or resolve.');

    const note = optionalText(payload.Note, 500, 'Note');
    if (status === 'RESOLVED' && !note) throw fail(400, 'Add a note on how it was resolved.');

    // Only alerts the user can currently see may be acted on.
    const inputs = await resolveScope(actingUserId, null);
    const visible = await buildAlerts(inputs, await loadRules());
    if (!visible.some((item) => item.key === key)) throw fail(404, 'This alert is no longer active or is outside your team.');

    await InsightsDA.upsertAction({ AlertKey: key, RuleCode: ruleCode, Status: status, Note: note, ActedBy: actingUserId, Now: new Date() });

    return { message: status === 'RESOLVED' ? 'Alert resolved.' : 'Alert acknowledged.' };
};

// =========================================================
// PERFORMANCE INSIGHTS
// =========================================================

exports.getPerformance = async (actingUserId, query) => {
    const inputs = await resolveScope(actingUserId, query.userId);
    const p = periods();

    const [reps, pob] = await Promise.all([InsightsDA.getRepStats({ ...inputs, ...p }), InsightsDA.getRepPob({ ...inputs, ...p })]);
    const pobById = new Map(pob.map((row) => [String(row.UserId).toLowerCase(), row]));

    const employees = reps.map((row) => {
        const orders = pobById.get(String(row.UserId).toLowerCase());
        const calls = number(row.Calls);
        const prevCalls = number(row.PrevCalls);
        const mapped = number(row.DoctorsMapped);
        const coverage = percent(number(row.DoctorsVisited), mapped);
        const prevCoverage = percent(number(row.PrevDoctorsVisited), mapped);
        const gps = percent(number(row.WithGps), calls);
        const prevGps = percent(number(row.PrevWithGps), prevCalls);

        return {
            UserId: row.UserId,
            Name: row.Name,
            DesignationName: row.DesignationName,
            ManagerName: row.ManagerName,
            calls,
            prevCalls,
            callsChange: change(calls, prevCalls),
            coverage,
            coverageChange: coverage != null && prevCoverage != null ? coverage - prevCoverage : null,
            gps,
            gpsChange: gps != null && prevGps != null ? gps - prevGps : null,
            inPlan: percent(number(row.InPlan), calls),
            fieldDays: number(row.FieldDays),
            callAverage: number(row.FieldDays) ? Math.round((calls / number(row.FieldDays)) * 10) / 10 : null,
            missedDcrs: number(row.MissedDcrs),
            pob: money(orders?.Pob),
            prevPob: money(orders?.PrevPob),
            pobChange: change(number(orders?.Pob), number(orders?.PrevPob)),
            lastVisit: row.LastVisit,
        };
    });

    const totals = employees.reduce(
        (acc, row) => ({ calls: acc.calls + row.calls, prevCalls: acc.prevCalls + row.prevCalls, pob: acc.pob + row.pob, prevPob: acc.prevPob + row.prevPob }),
        { calls: 0, prevCalls: 0, pob: 0, prevPob: 0 }
    );

    // Plain-English findings, most important first.
    const findings = [];
    const active = employees.filter((row) => row.prevCalls >= 5 && row.callsChange != null);
    const down = [...active].sort((a, b) => a.callsChange - b.callsChange)[0];
    const up = [...active].sort((a, b) => b.callsChange - a.callsChange)[0];

    if (totals.prevCalls) {
        const delta = change(totals.calls, totals.prevCalls);
        findings.push({ tone: delta >= 0 ? 'positive' : 'negative', text: `Calls are ${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta)}% vs the same days last month (${totals.calls} vs ${totals.prevCalls}).` });
    }
    if (down && down.callsChange <= -20) findings.push({ tone: 'negative', text: `${down.Name} has the biggest drop in calls: ${down.callsChange}% (${down.calls} vs ${down.prevCalls}).` });
    if (up && up.callsChange >= 20 && up !== down) findings.push({ tone: 'positive', text: `${up.Name} is up ${up.callsChange}% in calls (${up.calls} vs ${up.prevCalls}).` });

    const lowCoverage = employees.filter((row) => row.coverage != null && row.coverage < 50 && p.dayOfMonth >= 15);
    if (lowCoverage.length) findings.push({ tone: 'negative', text: `${lowCoverage.length} rep(s) have covered under half their doctors this month: ${lowCoverage.slice(0, 3).map((row) => row.Name).join(', ')}${lowCoverage.length > 3 ? '…' : ''}.` });

    const lowGps = employees.filter((row) => row.gps != null && row.gps < 70 && row.calls >= 10);
    if (lowGps.length) findings.push({ tone: 'negative', text: `${lowGps.length} rep(s) have GPS on fewer than 70% of calls: ${lowGps.slice(0, 3).map((row) => row.Name).join(', ')}.` });

    const dcrLate = employees.filter((row) => row.missedDcrs > 0);
    if (dcrLate.length) findings.push({ tone: 'negative', text: `${dcrLate.reduce((sum, row) => sum + row.missedDcrs, 0)} DCR(s) are past their deadline across ${dcrLate.length} rep(s).` });

    if (totals.prevPob || totals.pob) {
        const delta = change(totals.pob, totals.prevPob);
        findings.push({ tone: delta == null || delta >= 0 ? 'positive' : 'negative', text: delta == null ? `POB booked so far: ${money(totals.pob)} (none by this day last month).` : `POB is ${delta >= 0 ? 'up' : 'down'} ${Math.abs(delta)}% vs the same days last month.` });
    }

    if (!findings.length) findings.push({ tone: 'neutral', text: 'Not enough activity yet this month to compare.' });

    return {
        period: { from: p.MonthStart, to: p.Today, prevFrom: p.PrevStart, prevTo: p.PrevSameDay },
        totals: { ...totals, callsChange: change(totals.calls, totals.prevCalls), pobChange: change(totals.pob, totals.prevPob) },
        findings,
        employees: employees.sort((a, b) => (a.callsChange ?? 0) - (b.callsChange ?? 0)),
    };
};

// =========================================================
// FIELD INTELLIGENCE
// =========================================================

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SLOTS = [
    { key: 'MORNING', label: 'Morning (before 12)', test: (hour) => hour != null && hour < 12 },
    { key: 'AFTERNOON', label: 'Afternoon (12–4)', test: (hour) => hour != null && hour >= 12 && hour < 16 },
    { key: 'EVENING', label: 'Evening (4 onwards)', test: (hour) => hour != null && hour >= 16 },
    { key: 'UNKNOWN', label: 'Time not recorded', test: (hour) => hour == null },
];

const feedbackStats = (rows) => {
    const rated = rows.filter((row) => row.Feedback);
    return {
        calls: rows.length,
        positive: rated.filter((row) => row.Feedback === 'POSITIVE').length,
        negative: rated.filter((row) => row.Feedback === 'NEGATIVE').length,
        positiveRate: percent(rated.filter((row) => row.Feedback === 'POSITIVE').length, rated.length),
    };
};

exports.getFieldIntel = async (actingUserId, query) => {
    const inputs = await resolveScope(actingUserId, query.userId);
    const Today = todayKey();
    const Since = addDays(Today, -(LOOKBACK_DAYS - 1));

    const [visits, rcpa, pob] = await Promise.all([
        InsightsDA.getRecentVisits({ ...inputs, Today, Since, Limit: VISIT_LIMIT }),
        InsightsDA.getDoctorRcpaTotals({ ...inputs, Today, Since }),
        InsightsDA.getDoctorPobTotals({ ...inputs, Today, Since }),
    ]);

    const weeks = LOOKBACK_DAYS / 7;
    const weekdayOf = (key) => new Date(`${key}T00:00:00`).getDay();

    const weekdays = [1, 2, 3, 4, 5, 6, 0].map((day) => {
        const rows = visits.filter((row) => weekdayOf(row.VisitDate) === day);
        return { day: WEEKDAYS[day], perWeek: Math.round((rows.length / weeks) * 10) / 10, ...feedbackStats(rows) };
    });

    const slots = SLOTS.map((slot) => ({ key: slot.key, label: slot.label, ...feedbackStats(visits.filter((row) => slot.test(row.VisitHour))) })).filter((slot) => slot.calls > 0);

    const territoryMap = new Map();
    visits.forEach((row) => {
        const key = row.TerritoryName || 'No territory';
        if (!territoryMap.has(key)) territoryMap.set(key, { territory: key, rows: [], doctors: new Set() });
        territoryMap.get(key).rows.push(row);
        territoryMap.get(key).doctors.add(row.DoctorId);
    });
    const territories = [...territoryMap.values()]
        .map((item) => ({ territory: item.territory, doctors: item.doctors.size, ...feedbackStats(item.rows) }))
        .sort((a, b) => b.calls - a.calls);

    const joint = feedbackStats(visits.filter((row) => row.IsJoint));
    const solo = feedbackStats(visits.filter((row) => !row.IsJoint));

    const specialityMap = new Map();
    visits.forEach((row) => {
        const key = (row.Speciality || 'Not set').trim() || 'Not set';
        specialityMap.set(key, [...(specialityMap.get(key) || []), row]);
    });
    const specialities = [...specialityMap.entries()].map(([speciality, rows]) => ({ speciality, ...feedbackStats(rows) })).sort((a, b) => b.calls - a.calls).slice(0, 10);

    // Effort (visits) vs return (RCPA share, POB) per doctor.
    const rcpaById = new Map(rcpa.map((row) => [String(row.DoctorId).toLowerCase(), row]));
    const pobById = new Map(pob.map((row) => [String(row.DoctorId).toLowerCase(), money(row.Pob)]));
    const doctorMap = new Map();
    visits.forEach((row) => {
        const id = String(row.DoctorId).toLowerCase();
        if (!doctorMap.has(id)) doctorMap.set(id, { DoctorId: row.DoctorId, DoctorName: row.DoctorName, Category: row.Category, TerritoryName: row.TerritoryName, visits: 0 });
        doctorMap.get(id).visits += 1;
    });
    const doctors = [...doctorMap.entries()].map(([id, row]) => {
        const audit = rcpaById.get(id);
        const ours = number(audit?.Ours);
        const theirs = number(audit?.Theirs);
        return { ...row, share: audit ? percent(ours, ours + theirs) : null, rxUnits: ours, pob: pobById.get(id) || 0 };
    });

    const highEffort = doctors
        .filter((row) => row.visits >= 3 && (row.share == null ? row.pob === 0 : row.share < 30))
        .sort((a, b) => b.visits - a.visits)
        .slice(0, 15);

    const best = (list, field) => [...list].filter((row) => row.calls >= 3 && row[field] != null).sort((a, b) => b[field] - a[field])[0];
    const bestDay = best(weekdays, 'positiveRate');
    const bestSlot = best(slots, 'positiveRate');
    const busiest = [...weekdays].sort((a, b) => b.calls - a.calls)[0];

    const highlights = [];
    if (busiest?.calls) highlights.push(`Most calls happen on ${busiest.day} (${busiest.perWeek} a week on average).`);
    if (bestDay) highlights.push(`${bestDay.day} calls get the most positive feedback (${bestDay.positiveRate}%).`);
    if (bestSlot) highlights.push(`${bestSlot.label.split(' (')[0]} calls have the best positive rate (${bestSlot.positiveRate}%).`);
    if (joint.calls >= 3 && solo.calls >= 3 && joint.positiveRate != null && solo.positiveRate != null) {
        highlights.push(`Joint calls are ${joint.positiveRate >= solo.positiveRate ? 'more' : 'less'} positive than solo calls (${joint.positiveRate}% vs ${solo.positiveRate}%).`);
    }
    if (highEffort.length) highlights.push(`${highEffort.length} doctor(s) get 3+ visits but give little back (RCPA share under 30% or no POB).`);
    if (!highlights.length) highlights.push(`Not enough calls in the last ${LOOKBACK_DAYS} days for patterns yet.`);

    return {
        period: { from: Since, to: Today, days: LOOKBACK_DAYS },
        totals: { calls: visits.length, doctors: doctorMap.size, ...feedbackStats(visits) },
        highlights,
        weekdays,
        slots,
        territories,
        joint: { joint, solo },
        specialities,
        highEffort,
    };
};

// =========================================================
// ADVANCED ANALYTICS
// =========================================================

const FREQUENT_VISITS = 3; // in 90 days ≈ once a month
const STRONG_SHARE = 50;

const SEGMENTS = {
    CHAMPION: { label: 'Champions', advice: 'Visited often and prescribing us. Protect the relationship.' },
    GROW: { label: 'Grow', advice: 'Visited often, low share. Work on conversion: samples, CME, messaging.' },
    UNDERSERVED: { label: 'Under-served', advice: 'Strong share but rarely visited. Visit more before a competitor does.' },
    RECONSIDER: { label: 'Reconsider', advice: 'Rarely visited and low share. Review the call plan.' },
    NO_DATA: { label: 'No RCPA data', advice: 'No audits yet. Run RCPA at their chemist to know the share.' },
};

exports.getAnalytics = async (actingUserId, query) => {
    const inputs = await resolveScope(actingUserId, query.userId);
    const now = new Date();
    const Today = todayKey(now);
    const Since = addDays(Today, -(LOOKBACK_DAYS - 1));
    const months = Array.from({ length: 6 }, (_, index) => todayKey(new Date(now.getFullYear(), now.getMonth() - 5 + index, 1)).slice(0, 7));

    const [assigned, visits, rcpa, pob, monthly] = await Promise.all([
        InsightsDA.getAssignedDoctors(inputs),
        InsightsDA.getRecentVisits({ ...inputs, Today, Since, Limit: VISIT_LIMIT }),
        InsightsDA.getDoctorRcpaTotals({ ...inputs, Today, Since }),
        InsightsDA.getDoctorPobTotals({ ...inputs, Today, Since }),
        InsightsDA.getMonthlyBusiness({ ...inputs, Months: months.join(',') }).catch(() => []),
    ]);

    // ---- Segmentation ----
    const visitsById = new Map();
    visits.forEach((row) => {
        const id = String(row.DoctorId).toLowerCase();
        visitsById.set(id, (visitsById.get(id) || 0) + 1);
    });
    const rcpaById = new Map(rcpa.map((row) => [String(row.DoctorId).toLowerCase(), row]));
    const pobById = new Map(pob.map((row) => [String(row.DoctorId).toLowerCase(), money(row.Pob)]));

    const doctors = assigned.map((row) => {
        const id = String(row.DoctorId).toLowerCase();
        const audit = rcpaById.get(id);
        const ours = number(audit?.Ours);
        const share = audit ? percent(ours, ours + number(audit.Theirs)) : null;
        const count = visitsById.get(id) || 0;
        const frequent = count >= FREQUENT_VISITS;
        const segment = share == null ? 'NO_DATA' : frequent ? (share >= STRONG_SHARE ? 'CHAMPION' : 'GROW') : share >= STRONG_SHARE ? 'UNDERSERVED' : 'RECONSIDER';

        return { ...row, visits: count, share, pob: pobById.get(id) || 0, segment };
    });

    const segments = Object.entries(SEGMENTS).map(([key, meta]) => {
        const rows = doctors.filter((row) => row.segment === key);
        return { key, ...meta, doctors: rows.length, pob: money(rows.reduce((sum, row) => sum + row.pob, 0)) };
    });

    // ---- Pareto: share of POB from the top 20% of ordering doctors ----
    const ordering = doctors.filter((row) => row.pob > 0).sort((a, b) => b.pob - a.pob);
    const totalPob = ordering.reduce((sum, row) => sum + row.pob, 0);
    const topCount = Math.max(1, Math.ceil(ordering.length * 0.2));
    const topPob = ordering.slice(0, topCount).reduce((sum, row) => sum + row.pob, 0);
    let running = 0;
    const curve = ordering.map((row, index) => {
        running += row.pob;
        return { rank: index + 1, DoctorName: row.DoctorName, pob: row.pob, cumulative: percent(running, totalPob) };
    });

    // ---- Month-end forecast (run rate) and month-on-month growth ----
    const byMonth = new Map(monthly.map((row) => [row.SalesMonth, row]));
    const series = months.map((month, index) => {
        const row = byMonth.get(month) || {};
        const prev = index ? byMonth.get(months[index - 1]) || {} : null;
        return {
            month,
            pob: money(row.Pob),
            secondary: money(row.Secondary),
            target: money(row.Target),
            calls: number(row.Calls),
            pobGrowth: prev ? change(number(row.Pob), number(prev.Pob)) : null,
            callsGrowth: prev ? change(number(row.Calls), number(prev.Calls)) : null,
        };
    });

    const current = series[series.length - 1];
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const project = (value) => money((value / dayOfMonth) * daysInMonth);
    const reported = series.slice(0, -1).filter((row) => row.secondary > 0);
    const avgSecondary = reported.length ? money(reported.reduce((sum, row) => sum + row.secondary, 0) / reported.length) : null;

    return {
        period: { from: Since, to: Today, days: LOOKBACK_DAYS },
        thresholds: { frequentVisits: FREQUENT_VISITS, strongShare: STRONG_SHARE },
        segments,
        doctors: doctors.sort((a, b) => b.pob - a.pob || b.visits - a.visits),
        pareto: {
            orderingDoctors: ordering.length,
            topCount,
            topShare: percent(topPob, totalPob),
            totalPob: money(totalPob),
            curve: curve.slice(0, 50),
        },
        forecast: {
            dayOfMonth,
            daysInMonth,
            pobSoFar: current.pob,
            pobProjected: project(current.pob),
            callsSoFar: current.calls,
            callsProjected: Math.round((current.calls / dayOfMonth) * daysInMonth),
            secondaryExpected: avgSecondary,
            target: current.target,
            targetGap: current.target && avgSecondary != null ? money(current.target - avgSecondary) : null,
        },
        series,
    };
};
