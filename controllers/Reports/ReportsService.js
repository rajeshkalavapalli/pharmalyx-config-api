const ReportsDA = require('./ReportsDA');

const { getFilterOptions, getScopeUsers, resolveFilters } = require('../../utils/reportScope');
const { todayKey } = require('../../utils/access');

const ROW_LIMIT = 5000;

const number = (value) => Number(value) || 0;
const percent = (part, whole) => (whole ? Math.round((part / whole) * 100) : null);
const round1 = (value) => (value == null ? null : Math.round(Number(value) * 10) / 10);

const addDays = (key, days) => {
    const date = new Date(`${key}T00:00:00`);
    date.setDate(date.getDate() + days);
    return todayKey(date);
};

exports.getOptions = (actingUserId) => getFilterOptions(actingUserId);

// =========================================================
// DCR / Call report
// =========================================================

exports.getCallReport = async (actingUserId, query) => {
    const inputs = await resolveFilters(actingUserId, query);

    const [totals, byDay, byEmployee, rows] = await Promise.all([
        ReportsDA.getCallTotals(inputs),
        ReportsDA.getCallsByDay(inputs),
        ReportsDA.getCallsByEmployee(inputs),
        ReportsDA.getCallRows({ ...inputs, Limit: ROW_LIMIT }),
    ]);

    const calls = number(totals?.Calls);
    const fieldDays = number(totals?.FieldDays);

    // Zero-filled day series for the chart.
    const callsByDate = new Map(byDay.map((row) => [row.VisitDate, number(row.Calls)]));
    const days = [];
    for (let date = inputs.FromDate; date <= inputs.ToDate; date = addDays(date, 1)) {
        days.push({ date, calls: callsByDate.get(date) || 0 });
    }

    const employees = byEmployee.map((row) => {
        const employeeCalls = number(row.Calls);
        const employeeDays = number(row.FieldDays);

        return {
            UserId: row.UserId,
            Name: row.Name,
            DesignationName: row.DesignationName,
            ManagerName: row.ManagerName,
            calls: employeeCalls,
            doctors: number(row.Doctors),
            fieldDays: employeeDays,
            callAverage: employeeDays ? round1(employeeCalls / employeeDays) : null,
            gpsPercent: percent(number(row.WithGps), employeeCalls),
            inPlanPercent: percent(number(row.InPlan), employeeCalls),
            avgMinutes: row.AvgMinutes == null ? null : Math.round(row.AvgMinutes),
            dcrApproved: number(row.DcrApproved),
            dcrPending: number(row.DcrPending),
            dcrReturned: number(row.DcrReturned),
        };
    });

    return {
        filters: { from: inputs.FromDate, to: inputs.ToDate, userId: inputs.UserId, territoryId: inputs.TerritoryId },
        kpis: {
            calls,
            doctors: number(totals?.Doctors),
            fieldDays,
            callAverage: fieldDays ? round1(calls / fieldDays) : null,
            gpsPercent: percent(number(totals?.WithGps), calls),
            inPlanPercent: percent(number(totals?.InPlan), calls),
            jointCalls: number(totals?.JointCalls),
            avgMinutes: totals?.AvgMinutes == null ? null : Math.round(totals.AvgMinutes),
            dcrApproved: employees.reduce((sum, row) => sum + row.dcrApproved, 0),
            dcrPending: employees.reduce((sum, row) => sum + row.dcrPending, 0),
            dcrReturned: employees.reduce((sum, row) => sum + row.dcrReturned, 0),
        },
        days,
        employees,
        rows: rows.slice(0, ROW_LIMIT),
        truncated: rows.length > ROW_LIMIT,
        rowLimit: ROW_LIMIT,
    };
};

// =========================================================
// Shared helpers for the remaining reports
// =========================================================

const DETAIL_LIMIT = 20000;

const monthStartOf = (key) => `${key.slice(0, 7)}-01`;

