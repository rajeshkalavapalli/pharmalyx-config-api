// What can be imported, in the order it should be imported, and the fields each type accepts.
// Pure data: the checks live in validate.js and the database writes in writers.js.
//
// Field kinds:
//   code     the record's ID in the previous app (kept in ImportLinks)
//   text     free text, trimmed, cut at `max`
//   phone    any format; stored as typed, matched on the last 10 digits
//   email    must look like an email
//   date     Excel date, dd-mm-yyyy (Indian default), dd/mm/yyyy or yyyy-mm-dd
//   int      whole number between min and max
//   enum     one of `values`; other spellings can be matched once in the value-matching step
//   active   yes/no style flag; blank means active
//   ref      name or old-app code of another record (territory, area, ...); unknown values can be matched by hand.
//            Missing states, territories and areas can be created by the import (see places.js).
//   refList  several refs separated by commas or semicolons
//
// `aliases` are header names other apps commonly use, for automatic column matching.
// `requiredUnless`: the field may be left out when that other field is given (territory <-> area).
// `feature`: only saved when the database has the matching column (see ImportDA.loadFeatures).

const STATE_FIELD = { key: 'state', label: 'State', kind: 'ref', ref: 'STATE', aliases: ['state', 'state name'] };

const ACTIVE = { key: 'active', label: 'Active', kind: 'active', aliases: ['status', 'is active', 'isactive', 'active/inactive', 'enabled'] };

