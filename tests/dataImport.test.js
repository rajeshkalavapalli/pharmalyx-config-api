// Data Import Center: file reading, column matching, row checks and SQL builders (no database).
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const { parseFile, parseCsvText } = require('../controllers/DataImport/parseFile');
const { suggestColumnMap, missingRequired } = require('../controllers/DataImport/columnMatch');
const { checkRows, parseDate } = require('../controllers/DataImport/validate');
const { buildContext } = require('../controllers/DataImport/context');
const W = require('../controllers/DataImport/writers');

const ID = {
    ap: 'a0000000-0000-0000-0000-000000000001',
    india: 'c0000000-0000-0000-0000-000000000001',
    ongole: 't0000000-0000-0000-0000-000000000001'.replace('t', 'e'),
    guntur: 'e0000000-0000-0000-0000-000000000002',
    chirala: 'f0000000-0000-0000-0000-000000000001',
    brodipet: 'f0000000-0000-0000-0000-000000000002',
    cardio: 'd0000000-0000-0000-0000-000000000001',
    bde: 'b0000000-0000-0000-0000-000000000001',
    asm: 'b0000000-0000-0000-0000-000000000002',
    fieldRole: 'r0000000-0000-0000-0000-000000000001'.replace('r', '9'),
    admin: '10000000-0000-0000-0000-000000000001',
    drRao: '20000000-0000-0000-0000-000000000001',
    drPrasad: '20000000-0000-0000-0000-000000000002',
};

const lists = (extra = {}) => ({
    states: [{ id: ID.ap, name: 'Andhra Pradesh', code: 'AP', CountryId: ID.india }],
    divisions: [{ id: ID.cardio, name: 'Cardio Care' }],
    designations: [
        { id: ID.bde, name: 'BDE', code: 'Bussines_Devlopment_Exicutive' },
        { id: ID.asm, name: 'ASM', code: 'AREA_SALES_MANAGER' },
    ],
    roles: [{ id: ID.fieldRole, name: 'Field User', code: 'FIELD_USER' }],
    territories: [
        { id: ID.ongole, name: 'Ongole', StateId: ID.ap, CountryId: ID.india },
        { id: ID.guntur, name: 'Guntur', StateId: ID.ap, CountryId: ID.india },
    ],
    areas: [
        { id: ID.chirala, name: 'Chirala', code: 'CHI-001', TerritoryId: ID.ongole, TerritoryName: 'Ongole' },
        { id: ID.brodipet, name: 'Brodipet', code: 'BRO-001', TerritoryId: ID.guntur, TerritoryName: 'Guntur' },
    ],
    users: [{ id: ID.admin, UserName: 'admin', EmailId: 'admin@pharmalyx.test', fullName: 'Admin User', ManagerId: null }],
    links: {},
    ...extra,
});

const rowsOf = (records) => records.map((values, i) => ({ rowNumber: i + 2, values }));
const identityMap = (headers) => Object.fromEntries(headers.map((h) => [h, h]));

// ---------------------------------------------------------
// Reading files
// ---------------------------------------------------------

test('CSV: quotes, commas inside quotes, semicolon files and blank lines', () => {
    const grid = parseCsvText('Name,Address\n"Sai Medicals","Main Rd, Chirala"\n\n"He said ""hi""",x\n');
    assert.deepEqual(grid[1].cells, ['Sai Medicals', 'Main Rd, Chirala']);
    assert.deepEqual(grid[3].cells, ['He said "hi"', 'x']);

    const semi = parseCsvText('Name;Mobile\nRao;9848012345\n');
    assert.deepEqual(semi[1].cells, ['Rao', '9848012345']);
});

test('xlsx: header found below a title row, duplicate headers renamed, blank rows dropped', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Doctors');
    sheet.addRow([]);
    sheet.addRow(['Dr Name', 'Mobile', 'Mobile']);
    sheet.addRow(['Dr. Suresh Rao', '9848012345', { formula: '1+1', result: 2 }]);
    sheet.addRow([]);
    sheet.addRow(['Dr. K. Prasad', '9440011223', '']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const { headers, rows } = await parseFile('doctors.xlsx', buffer);
    assert.deepEqual(headers, ['Dr Name', 'Mobile', 'Mobile (2)']);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].values['Mobile (2)'], '2');
    assert.equal(rows[1].rowNumber, 5);
});

test('file types: old .xls and unknown types are refused with a clear message', async () => {
    await assert.rejects(parseFile('old.xls', Buffer.from('x')), /save it as \.xlsx/);
    await assert.rejects(parseFile('notes.rtf', Buffer.from('x')), /Excel \(\.xlsx\), CSV, Word \(\.docx\) or PDF/);
});

test('dates: Indian dd-mm-yyyy, ISO, month names, Excel serials; impossible dates rejected', () => {
    assert.equal(parseDate('14-03-1972'), '1972-03-14');
    assert.equal(parseDate('14/03/1972'), '1972-03-14');
    assert.equal(parseDate('1972-03-14'), '1972-03-14');
    assert.equal(parseDate('14-Mar-1972'), '1972-03-14');
    assert.equal(parseDate('26372'), '1972-03-14');
    assert.equal(parseDate(new Date(Date.UTC(1972, 2, 14))), '1972-03-14');
    assert.equal(parseDate('31-02-1990'), null);
    assert.equal(parseDate('soon'), null);
});

