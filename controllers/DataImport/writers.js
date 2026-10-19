// How each import type is written to the database.
// `columns`: [column, SQL type, (values, extra) => value]. Values come from validate.js.
// `update`:  columns an UPDATE may change. Blank file cells keep the current value.
// `children`: rows owned by the record (removed with it on undo), added if missing.
// A 4th column entry names a database feature the column needs (see ImportDA.loadContext).
//
// Table and column names here are fixed text, never from the uploaded file.
const { normalizeName } = require('../../utils/doctorMatching');

const yesNo = (active) => (active === false ? 'No' : 'Yes');
const idOf = (item) => item?.id ?? null;
const stateOf = (v) => v.territory?.stateId ?? null;
const countryOf = (v) => v.territory?.countryId ?? null;
const text = (value) => (value === undefined || value === '' ? null : value);

const outletColumns = (nameColumn) => [
    [nameColumn, 'NVARCHAR(100)', (v) => v.name],
    ['OwnerName', 'NVARCHAR(100)', (v, x) => (x.creating ? v.owner || '' : text(v.owner))],
    ['ContactNumber', 'NVARCHAR(50)', (v, x) => (x.creating ? v.contact || '' : text(v.contact))],
    ['EmailId', 'NVARCHAR(50)', (v) => text(v.email)],
    ['DrugLicenceNumber', 'NVARCHAR(50)', (v) => text(v.drugLicence)],
    ['GSTIN', 'NVARCHAR(50)', (v) => text(v.gstin)],
    ['CountryId', 'UNIQUEIDENTIFIER', countryOf],
    ['StateId', 'UNIQUEIDENTIFIER', stateOf],
    ['TerritoryId', 'UNIQUEIDENTIFIER', (v) => idOf(v.territory)],
    ['AreaId', 'UNIQUEIDENTIFIER', (v) => idOf(v.area)],
    ['Address', 'NVARCHAR(350)', (v, x) => (x.creating ? v.address || '' : text(v.address))],
    ['IsActive', 'VARCHAR(3)', (v) => yesNo(v.active)],
];