const monthsBetween = (from, to) => {
    const months = [];
    const cursor = new Date(`${monthStartOf(from)}T00:00:00`);
    const end = new Date(`${monthStartOf(to)}T00:00:00`);

    while (cursor <= end) {
        months.push(todayKey(cursor).slice(0, 7));
        cursor.setMonth(cursor.getMonth() + 1);
    }

    return months;
};

const rangeDays = (from, to) => Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000) + 1;

const money = (value) => Math.round(Number(value || 0) * 100) / 100;

const capped = (rows) => ({ rows: rows.slice(0, DETAIL_LIMIT), truncated: rows.length > DETAIL_LIMIT, rowLimit: DETAIL_LIMIT });

// Sum rows into a Map keyed by `keyOf(row)`, using `init(row)` and `add(acc, row)`.
const groupBy = (rows, keyOf, init, add) => {
    const map = new Map();
    rows.forEach((row) => {
        const key = keyOf(row);
        if (!map.has(key)) map.set(key, init(row));
        add(map.get(key), row);
    });
    return [...map.values()];
};

const withMonths = (inputs) => ({ ...inputs, FromMonth: monthStartOf(inputs.FromDate), ToMonth: monthStartOf(inputs.ToDate) });

const filtersOut = (inputs) => ({
    from: inputs.FromDate,
    to: inputs.ToDate,
    userId: inputs.UserId,
    territoryId: inputs.TerritoryId,
    productId: inputs.ProductId ?? null,
});

// =========================================================
// Coverage
// =========================================================

// Visits required in the range from the doctor's monthly norm (VisitsPerMonth).
const requiredVisits = (norm, days) => (norm ? Math.max(1, Math.round((norm * days) / 30)) : 0);

const assignmentStatus = (visits, required) => (visits === 0 ? 'NOT_VISITED' : visits < required ? 'BELOW_NORM' : 'MET');

const CATEGORY_ORDER = ['A', 'B', 'C', 'U'];

const loadAssignments = async (inputs) => {
    const days = rangeDays(inputs.FromDate, inputs.ToDate);
    const raw = await ReportsDA.getDoctorAssignments({ ...inputs, Limit: DETAIL_LIMIT });
    const rows = raw.map((row) => {
        const visits = number(row.Visits);
        const required = requiredVisits(number(row.Norm), days);

        return { ...row, Category: row.Category || null, visits, required, status: assignmentStatus(visits, required) };
    });

    return { days, ...capped(rows) };
};

const coverageSummary = (rows) => {
    const visited = rows.filter((row) => row.visits > 0).length;
    const met = rows.filter((row) => row.status === 'MET').length;

    return {
        assignments: rows.length,
        visited,
        notVisited: rows.length - visited,
        belowNorm: rows.filter((row) => row.status === 'BELOW_NORM').length,
        met,
        coveragePercent: percent(visited, rows.length),
        compliancePercent: percent(met, rows.filter((row) => row.required > 0).length),
        visits: rows.reduce((sum, row) => sum + row.visits, 0),
    };
};

exports.getCoverageReport = async (actingUserId, query) => {
    const inputs = await resolveFilters(actingUserId, query);
    const { days, rows, truncated, rowLimit } = await loadAssignments(inputs);

    const byCategory = CATEGORY_ORDER.map((category) => {
        const subset = rows.filter((row) => (row.Category || 'U') === category);
        return { category, ...coverageSummary(subset) };
    }).filter((row) => row.assignments > 0);

    const employees = groupBy(
        rows,
        (row) => String(row.UserId).toLowerCase(),
        (row) => ({ UserId: row.UserId, Name: row.EmployeeName, rows: [] }),
        (acc, row) => acc.rows.push(row)
    ).map(({ rows: subset, ...rest }) => ({ ...rest, ...coverageSummary(subset) }));

    return { filters: filtersOut(inputs), days, kpis: coverageSummary(rows), byCategory, employees, rows, truncated, rowLimit };
};

// =========================================================
// Missed visits
// =========================================================