// ---------------------------------------------------------
// Column matching
// ---------------------------------------------------------

test('column matching: common export headers find the right fields', () => {
    const map = suggestColumnMap('DOCTOR', ['Sl No', 'Dr Name', 'Speciality', 'HQ', 'Patch', 'Mobile No', 'Class', 'DOB', 'MCI No']);
    assert.equal(map.name, 'Dr Name');
    assert.equal(map.speciality, 'Speciality');
    assert.equal(map.territory, 'HQ');
    assert.equal(map.area, 'Patch');
    assert.equal(map.mobile, 'Mobile No');
    assert.equal(map.category, 'Class');
    assert.equal(map.dateOfBirth, 'DOB');
    assert.equal(map.registrationNumber, 'MCI No');
    assert.deepEqual(missingRequired('DOCTOR', map), []);
});

test('column matching: a specific header beats a generic one, and last time\'s matching wins', () => {
    const map = suggestColumnMap('CHEMIST', ['Name', 'Chemist Name', 'Area']);
    assert.equal(map.name, 'Chemist Name');

    const remembered = suggestColumnMap('CHEMIST', ['Name', 'Chemist Name', 'Area'], { name: 'Name' });
    assert.equal(remembered.name, 'Name');
});

// ---------------------------------------------------------
// Doctor checks
// ---------------------------------------------------------

const doctorHeaders = ['code', 'name', 'speciality', 'territory', 'area', 'mobile', 'registrationNumber', 'category'];

test('doctors: clean row is ready to create; an area from another territory is created in this one, with a warning', () => {
    const ctx = buildContext('DOCTOR', lists());
    const { results, summary } = checkRows(
        'DOCTOR',
        rowsOf([
            { code: 'DR-1', name: 'Dr. Suresh Rao', speciality: 'Cardiology', territory: 'ongole', area: 'Chirala', mobile: '+91 98480-12345', category: 'a' },
            { code: 'DR-2', name: 'Dr. K. Prasad', speciality: 'Physician', territory: 'Ongole', area: 'Brodipet' },
        ]),
        ctx,
        { columnMap: identityMap(doctorHeaders) }
    );

    assert.equal(results[0].status, 'READY');
    assert.equal(results[0].action, 'CREATE');
    assert.equal(results[0].values.category, 'A');
    assert.equal(results[1].status, 'WARNING');
    assert.equal(results[1].action, 'CREATE');
    assert.equal(results[1].values.area.isNew, true);
    assert.equal(results[1].values.area.territoryId, ID.ongole);
    assert.match(results[1].messages.map((m) => m.text).join(), /exists in Guntur; a new one is created in Ongole/);
    assert.equal(summary.create, 2);
    assert.equal(summary.errors, 0);
});

test('doctors: with creating switched off, an unknown territory is listed for value matching, and a match fixes it', () => {
    const ctx = buildContext('DOCTOR', lists());
    const row = { name: 'Dr. Rao', speciality: 'Cardiology', territory: 'ONG HQ', area: 'Chirala' };
    const first = checkRows('DOCTOR', rowsOf([row, row].map((r, i) => ({ ...r, name: `${r.name} ${i}` }))), ctx, {
        columnMap: identityMap(doctorHeaders),
        options: { createMissing: false },
    });

    assert.equal(first.results[0].status, 'ERROR');
    assert.equal(first.unresolved.territory[0].value, 'ONG HQ');
    assert.equal(first.unresolved.territory[0].count, 2);

    const second = checkRows('DOCTOR', rowsOf([row]), ctx, { columnMap: identityMap(doctorHeaders), valueMap: { territory: { 'ong hq': ID.ongole } }, options: { createMissing: false } });
    assert.equal(second.results[0].status, 'READY');
    assert.equal(second.results[0].values.territory.id, ID.ongole);
});

test('doctors: existing doctor by mobile is skipped by default, updated when asked; similar name is a possible duplicate', () => {
    const ctx = buildContext(
        'DOCTOR',
        lists({
            doctors: [
                { id: ID.drRao, name: 'Dr Suresh Rao', Speciality: 'Cardiology', MobileNumber: '9848012345', TerritoryId: ID.ongole.toUpperCase() },
                { id: ID.drPrasad, name: 'Dr Kotesh Prasad', Speciality: 'Physician', TerritoryId: ID.ongole },
            ],
        })
    );
    const rows = rowsOf([
        { name: 'Suresh Rao', speciality: 'Cardiology', territory: 'Ongole', area: 'Chirala', mobile: '98480 12345' },
        { name: 'Dr. Kotesh Prasadh', speciality: 'Physician', territory: 'Ongole', area: 'Chirala' },
    ]);

    const skip = checkRows('DOCTOR', rows, ctx, { columnMap: identityMap(doctorHeaders) });
    assert.equal(skip.results[0].action, 'SKIP');
    assert.equal(skip.results[0].match.id, ID.drRao);
    assert.equal(skip.results[1].action, 'SKIP');
    assert.equal(skip.results[1].match.possible, true);
    assert.equal(skip.results[1].status, 'WARNING');
    assert.deepEqual(skip.results[1].allowed.sort(), ['CREATE', 'SKIP', 'UPDATE']);

    const update = checkRows('DOCTOR', rows, ctx, { columnMap: identityMap(doctorHeaders), options: { existing: 'UPDATE' } });
    assert.equal(update.results[0].action, 'UPDATE');
    assert.equal(update.results[1].action, 'SKIP', 'a guess is never updated automatically');

    const decided = checkRows('DOCTOR', [rows[0], { ...rows[1], decision: 'CREATE' }], ctx, { columnMap: identityMap(doctorHeaders) });
    assert.equal(decided.results[1].action, 'CREATE');
});