const WRITERS = {
    TERRITORY: {
        table: 'dbo.Territory',
        idColumn: 'TerritoryId',
        label: (v) => v.name,
        columns: [
            ['TerritoryName', 'VARCHAR(250)', (v) => v.name],
            ['StateId', 'UNIQUEIDENTIFIER', (v) => idOf(v.state)],
            ['IsActive', 'BIT', (v) => v.active !== false],
        ],
        update: ['StateId', 'IsActive'],
        children: [
            {
                table: 'dbo.TerritoryDivisionMapping',
                rows: (v, id) => (v.divisions || []).map((d) => ({ TerritoryId: id, DivisionId: d.id })),
                columns: [['TerritoryId', 'UNIQUEIDENTIFIER'], ['DivisionId', 'UNIQUEIDENTIFIER']],
                insert: `
                    INSERT INTO dbo.TerritoryDivisionMapping (TerritoryDivisionMappingId, TerritoryId, DivisionId, IsActive, CreatedOn, ModifiedOn)
                    SELECT NEWID(), j.TerritoryId, j.DivisionId, 1, @Now, @Now
                    FROM OPENJSON(@Rows) WITH (TerritoryId UNIQUEIDENTIFIER, DivisionId UNIQUEIDENTIFIER) j
                    WHERE NOT EXISTS (SELECT 1 FROM dbo.TerritoryDivisionMapping m WHERE m.TerritoryId = j.TerritoryId AND m.DivisionId = j.DivisionId)`,
                ownerColumn: 'TerritoryId',
            },
        ],
        referenceColumns: ['TerritoryId'],
    },

    AREA: {
        table: 'dbo.Areas',
        idColumn: 'AreaId',
        label: (v) => `${v.name} (${v.territory?.label || ''})`,
        columns: [
            ['TerritoryId', 'UNIQUEIDENTIFIER', (v) => idOf(v.territory)],
            ['AreaName', 'NVARCHAR(240)', (v) => v.name],
            ['AreaCode', 'NVARCHAR(240)', (v, x) => v.code || (x.creating ? x.nextAreaCode(v.name) : null)],
            ['IsActive', 'VARCHAR(4)', (v) => (v.active === false ? 'NO' : 'YES')],
        ],
        update: ['IsActive'],
        children: [],
        referenceColumns: ['AreaId'],
    },

    USER: {
        table: 'dbo.Users',
        idColumn: 'UserId',
        label: (v) => v.userName,
        // ManagerId is set in a second step, once every user in the file exists.
        columns: [
            ['UserName', 'VARCHAR(100)', (v) => v.userName],
            ['FirstName', 'VARCHAR(100)', (v) => v.firstName],
            ['LastName', 'VARCHAR(100)', (v) => text(v.lastName)],
            ['EmailId', 'VARCHAR(100)', (v) => text(v.email)],
            ['MobileNumber', 'VARCHAR(50)', (v) => text(v.mobile)],
            ['DesignationId', 'UNIQUEIDENTIFIER', (v) => idOf(v.designation)],
            ['RoleId', 'UNIQUEIDENTIFIER', (v) => idOf(v.role)],
            ['DivisionId', 'UNIQUEIDENTIFIER', (v) => idOf(v.division)],
            ['TerritoryId', 'UNIQUEIDENTIFIER', (v) => idOf(v.territories?.[0])],
            ['IsActive', 'BIT', (v) => v.active !== false],
            ['ManagerId', 'UNIQUEIDENTIFIER', () => null],
        ],
        update: ['ManagerId', 'FirstName', 'LastName', 'EmailId', 'MobileNumber', 'DesignationId', 'RoleId', 'DivisionId', 'IsActive'],
        children: [
            {
                table: 'dbo.UserTerritoryMapping',
                rows: (v, id) => (v.territories || []).map((t) => ({ UserId: id, TerritoryId: t.id })),
                insert: `
                    INSERT INTO dbo.UserTerritoryMapping (UserId, TerritoryId, CreatedOn, ModifiedOn)
                    SELECT j.UserId, j.TerritoryId, @Now, @Now
                    FROM OPENJSON(@Rows) WITH (UserId UNIQUEIDENTIFIER, TerritoryId UNIQUEIDENTIFIER) j
                    WHERE NOT EXISTS (SELECT 1 FROM dbo.UserTerritoryMapping m WHERE m.UserId = j.UserId AND m.TerritoryId = j.TerritoryId)`,
                ownerColumn: 'UserId',
            },
            {
                table: 'dbo.UserStateMapping',
                rows: (v, id) =>
                    [...new Set((v.territories || []).map((t) => t.stateId).filter(Boolean).map(String))].map((StateId) => ({ UserId: id, StateId })),
                insert: `
                    INSERT INTO dbo.UserStateMapping (UserId, StateId, CreatedOn, ModifiedOn)
                    SELECT j.UserId, j.StateId, @Now, @Now
                    FROM OPENJSON(@Rows) WITH (UserId UNIQUEIDENTIFIER, StateId UNIQUEIDENTIFIER) j
                    WHERE NOT EXISTS (SELECT 1 FROM dbo.UserStateMapping m WHERE m.UserId = j.UserId AND m.StateId = j.StateId)`,
                ownerColumn: 'UserId',
            },
        ],
        referenceColumns: ['UserId', 'ManagerId'],
        includeActors: true,
    },

    DOCTOR: {
        table: 'dbo.Doctor',
        idColumn: 'DoctorId',
        label: (v) => v.name,
        columns: [
            ['DoctorName', 'NVARCHAR(250)', (v) => v.name],
            ['NormalizedName', 'NVARCHAR(200)', (v) => normalizeName(v.name).slice(0, 200)],
            ['Qualification', 'NVARCHAR(500)', (v) => text(v.qualification)],
            ['Speciality', 'NVARCHAR(250)', (v) => text(v.speciality)],
            ['HospitalName', 'NVARCHAR(250)', (v) => text(v.hospital)],
            ['ClinicAddress', 'NVARCHAR(500)', (v) => text(v.address), 'clinicAddress'],
            ['MobileNumber', 'VARCHAR(20)', (v) => text(v.mobile)],
            ['EmailId', 'NVARCHAR(250)', (v) => text(v.email)],
            ['RegistrationNumber', 'VARCHAR(40)', (v) => text(v.registrationNumber)],
            ['RegistrationCouncil', 'NVARCHAR(100)', (v) => text(v.registrationCouncil)],
            ['Category', 'CHAR(1)', (v) => text(v.category)],
            ['VisitsPerMonth', 'TINYINT', (v) => v.visitsPerMonth ?? null],
            ['DateOfBirth', 'DATE', (v) => v.dateOfBirth ?? null],
            ['AnniversaryDate', 'DATE', (v) => v.anniversary ?? null],
            // Older columns stored as text.
            ['CountryId', 'VARCHAR(50)', (v) => countryOf(v) && String(countryOf(v))],
            ['StateId', 'VARCHAR(50)', (v) => stateOf(v) && String(stateOf(v))],
            ['TerritoryId', 'VARCHAR(50)', (v) => idOf(v.territory) && String(idOf(v.territory))],
            ['AreaId', 'VARCHAR(50)', (v) => idOf(v.area) && String(idOf(v.area))],
            ['IsActive', 'VARCHAR(3)', (v) => yesNo(v.active)],
            // New doctors only: approved master data, still to be verified in the field.
            ['ApprovalStatus', 'VARCHAR(10)', (v, x) => (x.creating ? 'APPROVED' : null)],
            ['VerificationStatus', 'VARCHAR(12)', (v, x) => (x.creating ? 'PROVISIONAL' : null)],
            ['Source', 'VARCHAR(10)', (v, x) => (x.creating ? 'IMPORT' : null)],
            ['CreatedBy', 'UNIQUEIDENTIFIER', (v, x) => (x.creating ? x.actorId : null)],
        ],
        update: [
            'Qualification', 'Speciality', 'HospitalName', 'ClinicAddress', 'MobileNumber', 'EmailId', 'RegistrationNumber', 'RegistrationCouncil',
            'Category', 'VisitsPerMonth', 'DateOfBirth', 'AnniversaryDate', 'CountryId', 'StateId', 'TerritoryId', 'AreaId', 'IsActive',
        ],
        children: [],
        referenceColumns: ['DoctorId', 'MergedIntoDoctorId'],
    },

    CHEMIST: {
        table: 'dbo.Pharmacy',
        idColumn: 'PharmacyId',
        label: (v) => v.name,
        columns: outletColumns('PharmacyName'),
        update: ['OwnerName', 'ContactNumber', 'EmailId', 'DrugLicenceNumber', 'GSTIN', 'CountryId', 'StateId', 'TerritoryId', 'AreaId', 'Address', 'IsActive'],
        children: [],
        referenceColumns: ['PharmacyId'],
    },

    STOCKIST: {
        table: 'dbo.Stockist',
        idColumn: 'StockistId',
        label: (v) => v.name,
        columns: outletColumns('StockistName'),
        update: ['OwnerName', 'ContactNumber', 'EmailId', 'DrugLicenceNumber', 'GSTIN', 'CountryId', 'StateId', 'TerritoryId', 'AreaId', 'Address', 'IsActive'],
        children: [
            {
                table: 'dbo.StockistTerritories',
                rows: (v, id) => (v.territory ? [{ StockistId: id, TerritoryId: v.territory.id }] : []),
                insert: `
                    INSERT INTO dbo.StockistTerritories (StockistId, TerritoryId, CreatedOn)
                    SELECT j.StockistId, j.TerritoryId, @Now
                    FROM OPENJSON(@Rows) WITH (StockistId UNIQUEIDENTIFIER, TerritoryId UNIQUEIDENTIFIER) j
                    WHERE NOT EXISTS (SELECT 1 FROM dbo.StockistTerritories s WHERE s.StockistId = j.StockistId AND s.TerritoryId = j.TerritoryId AND s.RemovedOn IS NULL)`,
                ownerColumn: 'StockistId',
            },
        ],
        referenceColumns: ['StockistId'],
    },

    // Lines of a stockist's monthly statement (the statement itself is written by the service).
    STATEMENT: {
        table: 'dbo.SecondaryStatementLines',
        idColumn: 'LineId',
        timestamps: false,
        label: (v) => v.product?.label,
        columns: [
            ['StatementId', 'UNIQUEIDENTIFIER', (v, x) => x.statementId],
            ['ProductId', 'UNIQUEIDENTIFIER', (v) => idOf(v.product)],
            ['OpeningQty', 'INT', (v) => v.opening],
            ['ReceiptQty', 'INT', (v) => v.receipts],
            ['SalesQty', 'INT', (v) => v.sales],
            ['ReturnQty', 'INT', (v) => v.returns],
            ['ClosingQty', 'INT', (v) => v.closing],
            ['UnitPrice', 'DECIMAL(18,2)', (v) => linePrice(v)],
            ['SalesValue', 'DECIMAL(18,2)', (v) => paise(linePrice(v) * v.sales)],
            ['ClosingValue', 'DECIMAL(18,2)', (v) => paise(linePrice(v) * v.closing)],
        ],
        update: [],
        children: [],
        referenceColumns: ['LineId'],
    },
};

