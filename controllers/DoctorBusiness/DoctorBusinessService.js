const DoctorBusinessDA = require('./DoctorBusinessDA');

const { generateUUID } = require('../../utils/commonUtils');
const {
    fail,
    isGuid,
    optionalText,
    requireActingUser,
    resolveViewUser,
    sameId,
    todayKey,
    toMonthStart,
} = require('../../utils/access');

const HISTORY_MONTHS = 6;
const MAX_FUTURE_MONTHS = 1;
const MAX_PAST_MONTHS = 12;
const MAX_VALUE = 9999999999;

const shiftMonth = (monthStart, delta) => {
    const date = new Date(`${monthStart}T00:00:00`);
    return todayKey(new Date(date.getFullYear(), date.getMonth() + delta, 1));
};

const money = (value) => (value == null ? null : Number(value));

const toAmount = (value, label, required) => {
    if (value === '' || value == null) {
        if (required) throw fail(400, `${label} is required.`);
        return null;
    }

    const amount = Number(value);

    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_VALUE) {
        throw fail(400, `${label} must be a positive amount.`);
    }

    return Math.round(amount * 100) / 100;
};

exports.getMonth = async (actingUserId, query) => {
    const userId = await resolveViewUser(actingUserId, query.userId, 'doctor business');
    const month = toMonthStart(query.month || todayKey().slice(0, 7));

    const [rows, history] = await Promise.all([
        DoctorBusinessDA.getMonth(userId, month, shiftMonth(month, -1)),
        DoctorBusinessDA.getHistory(userId, shiftMonth(month, -(HISTORY_MONTHS - 1)), month),
    ]);

    const doctors = rows.map((row) => ({
        ...row,
        ExpectedValue: money(row.ExpectedValue),
        ActualValue: money(row.ActualValue),
        PreviousActual: money(row.PreviousActual),
    }));

    const expected = doctors.reduce((sum, row) => sum + (row.ExpectedValue || 0), 0);
    const actual = doctors.reduce((sum, row) => sum + (row.ActualValue || 0), 0);
    const previous = doctors.reduce((sum, row) => sum + (row.PreviousActual || 0), 0);

    // Zero-filled history so every month appears.
    const byMonth = new Map(history.map((row) => [row.BusinessMonth, row]));
    const trend = Array.from({ length: HISTORY_MONTHS }, (_, index) => {
        const key = shiftMonth(month, index - (HISTORY_MONTHS - 1));
        const row = byMonth.get(key);
        return { month: key, expected: money(row?.Expected) || 0, actual: money(row?.Actual) || 0 };
    });

    return {
        month,
        editable: sameId(userId, actingUserId),
        summary: {
            doctors: doctors.length,
            planned: doctors.filter((row) => row.EntryId).length,
            expected,
            actual,
            previousActual: previous,
            achievement: expected ? Math.round((actual / expected) * 100) : null,
        },
        trend,
        doctors,
    };
};

exports.saveEntry = async (actingUserId, payload) => {
    requireActingUser(actingUserId);

    if (!isGuid(payload.DoctorId)) throw fail(400, 'Doctor is required.');

    const month = toMonthStart(payload.BusinessMonth, 'Business month');
    const current = `${todayKey().slice(0, 8)}01`;

    if (month > shiftMonth(current, MAX_FUTURE_MONTHS)) {
        throw fail(400, 'You can plan at most one month ahead.');
    }

    if (month < shiftMonth(current, -MAX_PAST_MONTHS)) {
        throw fail(400, `Business older than ${MAX_PAST_MONTHS} months cannot be changed.`);
    }

    if (!(await DoctorBusinessDA.isDoctorMapped(actingUserId, payload.DoctorId))) {
        throw fail(400, 'This doctor is not assigned to you.');
    }

    const actual = toAmount(payload.ActualValue, 'Actual value', false);

    if (actual != null && month > current) {
        throw fail(400, 'Actual value can only be entered for the current or past months.');
    }

    await DoctorBusinessDA.upsert({
        EntryId: generateUUID(),
        UserId: actingUserId,
        DoctorId: payload.DoctorId,
        BusinessMonth: month,
        ExpectedValue: toAmount(payload.ExpectedValue, 'Expected value', true),
        ActualValue: actual,
        Remarks: optionalText(payload.Remarks, 300, 'Remarks'),
        Now: new Date(),
    });

    return { message: 'Doctor business saved.' };
};