test('doctors: same doctor twice in the file and a repeated code are errors on the later row', () => {
    const ctx = buildContext('DOCTOR', lists());
    const { results } = checkRows(
        'DOCTOR',
        rowsOf([
            { code: 'D1', name: 'Dr A Kumar', speciality: 'ENT', territory: 'Ongole', area: 'Chirala' },
            { code: 'D2', name: 'Kumar A', speciality: 'ENT', territory: 'Ongole', area: 'Chirala' },
            { code: 'D1', name: 'Dr B Rao', speciality: 'ENT', territory: 'Ongole', area: 'Chirala' },
        ]),
        ctx,
        { columnMap: identityMap(doctorHeaders) }
    );
    assert.equal(results[0].status, 'READY');
    assert.match(results[1].messages.map((m) => m.text).join(), /Same doctor as row 2/);
    assert.match(results[2].messages.map((m) => m.text).join(), /Code "D1" is also used on row 2/);
});

test('doctors: a code imported before means update, and later files can use old territory codes', () => {
    const ctx = buildContext(
        'DOCTOR',
        lists({
            doctors: [{ id: ID.drRao, name: 'Dr Suresh Rao', Speciality: 'Cardiology', TerritoryId: ID.ongole }],
            links: { DOCTOR: [{ LegacyCode: 'dr-1', EntityId: ID.drRao }], TERRITORY: [{ LegacyCode: 'HQ-ONG', EntityId: ID.ongole }] },
        })
    );
    const { results } = checkRows('DOCTOR', rowsOf([{ code: 'DR 1', name: 'Dr Suresh Rao', speciality: 'Cardiology', territory: 'HQ-ONG', area: 'Chirala' }]), ctx, {
        columnMap: identityMap(doctorHeaders),
    });
    assert.equal(results[0].action, 'UPDATE');
    assert.equal(results[0].values.territory.id, ID.ongole);
    assert.deepEqual(results[0].allowed.sort(), ['SKIP', 'UPDATE']);
});

test('doctors: bad optional values become warnings and are left out; Excel-mangled mobile is an error', () => {
    const ctx = buildContext('DOCTOR', lists());
    const { results } = checkRows(
        'DOCTOR',
        rowsOf([
            { name: 'Dr X', speciality: 'ENT', territory: 'Ongole', area: 'Chirala', category: 'Super core', mobile: '98480' },
            { name: 'Dr Y', speciality: 'ENT', territory: 'Ongole', area: 'Chirala', mobile: '9.84801E+09' },
        ]),
        ctx,
        { columnMap: identityMap(doctorHeaders) }
    );
    assert.equal(results[0].status, 'WARNING');
    assert.equal(results[0].values.category, null);
    assert.equal(results[1].status, 'ERROR');
    assert.match(results[1].messages[0].text, /Format the column as Text/);
});

// ---------------------------------------------------------
// Users
// ---------------------------------------------------------

const userHeaders = ['code', 'userName', 'firstName', 'designation', 'role', 'division', 'territories', 'manager', 'email'];
const user = (extra) => ({ designation: 'ASM', role: 'FIELD_USER', division: 'Cardio Care', territories: 'Ongole', ...extra });

test('users: managers can be other rows of the file; designation by long code; several territories', () => {
    const ctx = buildContext('USER', lists());
    const { results } = checkRows(
        'USER',
        rowsOf([
            user({ code: 'E1', userName: 'asha', firstName: 'Asha', manager: 'admin' }),
            user({ code: 'E2', userName: 'ravi', firstName: 'Ravi', manager: 'E1', designation: 'Bussines Devlopment Exicutive', territories: 'Ongole, Guntur' }),
        ]),
        ctx,
        { columnMap: identityMap(userHeaders) }
    );
    assert.equal(results[0].status, 'READY');
    assert.equal(results[0].values.manager.id, ID.admin);
    assert.deepEqual(results[1].values.manager, { row: 2, label: 'asha' });
    assert.equal(results[1].values.designation.id, ID.bde);
    assert.equal(results[1].values.territories.length, 2);
});