// Statement lines: the rate in the file, else the product's price.
function linePrice(v) {
    return Number(v.rate ?? v.product?.price ?? 0);
}
function paise(rupees) {
    return Math.round(rupees * 100) / 100;
}

// The statement a STATEMENT import creates: approved history, owned by the stockist's MR.
const INSERT_STATEMENT_SQL = `
    INSERT INTO dbo.SecondaryStatements (StatementId, StockistId, StatementMonth, UserId, Status, TotalSalesQty, SalesValue, ClosingValue,
                                         Remarks, SubmittedOn, ReviewedBy, ReviewedOn, CreatedOn, ModifiedOn)
    VALUES (@StatementId, @StockistId, @StatementMonth, @UserId, 'APPROVED', @TotalSalesQty, @SalesValue, @ClosingValue,
            @Remarks, @Now, @ActorId, @Now, @Now, @Now)`;
const DELETE_STATEMENT_SQL = `
    DELETE FROM dbo.SecondaryStatements
    WHERE StatementId = @StatementId AND NOT EXISTS (SELECT 1 FROM dbo.SecondaryStatementLines l WHERE l.StatementId = @StatementId)`;

// ---------- SQL builders (names come only from WRITERS above) ----------

const withClause = (writer, names) =>
    [`${writer.idColumn} UNIQUEIDENTIFIER`, ...writer.columns.filter(([c]) => names.includes(c)).map(([c, type]) => `${c} ${type}`)].join(', ');