const ENTITIES = {
    TERRITORY: {
        label: 'Territories',
        singular: 'territory',
        description: 'Headquarters / territories, each in a state.',
        order: 1,
        fields: [
            { key: 'code', label: 'Territory code', kind: 'code', aliases: ['territory code', 'hq code', 'code', 'territory id', 'id'] },
            { key: 'name', label: 'Territory name', kind: 'text', required: true, max: 250, aliases: ['territory', 'territory name', 'hq', 'hq name', 'headquarter', 'headquarters', 'name'] },
            { key: 'state', label: 'State', kind: 'ref', ref: 'STATE', required: true, aliases: ['state', 'state name'] },
            { key: 'divisions', label: 'Divisions', kind: 'refList', ref: 'DIVISION', aliases: ['division', 'divisions', 'business unit'] },
            ACTIVE,
        ],
        example: { code: 'HQ-ONG', name: 'Ongole', state: 'Andhra Pradesh', divisions: 'Cardio Care', active: 'Yes' },
    },

    AREA: {
        label: 'Areas',
        singular: 'area',
        description: 'Working areas (patches / towns) inside a territory.',
        order: 2,
        dependsOn: ['TERRITORY'],
        fields: [
            { key: 'code', label: 'Area code', kind: 'code', aliases: ['area code', 'patch code', 'code', 'area id', 'id'] },
            { key: 'name', label: 'Area name', kind: 'text', required: true, max: 240, aliases: ['area', 'area name', 'patch', 'patch name', 'town', 'route', 'name'] },
            { key: 'territory', label: 'Territory', kind: 'ref', ref: 'TERRITORY', required: true, aliases: ['territory', 'hq', 'headquarter', 'territory name', 'territory code', 'hq code'] },
            ACTIVE,
        ],
        example: { code: 'AR-101', name: 'Chirala', territory: 'Ongole', active: 'Yes' },
    },

    USER: {
        label: 'Users',
        singular: 'user',
        description: 'Employees with their designation, role, territories and manager. They sign in once an admin sets their password.',
        order: 3,
        dependsOn: ['TERRITORY'],
        fields: [
            { key: 'code', label: 'Employee code', kind: 'code', aliases: ['employee code', 'emp code', 'empcode', 'employee id', 'emp id', 'staff code', 'code', 'id'] },
            { key: 'userName', label: 'Username', kind: 'text', required: true, max: 100, aliases: ['username', 'user name', 'login', 'login id', 'user id'] },
            { key: 'firstName', label: 'First name', kind: 'text', required: true, max: 100, aliases: ['first name', 'firstname', 'name', 'employee name', 'emp name'] },
            { key: 'lastName', label: 'Last name', kind: 'text', max: 100, aliases: ['last name', 'lastname', 'surname'] },
            { key: 'email', label: 'Email', kind: 'email', max: 100, aliases: ['email', 'email id', 'mail', 'e-mail'] },
            { key: 'mobile', label: 'Mobile', kind: 'phone', max: 50, aliases: ['mobile', 'mobile no', 'mobile number', 'phone', 'contact', 'contact no'] },
            { key: 'designation', label: 'Designation', kind: 'ref', ref: 'DESIGNATION', required: true, aliases: ['designation', 'title', 'position', 'grade'] },
            { key: 'role', label: 'Role', kind: 'ref', ref: 'ROLE', required: true, aliases: ['role', 'access', 'user type', 'type'] },
            { key: 'division', label: 'Division', kind: 'ref', ref: 'DIVISION', required: true, aliases: ['division', 'business unit', 'team'] },
            { key: 'territories', label: 'Territories', kind: 'refList', ref: 'TERRITORY', required: true, aliases: ['territory', 'territories', 'hq', 'headquarter', 'headquarters'] },
            { key: 'manager', label: 'Manager', kind: 'ref', ref: 'USER', aliases: ['manager', 'reporting manager', 'reports to', 'reporting to', 'manager code', 'manager emp code', 'abm', 'rbm'] },
            ACTIVE,
        ],
        example: { code: 'EMP-1042', userName: 'ravi.k', firstName: 'Ravi', lastName: 'Kumar', email: 'ravi.k@example.com', mobile: '9876543210', designation: 'BDE', role: 'Field User', division: 'Cardio Care', territories: 'Ongole', manager: 'EMP-1001', active: 'Yes' },
    },

    DOCTOR: {
        label: 'Doctors',
        singular: 'doctor',
        description: 'Doctor list. Imported doctors are approved but stay provisional until the field team verifies them on a visit.',
        order: 4,
        dependsOn: ['TERRITORY', 'AREA'],
        fields: [
            { key: 'code', label: 'Doctor code', kind: 'code', aliases: ['doctor code', 'dr code', 'code', 'doctor id', 'dr id', 'id'] },
            { key: 'name', label: 'Doctor name', kind: 'text', required: true, max: 250, aliases: ['doctor', 'doctor name', 'dr name', 'name'] },
            { key: 'qualification', label: 'Qualification', kind: 'text', max: 500, aliases: ['qualification', 'degree', 'qual'] },
            { key: 'speciality', label: 'Speciality', kind: 'text', required: true, max: 250, aliases: ['speciality', 'specialty', 'specialisation', 'specialization', 'spec'] },
            { key: 'hospital', label: 'Hospital / clinic', kind: 'text', max: 250, aliases: ['hospital', 'clinic', 'hospital name', 'clinic name'] },
            { key: 'address', label: 'Clinic address', kind: 'text', max: 500, feature: 'clinicAddress', aliases: ['address', 'clinic address', 'full address', 'location'] },
            { key: 'mobile', label: 'Mobile', kind: 'phone', max: 20, aliases: ['mobile', 'mobile no', 'mobile number', 'phone', 'contact', 'contact no'] },
            { key: 'email', label: 'Email', kind: 'email', max: 250, aliases: ['email', 'email id', 'mail'] },
            { key: 'registrationNumber', label: 'Registration number', kind: 'text', max: 40, aliases: ['registration', 'registration no', 'registration number', 'reg no', 'mci', 'mci no', 'nmc no'] },
            { key: 'registrationCouncil', label: 'Registration council', kind: 'text', max: 100, aliases: ['council', 'registration council', 'medical council'] },
            { key: 'category', label: 'Category', kind: 'enum', values: ['A', 'B', 'C'], aliases: ['category', 'class', 'grade', 'priority', 'core'] },
            { key: 'visitsPerMonth', label: 'Visits per month', kind: 'int', min: 0, max: 31, aliases: ['visits per month', 'frequency', 'visit frequency', 'calls per month'] },
            { key: 'dateOfBirth', label: 'Date of birth', kind: 'date', aliases: ['dob', 'date of birth', 'birthday', 'birth date'] },
            { key: 'anniversary', label: 'Anniversary', kind: 'date', aliases: ['anniversary', 'doa', 'wedding anniversary', 'anniversary date'] },
            STATE_FIELD,
            { key: 'territory', label: 'Territory', kind: 'ref', ref: 'TERRITORY', required: true, requiredUnless: 'area', aliases: ['territory', 'hq', 'headquarter', 'headquarters', 'territory name', 'hq name'] },
            { key: 'area', label: 'Area', kind: 'ref', ref: 'AREA', required: true, requiredUnless: 'territory', aliases: ['area', 'patch', 'town', 'city', 'route', 'area name', 'place', 'village'] },
            ACTIVE,
        ],
        example: { code: 'DR-5531', name: 'Dr. Suresh Rao', qualification: 'MBBS, MD', speciality: 'Cardiology', hospital: 'Rao Heart Clinic', mobile: '9848012345', email: '', registrationNumber: 'APMC 45213', registrationCouncil: 'Andhra Pradesh Medical Council', category: 'A', visitsPerMonth: 2, dateOfBirth: '14-03-1972', anniversary: '', territory: 'Ongole', area: 'Chirala', active: 'Yes' },
    },

    CHEMIST: {
        label: 'Chemists',
        singular: 'chemist',
        description: 'Chemists / pharmacies (retailers).',
        order: 5,
        dependsOn: ['TERRITORY', 'AREA'],
        fields: [
            { key: 'code', label: 'Chemist code', kind: 'code', aliases: ['chemist code', 'pharmacy code', 'retailer code', 'code', 'id'] },
            { key: 'name', label: 'Chemist name', kind: 'text', required: true, max: 100, aliases: ['chemist', 'chemist name', 'pharmacy', 'pharmacy name', 'retailer', 'retailer name', 'medical shop', 'name'] },
            { key: 'owner', label: 'Owner name', kind: 'text', max: 100, aliases: ['owner', 'owner name', 'proprietor', 'contact person'] },
            { key: 'contact', label: 'Contact number', kind: 'phone', max: 50, aliases: ['contact', 'contact no', 'contact number', 'mobile', 'phone'] },
            { key: 'email', label: 'Email', kind: 'email', max: 50, aliases: ['email', 'email id', 'mail'] },
            { key: 'drugLicence', label: 'Drug licence number', kind: 'text', max: 50, aliases: ['drug licence', 'drug license', 'dl no', 'dl number', 'licence no', 'license no'] },
            { key: 'gstin', label: 'GSTIN', kind: 'text', max: 50, aliases: ['gstin', 'gst', 'gst no', 'gst number'] },
            { key: 'address', label: 'Address', kind: 'text', max: 350, aliases: ['address', 'full address', 'location'] },
            STATE_FIELD,
            { key: 'territory', label: 'Territory', kind: 'ref', ref: 'TERRITORY', required: true, requiredUnless: 'area', aliases: ['territory', 'hq', 'headquarter', 'headquarters', 'territory name', 'hq name'] },
            { key: 'area', label: 'Area', kind: 'ref', ref: 'AREA', required: true, requiredUnless: 'territory', aliases: ['area', 'patch', 'town', 'city', 'route', 'area name', 'place', 'village'] },
            ACTIVE,
        ],
        example: { code: 'CH-221', name: 'Sri Sai Medicals', owner: 'K. Srinivas', contact: '9440012345', email: '', drugLicence: 'AP/ONG/20B/1234', gstin: '37ABCDE1234F1Z5', address: 'Main Road, Chirala', territory: 'Ongole', area: 'Chirala', active: 'Yes' },
    },

    STOCKIST: {
        label: 'Stockists',
        singular: 'stockist',
        description: 'Stockists / distributors. Each one is linked to the territory it supplies.',
        order: 6,
        dependsOn: ['TERRITORY', 'AREA'],
        fields: [
            { key: 'code', label: 'Stockist code', kind: 'code', aliases: ['stockist code', 'distributor code', 'party code', 'code', 'id'] },
            { key: 'name', label: 'Stockist name', kind: 'text', required: true, max: 100, aliases: ['stockist', 'stockist name', 'distributor', 'distributor name', 'party', 'party name', 'name'] },
            { key: 'owner', label: 'Owner name', kind: 'text', max: 100, aliases: ['owner', 'owner name', 'proprietor', 'contact person'] },
            { key: 'contact', label: 'Contact number', kind: 'phone', max: 50, aliases: ['contact', 'contact no', 'contact number', 'mobile', 'phone'] },
            { key: 'email', label: 'Email', kind: 'email', max: 50, aliases: ['email', 'email id', 'mail'] },
            { key: 'drugLicence', label: 'Drug licence number', kind: 'text', max: 50, aliases: ['drug licence', 'drug license', 'dl no', 'dl number', 'licence no', 'license no'] },
            { key: 'gstin', label: 'GSTIN', kind: 'text', max: 50, aliases: ['gstin', 'gst', 'gst no', 'gst number'] },
            { key: 'address', label: 'Address', kind: 'text', max: 350, aliases: ['address', 'full address', 'location'] },
            STATE_FIELD,
            { key: 'territory', label: 'Territory', kind: 'ref', ref: 'TERRITORY', required: true, requiredUnless: 'area', aliases: ['territory', 'hq', 'headquarter', 'headquarters', 'territory name', 'hq name'] },
            { key: 'area', label: 'Area', kind: 'ref', ref: 'AREA', required: true, requiredUnless: 'territory', aliases: ['area', 'town', 'area name', 'city', 'place'] },
            ACTIVE,
        ],
        example: { code: 'ST-14', name: 'Venkata Pharma Distributors', owner: 'V. Rao', contact: '9866012345', email: 'orders@venkatapharma.example', drugLicence: 'AP/ONG/21B/887', gstin: '37AAACV1234K1Z2', address: 'Kurnool Road, Ongole', territory: 'Ongole', area: 'Ongole Town', active: 'Yes' },
    },

    // One stockist's monthly stock & sales statement: one row per product.
    // Becomes that stockist's secondary-sales statement for the month (approved history).
    // The stockist and month are usually the same for every row: they're filled in from the
    // statement's letterhead and period, and the stockist and products are created if new.
    STATEMENT: {
        label: 'Stockist statements',
        singular: 'statement line',
        description: "A stockist's monthly stock & sales statement (opening, purchases, sales, closing per product). Creates the stockist and products if they're new.",
        order: 7,
        dependsOn: [],
        perBatch: true, // the whole file is one statement
        fields: [
            { key: 'stockist', label: 'Stockist', kind: 'ref', ref: 'STOCKIST', required: true, aliases: ['stockist', 'stockist name', 'distributor', 'party'] },
            { key: 'month', label: 'Month', kind: 'month', required: true, aliases: ['month', 'period', 'statement month'] },
            { key: 'product', label: 'Product', kind: 'ref', ref: 'PRODUCT', required: true, aliases: ['item description', 'item', 'item name', 'product', 'product name', 'brand', 'description', 'particulars'] },
            { key: 'opening', label: 'Opening stock', kind: 'qty', aliases: ['opening stock', 'opening', 'op stock', 'op qty', 'opening qty', 'ob'] },
            { key: 'purchases', label: 'Purchases / receipts', kind: 'qty', aliases: ['purchases', 'purchase', 'receipts', 'receipt', 'inward', 'purchase qty', 'recd'] },
            { key: 'saleReturn', label: 'Sales returns (in)', kind: 'qty', aliases: ['sale return', 'sales return', 'sr', 'returns in', 'sale returns'] },
            { key: 'otherIn', label: 'Other stock in', kind: 'qty', aliases: ['repl others', 'replacement', 'other receipts', 'others in', 'repl'] },
            { key: 'sales', label: 'Sales', kind: 'qty', aliases: ['sales', 'sale', 'sales qty', 'issue', 'issues', 'sold'] },
            { key: 'purchaseReturn', label: 'Purchase returns (out)', kind: 'qty', aliases: ['purchase return', 'purchase returns', 'pr', 'returns out'] },
            { key: 'otherOut', label: 'Other stock out', kind: 'qty', aliases: ['repl others 2', 'others out', 'other issues', 'breakage', 'expiry'] },
            { key: 'closing', label: 'Closing stock', kind: 'qty', aliases: ['closing stock', 'closing', 'cl stock', 'closing qty', 'cb'] },
            { key: 'rate', label: 'Rate', kind: 'money', aliases: ['rate', 'ptr', 'pts', 'price', 'unit price', 'unit rate'] },
            // Only used when the stockist is new: where it is.
            STATE_FIELD,
            { key: 'territory', label: 'Territory (new stockist)', kind: 'ref', ref: 'TERRITORY', aliases: ['territory', 'hq'] },
            { key: 'area', label: 'Area (new stockist)', kind: 'ref', ref: 'AREA', aliases: ['area', 'town', 'city'] },
        ],
        example: { stockist: 'Swastik Agencies', month: 'Feb 2023', product: 'RIACAL-D TAB', opening: 0, purchases: 100, saleReturn: 0, otherIn: 0, sales: 0, purchaseReturn: 0, otherOut: 0, closing: 100, rate: 22.18, state: 'Andhra Pradesh', territory: 'Nellore', area: '' },
    },
};

const ENTITY_TYPES = Object.keys(ENTITIES).sort((a, b) => ENTITIES[a].order - ENTITIES[b].order);

// Fields whose unknown values the admin can match by hand (refs and enums).
const isMatchable = (field) => field.kind === 'ref' || field.kind === 'refList' || field.kind === 'enum';

module.exports = { ENTITIES, ENTITY_TYPES, isMatchable };