exports.getMissedReport = async (actingUserId, query) => {
    const inputs = await resolveFilters(actingUserId, query);
    const Today = todayKey();

    const [{ rows: assignments, truncated }, plans, fieldDays] = await Promise.all([
        loadAssignments(inputs),
        ReportsDA.optional(ReportsDA.getMissedPlannedCalls({ ...inputs, Today, Limit: DETAIL_LIMIT })),
        ReportsDA.getMissedFieldDays({ ...inputs, Today, Limit: DETAIL_LIMIT }),
    ]);

    const daysSince = (key) => (key ? Math.round((new Date(`${Today}T00:00:00`) - new Date(`${key}T00:00:00`)) / 86400000) : null);

    const doctors = assignments
        .filter((row) => row.status !== 'MET')
        .map((row) => ({ ...row, shortBy: Math.max(0, row.required - row.visits), daysSince: daysSince(row.LastVisit) }))
        .sort((a, b) => (b.daysSince ?? 99999) - (a.daysSince ?? 99999));

    const plannedCalls = capped(plans || []);
    const missedDays = capped(fieldDays);

    const employees = groupBy(
        [
            ...doctors.map((row) => ({ name: row.EmployeeName, kind: row.visits === 0 ? 'notVisited' : 'belowNorm' })),
            ...plannedCalls.rows.map((row) => ({ name: row.EmployeeName, kind: 'missedCalls' })),
            ...missedDays.rows.map((row) => ({ name: row.EmployeeName, kind: 'missedDays' })),
        ],
        (row) => row.name,
        (row) => ({ Name: row.name, notVisited: 0, belowNorm: 0, missedCalls: 0, missedDays: 0 }),
        (acc, row) => {
            acc[row.kind] += 1;
        }
    ).sort((a, b) => b.notVisited + b.missedCalls - (a.notVisited + a.missedCalls));

    return {
        filters: filtersOut(inputs),
        kpis: {
            notVisited: doctors.filter((row) => row.visits === 0).length,
            belowNorm: doctors.filter((row) => row.visits > 0).length,
            missedCalls: plannedCalls.rows.length,
            missedDays: missedDays.rows.length,
            assignments: assignments.length,
        },
        employees,
        doctors,
        plannedCalls: plannedCalls.rows,
        missedDays: missedDays.rows,
        truncated: truncated || plannedCalls.truncated || missedDays.truncated,
        rowLimit: DETAIL_LIMIT,
    };
};

// =========================================================
// POB
// =========================================================

const POB_LIVE = (status) => status !== 'CANCELLED';

const pobAggregate = () => ({ orders: new Set(), value: 0, supplied: 0, pending: 0, cancelled: 0, units: 0, freeUnits: 0 });

const addPob = (acc, row) => {
    const value = Number(row.NetAmount) || 0;
    acc.orders.add(row.OrderId);
    if (row.Status === 'CANCELLED') acc.cancelled += value;
    else {
        acc.value += value;
        acc.units += number(row.Quantity);
        acc.freeUnits += number(row.FreeQuantity);
    }
    if (row.Status === 'SUPPLIED') acc.supplied += value;
    if (row.Status === 'BOOKED' || row.Status === 'CONFIRMED') acc.pending += value;
};

const finishPob = ({ orders, ...acc }) => ({
    ...acc,
    orders: orders.size,
    value: money(acc.value),
    supplied: money(acc.supplied),
    pending: money(acc.pending),
    cancelled: money(acc.cancelled),
    suppliedPercent: percent(acc.supplied, acc.value),
});

const loadPob = async (inputs) => capped(await ReportsDA.optional(ReportsDA.getPobLines({ ...inputs, Limit: DETAIL_LIMIT })) || []);