const insertSql = (writer) => {
    const names = writer.columns.map(([c]) => c);
    return `
        INSERT INTO ${writer.table} (${writer.idColumn}, ${names.join(', ')}${writer.timestamps === false ? '' : ', CreatedOn, ModifiedOn'})
        SELECT j.${writer.idColumn}, ${names.map((c) => `j.${c}`).join(', ')}${writer.timestamps === false ? '' : ', @Now, @Now'}
        FROM OPENJSON(@Rows) WITH (${withClause(writer, names)}) j`;
};

// Blank cells in the file keep what's there (COALESCE).
const updateSql = (writer) => `
    UPDATE t SET ${writer.update.map((c) => `t.${c} = COALESCE(j.${c}, t.${c})`).join(', ')}, t.ModifiedOn = @Now
    FROM ${writer.table} t
    INNER JOIN OPENJSON(@Rows) WITH (${withClause(writer, writer.update)}) j ON j.${writer.idColumn} = t.${writer.idColumn}`;

// Current values of the columns an update may change, saved for undo.
const previousSql = (writer) => `
    SELECT ${writer.idColumn} AS EntityId, ${writer.update.join(', ')}
    FROM ${writer.table}
    WHERE ${writer.idColumn} IN (SELECT CAST(value AS UNIQUEIDENTIFIER) FROM OPENJSON(@Ids))`;

// Undo of updates: put the saved values back exactly (including blanks).
const restoreSql = (writer) => `
    UPDATE t SET ${writer.update.map((c) => `t.${c} = p.${c}`).join(', ')}, t.ModifiedOn = @Now
    FROM ${writer.table} t
    INNER JOIN dbo.ImportRows r ON r.EntityId = t.${writer.idColumn} AND r.BatchId = @BatchId AND r.Action = 'UPDATED' AND r.PreviousData IS NOT NULL
    CROSS APPLY OPENJSON(r.PreviousData) WITH (${writer.columns.filter(([c]) => writer.update.includes(c)).map(([c, type]) => `${c} ${type}`).join(', ')}) p`;

const createdIdsSql = `SELECT EntityId FROM dbo.ImportRows WHERE BatchId = @BatchId AND Action = 'CREATED'`;

