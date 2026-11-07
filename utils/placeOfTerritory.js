const { customQuery } = require('./dbFunctions');
const { fail, isGuid } = require('./access');

// Doctors, pharmacies and stockists must have a country and state (NOT NULL in the database).
// Screens that only ask for territory + area (the phone app's "Add doctor") leave them out,
// so they are taken from the territory's state here instead of failing the save.
const TERRITORY_PLACE = `
    SELECT TOP 1 t.StateId, s.CountryId
    FROM dbo.Territory t
    LEFT JOIN dbo.state s ON s.StateId = t.StateId
    WHERE t.TerritoryId = TRY_CONVERT(UNIQUEIDENTIFIER, @TerritoryId)`;

const STATE_COUNTRY = `SELECT TOP 1 CountryId FROM dbo.state WHERE StateId = TRY_CONVERT(UNIQUEIDENTIFIER, @StateId)`;

const upper = (id) => (id ? String(id).toUpperCase() : null);
const given = (id) => (id && isGuid(id) ? upper(id) : null);

// Returns { CountryId, StateId }: the ones sent, else the territory's. Throws a clear 400 when neither has them.
const placeOfTerritory = async ({ CountryId, StateId, TerritoryId }) => {
    let country = given(CountryId);
    let state = given(StateId);

    if (!state && isGuid(TerritoryId)) {
        const [row] = await customQuery(TERRITORY_PLACE, { TerritoryId: String(TerritoryId) });
        state = upper(row?.StateId);
        if (!country) country = upper(row?.CountryId);
    }
    if (state && !country) {
        const [row] = await customQuery(STATE_COUNTRY, { StateId: state });
        country = upper(row?.CountryId);
    }

    if (!country || !state) {
        throw fail(400, "Country and state are missing. Choose them, or ask the admin to set this territory's state.");
    }
    return { CountryId: country, StateId: state };
};

// Pharmacy / stockist: the columns the database needs, checked before saving so the screen gets a clear reason.
const OUTLET_REQUIRED = [
    ['OwnerName', 'Owner name'],
    ['ContactNumber', 'Phone number'],
    ['Address', 'Address'],
    ['TerritoryId', 'Territory'],
    ['AreaId', 'Area'],
];

const checkOutlet = async (record, nameColumn, nameLabel) => {
    const blank = (value) => value == null || String(value).trim() === '';
    const missing = [[nameColumn, nameLabel], ...OUTLET_REQUIRED].filter(([column]) => blank(record[column])).map(([, label]) => label);
    if (missing.length) throw fail(400, `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required.`);
    // Optional columns the INSERT / UPDATE names: missing ones become empty instead of a SQL error.
    const optional = { EmailId: null, DrugLicenceNumber: null, GSTIN: null, IsActive: 'Yes' };
    Object.keys(optional).forEach((column) => {
        if (record[column] !== undefined && record[column] !== '') optional[column] = record[column];
    });
    return { ...record, ...optional, ...(await placeOfTerritory(record)) };
};

module.exports = { placeOfTerritory, checkOutlet };