exports.getPobReport = async (actingUserId, query) => {
    const inputs = await resolveFilters(actingUserId, query, { product: true });
    const { rows, truncated, rowLimit } = await loadPob(inputs);

    const total = pobAggregate();
    rows.forEach((row) => addPob(total, row));
    const kpis = finishPob(total);
    const liveOrders = new Set(rows.filter((row) => POB_LIVE(row.Status)).map((row) => row.OrderId)).size;
    kpis.avgOrderValue = liveOrders ? money(kpis.value / liveOrders) : null;

    const by = (keyOf, label) =>
        groupBy(rows, keyOf, (row) => ({ key: keyOf(row), label: label(row), ...pobAggregate() }), addPob)
            .map(finishPob)
            .sort((a, b) => b.value - a.value);

    // One row per order for the detail table.
    const orders = groupBy(
        rows,
        (row) => row.OrderId,
        (row) => ({
            OrderId: row.OrderId,
            OrderNumber: row.OrderNumber,
            OrderDate: row.OrderDate,
            EmployeeName: row.EmployeeName,
            CustomerType: row.CustomerType,
            CustomerName: row.CustomerName,
            TerritoryName: row.TerritoryName,
            StockistName: row.StockistName,
            Status: row.Status,
            products: [],
            units: 0,
            freeUnits: 0,
            value: 0,
        }),
        (acc, row) => {
            acc.products.push(row.ProductName);
            acc.units += number(row.Quantity);
            acc.freeUnits += number(row.FreeQuantity);
            acc.value = money(acc.value + (Number(row.NetAmount) || 0));
        }
    );

    return {
        filters: filtersOut(inputs),
        kpis,
        employees: by((row) => row.EmployeeName, (row) => row.EmployeeName),
        products: by((row) => row.ProductId, (row) => row.ProductName),
        customers: by((row) => `${row.CustomerType}|${row.CustomerName}`, (row) => row.CustomerName).slice(0, 20),
        months: monthsBetween(inputs.FromDate, inputs.ToDate).map((month) => {
            const subset = rows.filter((row) => row.OrderMonth === month);
            const acc = pobAggregate();
            subset.forEach((row) => addPob(acc, row));
            return { month, ...finishPob(acc) };
        }),
        orders,
        truncated,
        rowLimit,
    };
};

// =========================================================
// Sales (secondary vs target)
// =========================================================

const loadSales = async (inputs) => {
    const withMonth = withMonths(inputs);
    const [lines, targets] = await Promise.all([
        ReportsDA.optional(ReportsDA.getSecondaryLines({ ...withMonth, Limit: DETAIL_LIMIT })),
        ReportsDA.optional(ReportsDA.getTargets(withMonth)),
    ]);

    return { ...capped(lines || []), targets: targets || [] };
};

const salesRow = (key, label) => ({ key, label, qty: 0, value: 0, targetQty: 0, targetValue: 0, closingValue: 0 });

const finishSales = (row) => ({
    ...row,
    value: money(row.value),
    targetValue: money(row.targetValue),
    closingValue: money(row.closingValue),
    achievement: percent(row.value, row.targetValue),
});