test('users: reporting loops are errors; unknown manager is a warning; existing username matches', () => {
    const ctx = buildContext('USER', lists());
    const loop = checkRows(
        'USER',
        rowsOf([user({ code: 'E1', userName: 'a', firstName: 'A', manager: 'E2' }), user({ code: 'E2', userName: 'b', firstName: 'B', manager: 'E1' })]),
        ctx,
        { columnMap: identityMap(userHeaders) }
    );
    assert.equal(loop.results[0].status, 'ERROR');
    assert.match(loop.results[0].messages.map((m) => m.text).join(), /reporting loop/);

    const other = checkRows('USER', rowsOf([user({ userName: 'ADMIN', firstName: 'Admin', manager: 'nobody' })]), ctx, { columnMap: identityMap(userHeaders) });
    assert.equal(other.results[0].match.id, ID.admin);
    assert.equal(other.results[0].action, 'SKIP');
    assert.deepEqual(other.results[0].allowed.sort(), ['SKIP', 'UPDATE'], 'a second user with the same username is never created');
    assert.match(other.results[0].messages.map((m) => m.text).join(), /Manager "nobody" wasn't found/);
});

// ---------------------------------------------------------
// Territories, areas, chemists
// ---------------------------------------------------------

test('territories and areas: existing names match, state by code, area name unique per territory', () => {
    const territory = checkRows('TERRITORY', rowsOf([{ name: 'ongole', state: 'AP' }, { name: 'Kurnool', state: 'ap' }]), buildContext('TERRITORY', lists()), {
        columnMap: identityMap(['name', 'state']),
    });
    assert.equal(territory.results[0].match.id, ID.ongole);
    assert.equal(territory.results[1].action, 'CREATE');
    assert.equal(territory.results[1].values.state.id, ID.ap);

    const area = checkRows('AREA', rowsOf([{ name: 'Chirala', territory: 'Ongole' }, { name: 'Chirala', territory: 'Guntur' }]), buildContext('AREA', lists()), {
        columnMap: identityMap(['name', 'territory']),
    });
    assert.equal(area.results[0].action, 'SKIP');
    assert.equal(area.results[1].action, 'CREATE');
});

test('chemists: GSTIN match; missing owner and contact are warnings, not errors', () => {
    const ctx = buildContext(
        'CHEMIST',
        lists({ outlets: [{ id: '30000000-0000-0000-0000-000000000001', name: 'Sai Medicals', GSTIN: '37ABCDE1234F1Z5', AreaId: ID.chirala }] })
    );
    const { results } = checkRows(
        'CHEMIST',
        rowsOf([
            { name: 'Sri Sai Medical Stores', gstin: '37abcde1234f1z5', territory: 'Ongole', area: 'Chirala' },
            { name: 'New Life Pharmacy', territory: 'Ongole', area: 'Chirala', address: 'Main Rd' },
        ]),
        ctx,
        { columnMap: identityMap(['name', 'gstin', 'territory', 'area', 'address']) }
    );
    assert.equal(results[0].match.how, 'GSTIN');
    assert.equal(results[1].status, 'READY', 'an empty owner or contact is only a note');
    assert.equal(results[1].action, 'CREATE');
    assert.equal(results[1].messages.filter((m) => m.level === 'info').length, 2);
});

// ---------------------------------------------------------
// SQL builders
// ---------------------------------------------------------

test('SQL: inserts list every writer column; updates keep current values for blank cells', () => {
    const insert = W.insertSql(W.WRITERS.DOCTOR);
    assert.match(insert, /INSERT INTO dbo\.Doctor \(DoctorId, DoctorName, NormalizedName/);
    assert.match(insert, /Source VARCHAR\(10\)/);

    const update = W.updateSql(W.WRITERS.USER);
    assert.match(update, /t\.ManagerId = COALESCE\(j\.ManagerId, t\.ManagerId\)/);
    assert.doesNotMatch(update, /UserName =/, 'usernames are never changed by an import');
});

test('SQL: undo reference check ignores the batch\'s own new rows in the same table', () => {
    const sqlText = W.referenceCountSql(W.WRITERS.USER, [
        { tableName: 'Users', columnName: 'ManagerId' },
        { tableName: 'Visits', columnName: 'UserId' },
    ]);
    assert.match(sqlText, /FROM dbo\.\[Users\] x[\s\S]*ManagerId[\s\S]*x\.UserId\) NOT IN/);
    assert.doesNotMatch(sqlText.split('UNION ALL')[1], /NOT IN/);
});

test('records: doctors are created approved but provisional, tagged as imported', () => {
    const ctx = buildContext('DOCTOR', lists());
    const { results } = checkRows('DOCTOR', rowsOf([{ name: 'Dr. Suresh Rao', speciality: 'Cardiology', territory: 'Ongole', area: 'Chirala' }]), ctx, {
        columnMap: identityMap(doctorHeaders),
    });
    const writer = W.WRITERS.DOCTOR;
    const record = Object.fromEntries(writer.columns.map(([column, , value]) => [column, value(results[0].values, { creating: true, actorId: ID.admin })]));
    assert.equal(record.ApprovalStatus, 'APPROVED');
    assert.equal(record.VerificationStatus, 'PROVISIONAL');
    assert.equal(record.Source, 'IMPORT');
    assert.equal(record.TerritoryId, ID.ongole);
    assert.equal(record.StateId, ID.ap);
    assert.equal(record.NormalizedName, 'rao suresh');
});

// ---------------------------------------------------------
// Messy real-world files (like an export with CITY instead of territory / area)
// ---------------------------------------------------------

const { missingRequired: missing } = require('../controllers/DataImport/columnMatch');
const { createPlaces, cleanLabel } = require('../controllers/DataImport/places');

test('required columns: territory or area is enough, and a value for every row counts', () => {
    assert.deepEqual(missing('DOCTOR', { name: 'n', speciality: 's', area: 'CITY' }), []);
    assert.deepEqual(missing('DOCTOR', { name: 'n', speciality: 's' }, { territory: 'Tirupati' }), []);
    assert.deepEqual(missing('DOCTOR', { name: 'n', speciality: 's' }), ['Territory', 'Area']);
});

test('places: "---" is blank; a known area brings its territory; a blank area uses the territory own area', () => {
    const ctx = buildContext('DOCTOR', lists());
    const { results } = checkRows(
        'DOCTOR',
        rowsOf([
            { name: 'Dr A', speciality: 'ENT', area: 'CHIRALA', mobile: '---' },
            { name: 'Dr B', speciality: 'ENT', territory: 'Guntur', area: '---' },
        ]),
        ctx,
        { columnMap: identityMap(['name', 'speciality', 'territory', 'area', 'mobile']) }
    );
    assert.equal(results[0].status, 'READY');
    assert.equal(results[0].values.territory.id, ID.ongole);
    assert.equal(results[0].values.mobile, null);
    assert.equal(results[1].values.area.isNew, true);
    assert.equal(results[1].values.area.label, 'Guntur');
    assert.match(results[1].messages[0].text, /No area given; placed in Guntur/);
});

test('places: spelling variants and junk become one new area; a value for every row fills the territory', () => {
    const ctx = buildContext('DOCTOR', lists());
    const cities = ['madhanapalli', 'madanapalli', 'madhana palli', 'Madhanapalli', 'Chittoor,17-434', 'chittor', 'tirupati 9000660130', 'Reddy and Reddy colony,tpt'];
    const { results, places } = checkRows(
        'DOCTOR',
        rowsOf(cities.map((city, i) => ({ name: `Dr Test ${String.fromCharCode(65 + i)}`, speciality: 'ENT', city }))),
        ctx,
        { columnMap: { name: 'name', speciality: 'speciality', area: 'city' }, defaults: { territory: 'Ongole' } }
    );
    assert.ok(results.every((r) => r.status !== 'ERROR'), JSON.stringify(results.map((r) => r.messages)));
    const areas = places.planned.filter((p) => p.type === 'AREA').map((p) => `${p.label}:${p.count}`).sort();
    assert.deepEqual(areas, ['Chittoor:2', 'Madhanapalli:4', 'Reddy and Reddy colony:1', 'Tirupati:1']);
    assert.equal(results[1].values.area, results[0].values.area, 'variants share one planned area');
});

test('places: new territories and states are planned when creating is on; states prefer the home country', () => {
    const base = lists();
    base.states.push({ id: '40000000-0000-0000-0000-000000000009', name: 'Andhra Pradesh', code: 'XX', CountryId: '50000000-0000-0000-0000-000000000009' });
    const ctx = buildContext('TERRITORY', base);
    const { results, places } = checkRows('TERRITORY', rowsOf([{ name: 'Nellore', state: 'Andra Pradesh' }, { name: 'Hosur', state: 'Tamil Nadu' }]), ctx, {
        columnMap: identityMap(['name', 'state']),
    });
    assert.equal(results[0].values.state.id, ID.ap, 'home-country state, despite a same-named one abroad');
    assert.equal(results[0].status, 'READY', 'an automatic spelling fix is only a note');
    assert.match(results[0].messages.map((m) => m.text).join(), /read as Andhra Pradesh \(similar spelling\)/);
    assert.equal(results[1].values.state.isNew, true);
    assert.equal(results[1].values.state.countryId, ID.india);
    assert.deepEqual(places.planned.map((p) => `${p.type}:${p.label}`), ['STATE:Tamil Nadu']);
});

test('doctors: a repeated doctor is merged into the first row and skipped; hospitals are flagged', () => {
    const ctx = buildContext('DOCTOR', lists());
    const { results, summary } = checkRows(
        'DOCTOR',
        rowsOf([
            { name: 'SUGUNA', speciality: 'Gynaecologist', territory: 'Ongole', area: 'Chirala', hospital: '---' },
            { name: 'Suguna', speciality: 'Gynaecologist', territory: 'Ongole', area: 'Chirala', hospital: 'Suguna Nursing Home' },
            { name: 'SWETHA HOSPITAL', speciality: 'Physician', territory: 'Ongole', area: 'Chirala' },
            { name: 'SASI BHUSHAN REDDY', speciality: 'Ortho', territory: 'Ongole', area: 'Chirala' },
            { name: 'SHASHI BHUSHAN REDDY', speciality: 'Ortho', territory: 'Ongole', area: 'Chirala' },
        ]),
        ctx,
        { columnMap: identityMap(['name', 'speciality', 'territory', 'area', 'hospital']) }
    );
    assert.equal(results[0].values.hospital, 'Suguna Nursing Home');
    assert.equal(results[0].action, 'CREATE');
    assert.equal(results[1].action, 'SKIP');
    assert.equal(results[1].status, 'WARNING');
    assert.ok(results[1].allowed.includes('CREATE'), 'the admin can still keep it');
    assert.match(results[2].messages.map((m) => m.text).join(), /looks like a hospital/);
    assert.match(results[4].messages.map((m) => m.text).join(), /Possibly the same doctor as row 5/);
    assert.equal(summary.errors, 0);
});

test('places: new record names drop numbers and text after a comma', () => {
    assert.equal(cleanLabel('Chittoor,17-434'), 'Chittoor');
    assert.equal(cleanLabel('tirupati 9000660130'), 'Tirupati');
    assert.equal(cleanLabel('PAPA NAIDU PETA'), 'Papa Naidu Peta');
    assert.equal(cleanLabel('Zz New HQ'), 'Zz New HQ', 'mixed case is kept');
    assert.equal(typeof createPlaces, 'function');
});

// ---------------------------------------------------------
// Word and PDF files
// ---------------------------------------------------------

const { makePdf, makeDocx } = require('./helpers/sampleFiles');

const COLUMNS = [40, 200, 320, 420];
const line = (y, cells) => cells.map((text, i) => text && { x: COLUMNS[i], y, text }).filter(Boolean);

test('PDF: title skipped, wrapped address joined, header repeated on page 2 and page numbers dropped', async () => {
    const pdf = makePdf([
        [
            { x: 40, y: 770, text: 'Doctor list - March 2026' },
            ...line(750, ['Doctor Name', 'Speciality', 'City', 'Address']),
            ...line(730, ['Dr. Rao', 'Cardiology', 'Tirupati', '12 Main Road,']),
            ...line(718, ['', '', '', 'near bus stand']),
            ...line(700, ['', 'ENT', 'Piler', 'Kotapalli road']),
            ...line(682, ['Dr. K (Suma) Rani', 'Gynaecologist', 'Nagari', 'Beri street']),
            { x: 300, y: 30, text: '1' },
        ],
        [...line(750, ['Doctor Name', 'Speciality', 'City', 'Address']), ...line(730, ['Dr. Lakshmi', 'Physician', 'Puttur', 'TB road']), { x: 280, y: 30, text: 'Page 2 of 2' }],
    ]);

    const { headers, rows } = await parseFile('doctors.pdf', pdf);
    assert.deepEqual(headers, ['Doctor Name', 'Speciality', 'City', 'Address']);
    assert.deepEqual(
        rows.map((r) => Object.values(r.values)),
        [
            ['Dr. Rao', 'Cardiology', 'Tirupati', '12 Main Road, near bus stand'],
            ['', 'ENT', 'Piler', 'Kotapalli road'],
            ['Dr. K (Suma) Rani', 'Gynaecologist', 'Nagari', 'Beri street'],
            ['Dr. Lakshmi', 'Physician', 'Puttur', 'TB road'],
        ]
    );

    const map = suggestColumnMap('DOCTOR', headers);
    assert.equal(map.name, 'Doctor Name');
    assert.equal(map.area, 'City');
    assert.equal(map.address, 'Address');
});

test('PDF: a scan with no text, and a PDF without a table, get clear messages', async () => {
    await assert.rejects(parseFile('scan.pdf', makePdf([[]])), /no readable text: it's probably a scan/);
    await assert.rejects(parseFile('letter.pdf', makePdf([[{ x: 40, y: 700, text: 'Dear Sir, please find the list attached.' }]])), /Couldn't find a table/);
    await assert.rejects(parseFile('broken.pdf', Buffer.from('not a pdf')), /couldn't be read as a PDF/);
});

test('Word: tables continuing under the same header are joined; two-line cells, merged cells and & survive', async () => {
    const header = ['Doctor Name', 'Speciality', 'City', 'Address'];
    const docx = await makeDocx([
        [header, ['Dr. Rao', 'Cardiology', 'Tirupati', { paragraphs: ['12 Main Road', 'near bus stand'] }], ['Dr. Suma', 'OBG & GYN', { text: 'Nagari', span: 2 }]],
        [['Sl', 'Note'], ['1', 'unrelated table']],
        [header, ['Dr. Lakshmi', 'Physician', 'Puttur', 'TB road']],
    ]);

    const { headers, rows } = await parseFile('doctors.docx', docx);
    assert.deepEqual(headers, header);
    assert.deepEqual(
        rows.map((r) => Object.values(r.values)),
        [
            ['Dr. Rao', 'Cardiology', 'Tirupati', '12 Main Road, near bus stand'],
            ['Dr. Suma', 'OBG & GYN', 'Nagari', ''],
            ['Dr. Lakshmi', 'Physician', 'Puttur', 'TB road'],
        ]
    );
});

test('Word: a document without a table, old .doc and photos get clear messages', async () => {
    await assert.rejects(parseFile('notes.docx', await makeDocx([])), /No table was found/);
    await assert.rejects(parseFile('list.doc', Buffer.from('x')), /save it as \.docx/);
    await assert.rejects(parseFile('list.JPG', Buffer.from('x')), /Photos can't be read yet/);
    await assert.rejects(parseFile('photo.png', Buffer.from('x')), /Photos can't be read yet/);
});

const { detectKind } = require('../controllers/DataImport/detectKind');

test('PDF report: two-line header, separators, group heading, totals and a second table', async () => {
    const X = [21, 296, 334, 480, 674, 707];
    const row = (y, cells) => cells.map((text, i) => ({ x: X[i], y, text }));
    const dashes = (y) => ({ x: 21, y, text: '--------------------------------------------------------' });
    const pdf = makePdf([
        [
            { x: 345, y: 770, text: 'SWASTIK AGENCIES' },
            { x: 96, y: 758, text: '# 14-176-4, TRUNK ROAD, NELLORE, ANDHRA PRADESH-524 001.' },
            { x: 242, y: 746, text: 'Phone : 9391 711 310 E-Mail : SWASTIKNELLORE@GMAIL.COM' },
            { x: 329, y: 734, text: 'GSTIN : 37PUNPS5622A1Z5' },
            { x: 226, y: 722, text: 'STOCK & SALES ANALYSIS 01-02-2023 - 28-02-2023' },
            dashes(712),
            { x: 21, y: 700, text: 'ITEM DESCRIPTION' },
            { x: 269, y: 700, text: 'OPENING' },
            { x: 474, y: 700, text: 'TOTAL' },
            { x: 650, y: 700, text: 'CLOSING' },
            { x: 275, y: 688, text: 'STOCK' },
            { x: 330, y: 688, text: 'PURCHASES' },
            { x: 474, y: 688, text: 'STOCK' },
            { x: 663, y: 688, text: 'STOCK' },
            { x: 712, y: 688, text: 'RATE' },
            dashes(678),
            { x: 21, y: 666, text: '6-WISTERIA' },
            ...row(654, ['RIACAL-D TAB', '0', '100', '100', '100', '22.18']),
            ...row(642, ['RIAMIZ-P TAB', '0', '340', '340', '340', '17']),
            dashes(632),
            ...row(620, ['Quantity', '0', '440', '440', '440', '']).filter((c) => c.text),
            dashes(610),
            { x: 21, y: 598, text: 'PURCHASE DETAIL :-' },
            { x: 21, y: 586, text: 'SUPPLIER NAME' },
            { x: 188, y: 586, text: 'INVOICE NO.' },
            { x: 410, y: 586, text: 'AMOUNT' },
        ],
    ]);

    const { headers, rows, preamble } = await parseFile('statement.pdf', pdf);
    assert.deepEqual(headers, ['ITEM DESCRIPTION', 'OPENING STOCK', 'PURCHASES', 'TOTAL STOCK', 'CLOSING STOCK', 'RATE']);
    assert.deepEqual(rows.map((r) => Object.values(r.values)), [
        ['RIACAL-D TAB', '0', '100', '100', '100', '22.18'],
        ['RIAMIZ-P TAB', '0', '340', '340', '340', '17'],
    ]);
    assert.equal(preamble[0], 'SWASTIK AGENCIES');

    const detected = detectKind(headers, preamble, rows.length);
    assert.equal(detected.kind, 'STOCK_STATEMENT');
    assert.equal(detected.from, 'SWASTIK AGENCIES');
    assert.equal(detected.gstin, '37PUNPS5622A1Z5');
    assert.equal(detected.phone, '9391711310');
    assert.equal(detected.period, '01-02-2023 to 28-02-2023');
});

test('detection: ordinary lists are not mistaken for statements', () => {
    assert.equal(detectKind(['Doctor Name', 'Speciality', 'City', 'Address']), null);
    assert.equal(detectKind(['Stockist Name', 'GSTIN', 'Drug Licence', 'Address', 'Contact']), null);
    assert.equal(detectKind(['Chemist', 'Area', 'Sales Rep']), null);
});

// ---------------------------------------------------------
// Stockist statements
// ---------------------------------------------------------

const { parseMonth } = require('../controllers/DataImport/statement');

const SWASTIK = '60000000-0000-0000-0000-000000000001';
const RIACAL = '70000000-0000-0000-0000-000000000001';
const stmtLists = (extra = {}) =>
    lists({
        outlets: [{ id: SWASTIK, name: 'Swastik Agencies', GSTIN: '37PUNPS5622A1Z5' }],
        products: [{ id: RIACAL, name: 'RIACAL-D TAB', UnitPrice: 20, IsSample: 0 }],
        statements: [],
        stockistOwners: [{ StockistId: SWASTIK, UserId: ID.admin }],
        ...extra,
    });
const stmtColumns = identityMap(['product', 'opening', 'purchases', 'saleReturn', 'otherIn', 'sales', 'purchaseReturn', 'otherOut', 'closing', 'rate']);
const stmtLine = (product, o, p, s, c, rate = '', more = {}) => ({ product, opening: String(o), purchases: String(p), sales: String(s), closing: String(c), rate: String(rate), ...more });

test('statement months: names, numbers and a one-month period; a period across months is refused', () => {
    assert.equal(parseMonth('Feb 2023'), '2023-02-01');
    assert.equal(parseMonth('February-2023'), '2023-02-01');
    assert.equal(parseMonth('2023-02'), '2023-02-01');
    assert.equal(parseMonth('02/2023'), '2023-02-01');
    assert.equal(parseMonth('01-02-2023 to 28-02-2023'), '2023-02-01');
    assert.equal(parseMonth('01-02-2023 - 31-03-2023'), null);
});

test('statement: existing stockist found by GSTIN, products by name; lines follow opening + receipts + returns - sales', () => {
    const ctx = buildContext('STATEMENT', stmtLists());
    const { results, statement, places } = checkRows(
        'STATEMENT',
        rowsOf([
            stmtLine('Riacal-D Tab', 0, 530, 200, 330, 24.95),
            stmtLine('WISTOZIC INJECTION', 10, 660, 0, 670, '5.29'),
            stmtLine('RIACAL D TAB', 0, 5, 0, 5),
            stmtLine('ZERO MOVER', 0, 0, 0, 0),
        ]),
        ctx,
        { columnMap: stmtColumns, defaults: { stockist: 'SWASTIK AGENCIES (NELLORE)', month: 'Feb 2023' }, detected: { gstin: '37PUNPS5622A1Z5' } }
    );
    assert.equal(statement.stockist, 'Swastik Agencies');
    assert.equal(statement.newStockist, false);
    assert.equal(statement.owner, ID.admin.toLowerCase());
    assert.equal(results[0].values.product.id, RIACAL);
    assert.deepEqual([results[0].values.receipts, results[0].values.sales, results[0].values.closing], [530, 200, 330]);
    assert.equal(results[1].values.product.isNew, true);
    assert.equal(results[1].values.product.price, 5.29);
    assert.equal(results[2].action, 'SKIP', 'same product twice');
    assert.equal(results[3].action, 'SKIP', 'nothing to record');
    assert.deepEqual(places.planned.map((p) => `${p.type}:${p.label}`), ['PRODUCT:WISTOZIC INJECTION']);
});

test('statement: stock sent back is netted from receipts; a closing that does not add up is reported', () => {
    const ctx = buildContext('STATEMENT', stmtLists());
    const { results } = checkRows(
        'STATEMENT',
        rowsOf([
            stmtLine('RIACAL-D TAB', 50, 100, 30, 90, '', { purchaseReturn: '20', otherIn: '5', otherOut: '5' }),
            stmtLine('RIACAL-D TAB X', 10, 0, 5, 0, '', { purchaseReturn: '3' }),
            stmtLine('RIACAL-D TAB Y', 0, 10, 20, 0),
        ]),
        ctx,
        { columnMap: stmtColumns, defaults: { stockist: 'Swastik Agencies', month: '2023-02' } }
    );
    assert.equal(results[0].values.receipts, 80, '100 + 5 - 20 - 5');
    assert.equal(results[0].values.closing, 100, '50 + 80 - 30');
    assert.match(results[0].messages.map((m) => m.text).join(), /closing stock \(90\) doesn't add up; 100 is used/);
    assert.equal(results[1].values.sales, 8, 'returns beyond receipts count with sales');
    assert.equal(results[2].status, 'ERROR');
    assert.match(results[2].messages.map((m) => m.text).join(), /Sales \(20\) are more than the stock available \(10\)/);
});

test('statement: a new stockist is placed in the town from its letterhead; an existing month is refused', () => {
    const ctx = buildContext('STATEMENT', stmtLists());
    const fresh = checkRows('STATEMENT', rowsOf([stmtLine('RIACAL-D TAB', 0, 10, 0, 10)]), ctx, {
        columnMap: stmtColumns,
        defaults: { stockist: 'New Life Distributors', month: 'Mar 2023', territory: 'Ongole' },
        detected: { phone: '9391711310', gstin: '37AAAAA1111A1Z5', address: 'Main Road, Ongole' },
    });
    assert.equal(fresh.statement.newStockist, true);
    const stockist = fresh.results[0].values.stockist;
    assert.equal(stockist.territory.id, ID.ongole);
    assert.equal(stockist.area.label, 'Ongole', "the territory's own area");
    assert.equal(stockist.phone, '9391711310');

    const nowhere = checkRows('STATEMENT', rowsOf([stmtLine('RIACAL-D TAB', 0, 10, 0, 10)]), ctx, { columnMap: stmtColumns, defaults: { stockist: 'Unknown Pharma', month: 'Mar 2023' } });
    assert.match(nowhere.results[0].messages[0].text, /new stockist and needs a place/);

    const dup = buildContext('STATEMENT', stmtLists({ statements: [{ StockistId: SWASTIK, StatementMonth: '2023-02-01', Status: 'APPROVED' }] }));
    const again = checkRows('STATEMENT', rowsOf([stmtLine('RIACAL-D TAB', 0, 10, 0, 10)]), dup, { columnMap: stmtColumns, defaults: { stockist: 'Swastik Agencies', month: 'Feb 2023' } });
    assert.equal(again.summary.errors, 1);
    assert.match(again.results[0].messages[0].text, /already has a February 2023 statement/);
});

test('statement SQL: lines have no timestamps; undo removes a new stockist territory link first', () => {
    assert.doesNotMatch(W.insertSql(W.WRITERS.STATEMENT), /CreatedOn/);
    const del = W.deleteMasterSql(W.MASTERS.STOCKIST);
    assert.ok(del.indexOf('StockistTerritories') < del.indexOf('dbo.Stockist WHERE'));
    assert.deepEqual(W.MASTER_ORDER, ['STATE', 'TERRITORY', 'AREA', 'STOCKIST', 'PRODUCT']);
});