// Undo of creates: owned child rows first, then the records.
const deleteCreatedSql = (writer) =>
    [
        ...writer.children.map((child) => `DELETE FROM ${child.table} WHERE ${child.ownerColumn} IN (${createdIdsSql});`),
        `DELETE FROM ${writer.table} WHERE ${writer.idColumn} IN (${createdIdsSql});`,
    ].join('\n');

const bracket = (name) => `[${String(name).replace(/]/g, ']]')}]`;

// One query counting rows that still point at records this batch created.
// Rows of the batch's own table that were themselves created by it don't count (e.g. a manager imported with their team).
// `idsSql` lists the ids being removed (default: records the batch created).
const referenceCountSql = (writer, columns, idsSql = createdIdsSql) =>
    columns
        .map(({ tableName, columnName }) => {
            const own = `dbo.${tableName}`.toLowerCase() === writer.table.toLowerCase();
            const notSelf = own ? ` AND TRY_CONVERT(UNIQUEIDENTIFIER, x.${writer.idColumn}) NOT IN (${idsSql})` : '';
            return `SELECT '${tableName.replace(/'/g, "''")}' AS tableName, COUNT(*) AS n FROM dbo.${bracket(tableName)} x
                    WHERE TRY_CONVERT(UNIQUEIDENTIFIER, x.${bracket(columnName)}) IN (${idsSql})${notSelf}`;
        })
        .join('\nUNION ALL\n');

// Columns that need a database feature are left out until it exists.
const forFeatures = (writer, features = {}) => {
    const off = new Set(writer.columns.filter((c) => c[3] && !features[c[3]]).map(([column]) => column));
    if (!off.size) return writer;
    return { ...writer, columns: writer.columns.filter(([column]) => !off.has(column)), update: writer.update.filter((column) => !off.has(column)) };
};

// ---------- states, territories and areas created by an import ----------
// Created in this order (each needs the one before); removed in reverse on undo.
const MASTER_IDS_SQL = 'SELECT CAST(value AS UNIQUEIDENTIFIER) FROM OPENJSON(@MasterIds)';