exports.getSalesReport = async (actingUserId, query) => {
    const inputs = await resolveFilters(actingUserId, query, { product: true });
    const { rows, targets, truncated, rowLimit } = await loadSales(inputs);

    const build = (keyOfLine, keyOfTarget, labelOfLine, labelOfTarget) => {
        const map = new Map();
        const get = (key, label) => {
            if (!map.has(key)) map.set(key, salesRow(key, label));
            return map.get(key);
        };
        rows.forEach((row) => {
            const acc = get(keyOfLine(row), labelOfLine(row));
            acc.qty += number(row.SalesQty);
            acc.value += Number(row.SalesValue) || 0;
            acc.closingValue += Number(row.ClosingValue) || 0;
        });
        if (keyOfTarget) {
            targets.forEach((row) => {
                const acc = get(keyOfTarget(row), labelOfTarget(row));
                acc.targetQty += number(row.TargetQty);
                acc.targetValue += Number(row.TargetValue) || 0;
            });
        }
        return [...map.values()].map(finishSales).sort((a, b) => b.value - a.value || b.targetValue - a.targetValue);
    };

    const nameById = new Map(rows.map((row) => [String(row.UserId).toLowerCase(), row.EmployeeName]));
    const { users } = await getScopeUsers(actingUserId);
    users.forEach((user) => nameById.set(String(user.UserId).toLowerCase(), user.Name));

    const employees = build(
        (row) => String(row.UserId).toLowerCase(),
        (row) => String(row.UserId).toLowerCase(),
        (row) => row.EmployeeName,
        (row) => nameById.get(String(row.UserId).toLowerCase()) || '—'
    );
    const products = build((row) => row.ProductId, (row) => row.ProductId, (row) => row.ProductName, (row) => row.ProductName);
    const stockists = build((row) => row.StockistId, null, (row) => row.StockistName || '—');
    const months = monthsBetween(inputs.FromDate, inputs.ToDate).map((month) => {
        const acc = salesRow(month, month);
        rows.filter((row) => row.SalesMonth === month).forEach((row) => {
            acc.qty += number(row.SalesQty);
            acc.value += Number(row.SalesValue) || 0;
            acc.closingValue += Number(row.ClosingValue) || 0;
        });
        targets.filter((row) => row.TargetMonth === month).forEach((row) => {
            acc.targetQty += number(row.TargetQty);
            acc.targetValue += Number(row.TargetValue) || 0;
        });
        return { month, ...finishSales(acc) };
    });

    const value = rows.reduce((sum, row) => sum + (Number(row.SalesValue) || 0), 0);
    const targetValue = targets.reduce((sum, row) => sum + (Number(row.TargetValue) || 0), 0);

    return {
        filters: filtersOut(inputs),
        kpis: {
            value: money(value),
            qty: rows.reduce((sum, row) => sum + number(row.SalesQty), 0),
            targetValue: money(targetValue),
            achievement: percent(value, targetValue),
            stockists: new Set(rows.map((row) => row.StockistId)).size,
            closingValue: money(months.length ? months[months.length - 1].closingValue : 0),
        },
        employees,
        products,
        stockists,
        months,
        rows,
        truncated,
        rowLimit,
    };
};

// =========================================================
// KPI scorecard (per employee)
// =========================================================

// Green at or above `good`, amber at or above `fair`, red below.
const KPI_THRESHOLDS = {
    callAverage: { good: 8, fair: 5 },
    coveragePercent: { good: 80, fair: 60 },
    gpsPercent: { good: 90, fair: 70 },
    inPlanPercent: { good: 80, fair: 60 },
    dcrPercent: { good: 90, fair: 70 },
    achievement: { good: 100, fair: 80 },
};

