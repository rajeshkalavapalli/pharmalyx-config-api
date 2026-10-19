// Company rule values for the field ledger and doctor spend (dbo.AntiFraudSettings), with defaults.
const { customQuery } = require('../../utils/dbFunctions');
const { DEFAULTS } = require('./rules');

const SPEND_DEFAULTS = { SPEND_ON_TRACK_PCT: 90, SPEND_PARTLY_PCT: 50 };
const ALL = { ...DEFAULTS, ...SPEND_DEFAULTS };

exports.loadSettings = async () => {
    try {
        const rows = await customQuery('SELECT SettingKey, SettingValue FROM dbo.AntiFraudSettings');
        const saved = Object.fromEntries(rows.map((row) => [row.SettingKey, Number(row.SettingValue)]).filter(([key, value]) => key in ALL && Number.isFinite(value)));
        return { ...ALL, ...saved };
    } catch {
        return { ...ALL };
    }
};

exports.DEFAULTS = ALL;