const MASTERS = {
    STATE: {
        table: 'dbo.state',
        idColumn: 'StateId',
        record: (item) => ({ StateId: item.id, StateName: item.label, CountryId: item.countryId }),
        insert: `
            INSERT INTO dbo.state (StateId, StateName, StateCode, CountryId, IsActive, CreatedOn, ModifiedOn)
            SELECT j.StateId, j.StateName, NULL, j.CountryId, 1, @Now, @Now
            FROM OPENJSON(@Rows) WITH (StateId UNIQUEIDENTIFIER, StateName NVARCHAR(250), CountryId UNIQUEIDENTIFIER) j`,
        referenceColumns: ['StateId'],
    },
    TERRITORY: {
        table: 'dbo.Territory',
        idColumn: 'TerritoryId',
        record: (item) => ({ TerritoryId: item.id, TerritoryName: item.label, StateId: item.stateId }),
        insert: `
            INSERT INTO dbo.Territory (TerritoryId, TerritoryName, IsActive, CreatedOn, ModifiedOn, StateId)
            SELECT j.TerritoryId, j.TerritoryName, 1, @Now, @Now, j.StateId
            FROM OPENJSON(@Rows) WITH (TerritoryId UNIQUEIDENTIFIER, TerritoryName VARCHAR(250), StateId UNIQUEIDENTIFIER) j`,
        referenceColumns: ['TerritoryId'],
    },
    AREA: {
        table: 'dbo.Areas',
        idColumn: 'AreaId',
        record: (item, nextAreaCode) => ({ AreaId: item.id, TerritoryId: item.territoryId, AreaName: item.label, AreaCode: nextAreaCode(item.territoryId)(item.label) }),
        insert: `
            INSERT INTO dbo.Areas (AreaId, TerritoryId, AreaName, AreaCode, IsActive, CreatedOn, ModifiedOn)
            SELECT j.AreaId, j.TerritoryId, j.AreaName, j.AreaCode, 'YES', @Now, @Now
            FROM OPENJSON(@Rows) WITH (AreaId UNIQUEIDENTIFIER, TerritoryId UNIQUEIDENTIFIER, AreaName NVARCHAR(240), AreaCode NVARCHAR(240)) j`,
        referenceColumns: ['AreaId'],
    },
    // A stock & sales statement's stockist, from its letterhead.
    STOCKIST: {
        table: 'dbo.Stockist',
        idColumn: 'StockistId',
        owned: ['dbo.StockistTerritories'],
        record: (item) => ({
            StockistId: item.id,
            StockistName: item.label,
            ContactNumber: item.phone || '',
            EmailId: item.email ? item.email.slice(0, 50) : null,
            GSTIN: item.gstin,
            CountryId: item.territory.countryId,
            StateId: item.territory.stateId,
            TerritoryId: item.territory.id,
            AreaId: item.area.id,
            Address: item.address || '',
        }),
        insert: `
            INSERT INTO dbo.Stockist (StockistId, StockistName, OwnerName, ContactNumber, EmailId, DrugLicenceNumber, GSTIN, CountryId, StateId, TerritoryId, AreaId, Address, IsActive, CreatedOn, ModifiedOn)
            SELECT j.StockistId, j.StockistName, '', j.ContactNumber, j.EmailId, NULL, j.GSTIN, j.CountryId, j.StateId, j.TerritoryId, j.AreaId, j.Address, 'Yes', @Now, @Now
            FROM OPENJSON(@Rows) WITH (StockistId UNIQUEIDENTIFIER, StockistName NVARCHAR(100), ContactNumber NVARCHAR(50), EmailId NVARCHAR(50), GSTIN NVARCHAR(50),
                                       CountryId UNIQUEIDENTIFIER, StateId UNIQUEIDENTIFIER, TerritoryId UNIQUEIDENTIFIER, AreaId UNIQUEIDENTIFIER, Address NVARCHAR(350)) j;
            INSERT INTO dbo.StockistTerritories (StockistId, TerritoryId, CreatedOn)
            SELECT j.StockistId, j.TerritoryId, @Now FROM OPENJSON(@Rows) WITH (StockistId UNIQUEIDENTIFIER, TerritoryId UNIQUEIDENTIFIER) j;`,
        referenceColumns: ['StockistId'],
    },
    // A statement's products that weren't in the catalogue, priced at the statement's rate.
    PRODUCT: {
        table: 'dbo.Products',
        idColumn: 'ProductId',
        record: (item) => ({ ProductId: item.id, ProductName: item.label, UnitPrice: item.price ?? null }),
        insert: `
            INSERT INTO dbo.Products (ProductId, ProductName, UnitPrice, IsSample, IsActive, CreatedOn, ModifiedOn)
            SELECT j.ProductId, j.ProductName, j.UnitPrice, 0, 1, @Now, @Now
            FROM OPENJSON(@Rows) WITH (ProductId UNIQUEIDENTIFIER, ProductName NVARCHAR(150), UnitPrice DECIMAL(18,2)) j`,
        referenceColumns: ['ProductId'],
    },
};
const MASTER_ORDER = ['STATE', 'TERRITORY', 'AREA', 'STOCKIST', 'PRODUCT'];

// Owned rows (a stockist's territory links) go first.
const deleteMasterSql = (master) =>
    [
        ...(master.owned || []).map((table) => `DELETE FROM ${table} WHERE ${master.idColumn} IN (${MASTER_IDS_SQL});`),
        `DELETE FROM ${master.table} WHERE ${master.idColumn} IN (${MASTER_IDS_SQL});`,
    ].join(' ');

const SET_MANAGERS_SQL = `
    UPDATE u SET u.ManagerId = j.ManagerId, u.ModifiedOn = @Now
    FROM dbo.Users u INNER JOIN OPENJSON(@Rows) WITH (UserId UNIQUEIDENTIFIER, ManagerId UNIQUEIDENTIFIER) j ON j.UserId = u.UserId`;

module.exports = {
    WRITERS,
    INSERT_STATEMENT_SQL,
    DELETE_STATEMENT_SQL,
    MASTERS,
    MASTER_ORDER,
    MASTER_IDS_SQL,
    deleteMasterSql,
    forFeatures,
    insertSql,
    updateSql,
    previousSql,
    restoreSql,
    deleteCreatedSql,
    referenceCountSql,
    SET_MANAGERS_SQL,
};