const buildScorecard = async (actingUserId, inputs) => {
    const [calls, assignments, pob, sales] = await Promise.all([
        ReportsDA.getCallsByEmployee(inputs),
        loadAssignments(inputs),
        loadPob({ ...inputs, ProductId: null }),
        loadSales({ ...inputs, ProductId: null }),
    ]);

    const key = (id) => String(id).toLowerCase();
    const coverageByUser = new Map(
        groupBy(assignments.rows, (row) => key(row.UserId), (row) => ({ id: key(row.UserId), rows: [] }), (acc, row) => acc.rows.push(row)).map((item) => [item.id, coverageSummary(item.rows)])
    );
    const pobByUser = new Map(groupBy(pob.rows, (row) => key(row.UserId), (row) => ({ id: key(row.UserId), ...pobAggregate() }), addPob).map((item) => [item.id, finishPob(item)]));
    const salesByUser = new Map();
    sales.rows.forEach((row) => salesByUser.set(key(row.UserId), (salesByUser.get(key(row.UserId)) || 0) + (Number(row.SalesValue) || 0)));
    const targetByUser = new Map();
    sales.targets.forEach((row) => targetByUser.set(key(row.UserId), (targetByUser.get(key(row.UserId)) || 0) + (Number(row.TargetValue) || 0)));

    return calls.map((row) => {
        const id = key(row.UserId);
        const callCount = number(row.Calls);
        const fieldDays = number(row.FieldDays);
        const dcrTotal = number(row.DcrApproved) + number(row.DcrPending) + number(row.DcrReturned);
        const coverage = coverageByUser.get(id);
        const orders = pobByUser.get(id);
        const secondary = money(salesByUser.get(id) || 0);
        const target = money(targetByUser.get(id) || 0);

        const scored = {
            callAverage: fieldDays ? round1(callCount / fieldDays) : null,
            coveragePercent: coverage?.coveragePercent ?? null,
            gpsPercent: percent(number(row.WithGps), callCount),
            inPlanPercent: percent(number(row.InPlan), callCount),
            dcrPercent: percent(number(row.DcrApproved), dcrTotal),
            achievement: percent(secondary, target),
        };

        // Overall score: average of the percentage KPIs that have data (achievement capped at 100).
        const parts = ['coveragePercent', 'gpsPercent', 'inPlanPercent', 'dcrPercent', 'achievement']
            .map((field) => scored[field])
            .filter((value) => value != null)
            .map((value) => Math.min(100, value));

        return {
            UserId: row.UserId,
            Name: row.Name,
            DesignationName: row.DesignationName,
            ManagerName: row.ManagerName,
            calls: callCount,
            fieldDays,
            doctorsMet: number(row.Doctors),
            assignments: coverage?.assignments ?? 0,
            pobValue: orders?.value ?? 0,
            secondaryValue: secondary,
            targetValue: target,
            dcrApproved: number(row.DcrApproved),
            ...scored,
            score: parts.length ? Math.round(parts.reduce((sum, value) => sum + value, 0) / parts.length) : null,
        };
    });
};

exports.getKpiReport = async (actingUserId, query) => {
    const inputs = await resolveFilters(actingUserId, query);
    const employees = (await buildScorecard(actingUserId, inputs)).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    const average = (field) => {
        const values = employees.map((row) => row[field]).filter((value) => value != null);
        return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
    };

    return {
        filters: filtersOut(inputs),
        thresholds: KPI_THRESHOLDS,
        kpis: {
            score: average('score'),
            coveragePercent: average('coveragePercent'),
            gpsPercent: average('gpsPercent'),
            achievement: average('achievement'),
            employees: employees.length,
        },
        employees,
    };
};

// =========================================================
// MIS (period summary, month by month) and Graphical
// =========================================================

