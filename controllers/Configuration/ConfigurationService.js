const ConfigurationDA = require('./ConfigurationDA');
const { customQuery } = require('../../utils/dbFunctions');

exports.getSummary = async () => {
    const row = await ConfigurationDA.getSummary();

    // COUNT() can come back as strings for bigint; normalise to numbers.
    const summary = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value) || 0]));

    // Catalogue tables are optional until their schema has been run.
    try {
        const [catalogue] = await customQuery(
            'SELECT (SELECT COUNT(*) FROM dbo.Products WHERE IsActive = 1) AS Products, (SELECT COUNT(*) FROM dbo.Gifts WHERE IsActive = 1) AS Gifts'
        );
        summary.Products = Number(catalogue.Products) || 0;
        summary.Gifts = Number(catalogue.Gifts) || 0;
    } catch {
        summary.Products = null;
        summary.Gifts = null;
    }

    return summary;
};
