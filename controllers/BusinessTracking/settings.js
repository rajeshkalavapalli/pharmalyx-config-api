// Company rule values for business tracking (dbo.AntiFraudSettings), with defaults.
const { customQuery } = require('../../utils/dbFunctions');
const { DEFAULTS } = require('./rules');

exports.loadSettings = async () => {
    try {
        const rows = await customQuery('SELECT SettingKey, SettingValue FROM dbo.AntiFraudSettings');
        const saved = Object.fromEntries(rows.map((row) => [row.SettingKey, Number(row.SettingValue)]).filter(([key, value]) => key in DEFAULTS && Number.isFinite(value)));
        return { ...DEFAULTS, ...saved };
    } catch {
        return { ...DEFAULTS };
    }
};