const loadMis = async (actingUserId, inputs) => {
    const withMonth = withMonths(inputs);
    const [totals, monthlyCalls, assignments, pob, sales, engagement, expenses, feedback, scorecard] = await Promise.all([
        ReportsDA.getCallTotals(inputs),
        ReportsDA.getCallsByMonth(inputs),
        loadAssignments(inputs),
        loadPob({ ...inputs, ProductId: null }),
        loadSales({ ...inputs, ProductId: null }),
        ReportsDA.optional(ReportsDA.getEngagementTotals(inputs)),
        ReportsDA.optional(ReportsDA.getExpensesByMonth(withMonth)),
        ReportsDA.getFeedbackSplit(inputs),
        buildScorecard(actingUserId, inputs),
    ]);

    const callsByMonth = new Map(monthlyCalls.map((row) => [row.VisitMonth, row]));
    const expensesByMonth = new Map((expenses || []).map((row) => [row.ClaimMonth, row]));

    const months = monthsBetween(inputs.FromDate, inputs.ToDate).map((month) => {
        const call = callsByMonth.get(month);
        const pobAcc = pobAggregate();
        pob.rows.filter((row) => row.OrderMonth === month).forEach((row) => addPob(pobAcc, row));
        const orders = finishPob(pobAcc);
        const secondary = sales.rows.filter((row) => row.SalesMonth === month).reduce((sum, row) => sum + (Number(row.SalesValue) || 0), 0);
        const target = sales.targets.filter((row) => row.TargetMonth === month).reduce((sum, row) => sum + (Number(row.TargetValue) || 0), 0);
        const expense = expensesByMonth.get(month);

        return {
            month,
            calls: number(call?.Calls),
            doctors: number(call?.Doctors),
            fieldDays: number(call?.FieldDays),
            pobValue: orders.value,
            pobSupplied: orders.supplied,
            secondaryValue: money(secondary),
            targetValue: money(target),
            achievement: percent(secondary, target),
            expenseClaimed: money(expense?.Claimed),
            expenseApproved: money(expense?.Approved),
        };
    });

    const calls = number(totals?.Calls);
    const fieldDays = number(totals?.FieldDays);
    const coverage = coverageSummary(assignments.rows);
    const pobTotal = pobAggregate();
    pob.rows.forEach((row) => addPob(pobTotal, row));
    const orders = finishPob(pobTotal);
    const secondary = months.reduce((sum, row) => sum + row.secondaryValue, 0);
    const target = months.reduce((sum, row) => sum + row.targetValue, 0);

    return {
        months,
        assignments,
        feedback,
        scorecard,
        summary: {
            field: {
                calls,
                doctorsMet: number(totals?.Doctors),
                fieldDays,
                callAverage: fieldDays ? round1(calls / fieldDays) : null,
                coveragePercent: coverage.coveragePercent,
                compliancePercent: coverage.compliancePercent,
            },
            quality: {
                gpsPercent: percent(number(totals?.WithGps), calls),
                inPlanPercent: percent(number(totals?.InPlan), calls),
                jointCalls: number(totals?.JointCalls),
                avgMinutes: totals?.AvgMinutes == null ? null : Math.round(totals.AvgMinutes),
            },
            engagement: {
                samplesGiven: engagement ? number(engagement[0]?.SamplesGiven) : null,
                giftsGiven: engagement ? number(engagement[0]?.GiftsGiven) : null,
                rcpaAudits: engagement ? number(engagement[0]?.RcpaAudits) : null,
            },
            business: {
                pobValue: orders.value,
                pobSupplied: orders.supplied,
                pobOrders: orders.orders,
                secondaryValue: money(secondary),
                targetValue: money(target),
                achievement: percent(secondary, target),
            },
            expenses: {
                claimed: money(months.reduce((sum, row) => sum + row.expenseClaimed, 0)),
                approved: money(months.reduce((sum, row) => sum + row.expenseApproved, 0)),
            },
        },
    };
};

exports.getMisReport = async (actingUserId, query) => {
    const inputs = await resolveFilters(actingUserId, query);
    const mis = await loadMis(actingUserId, inputs);

    return { filters: filtersOut(inputs), summary: mis.summary, months: mis.months, employees: mis.scorecard };
};

exports.getGraphReport = async (actingUserId, query) => {
    const inputs = await resolveFilters(actingUserId, query);
    const mis = await loadMis(actingUserId, inputs);

    const byCategory = CATEGORY_ORDER.map((category) => {
        const subset = mis.assignments.rows.filter((row) => (row.Category || 'U') === category);
        return { category, ...coverageSummary(subset) };
    }).filter((row) => row.assignments > 0);

    return {
        filters: filtersOut(inputs),
        summary: mis.summary,
        months: mis.months,
        coverageByCategory: byCategory,
        feedback: mis.feedback.map((row) => ({ feedback: row.Feedback, calls: number(row.Calls) })),
        topEmployees: [...mis.scorecard].sort((a, b) => b.calls - a.calls).slice(0, 10).map((row) => ({ Name: row.Name, calls: row.calls, pobValue: row.pobValue, secondaryValue: row.secondaryValue })),
    };
};

// KPI report score for one employee over a period (used by appraisals).
exports.kpiScoreFor = async (userId, from, to) => {
    const rows = await buildScorecard(userId, { ActingUserId: userId, ViewAll: 0, FromDate: from, ToDate: to, UserId: userId, TerritoryId: null });
    return rows.find((row) => String(row.UserId).toLowerCase() === String(userId).toLowerCase()) || null;
};
