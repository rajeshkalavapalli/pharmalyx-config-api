// Reads an uploaded .xlsx, .csv, .docx (its table) or text .pdf (its table) into { headers, rows }.
// rows: [{ rowNumber, values: { [header]: string | Date } }], blank rows dropped.
const ExcelJS = require('exceljs');
const { fail } = require('../../utils/access');
const { readDocx } = require('./readers/readDocx');
const { readPdf } = require('./readers/readPdf');

const MAX_ROWS = 20000;

// Excel cells can hold formulas, links or rich text; keep only what the user sees.
const cellValue = (value) => {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value;
    if (typeof value === 'object') {
        if ('result' in value) return cellValue(value.result);
        if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
        if ('text' in value) return cellValue(value.text);
        if ('error' in value) return '';
        return String(value);
    }
    return typeof value === 'string' ? value.trim() : String(value);
};

// Unique, non-empty header names ("Name", "Name (2)", "Column 3").
const cleanHeaders = (raw) => {
    const seen = new Map();
    return raw.map((header, index) => {
        let name = String(header || '').replace(/\s+/g, ' ').trim() || `Column ${index + 1}`;
        const count = seen.get(name.toLowerCase()) || 0;
        seen.set(name.toLowerCase(), count + 1);
        if (count) name = `${name} (${count + 1})`;
        return name;
    });
};

const isBlank = (values) => values.every((value) => value === '' || value === null || value === undefined);

const toTable = (grid) => {
    // The header is the first row with anything in it.
    const headerIndex = grid.findIndex((row) => !isBlank(row.cells));
    if (headerIndex === -1) throw fail(400, 'The file is empty.');

    const headerRow = grid[headerIndex];
    const width = Math.max(...grid.map((row) => row.cells.length));
    const headers = cleanHeaders(Array.from({ length: width }, (_, i) => headerRow.cells[i]));

    const rows = grid
        .slice(headerIndex + 1)
        .filter((row) => !isBlank(row.cells))
        .map((row) => ({
            rowNumber: row.rowNumber,
            values: Object.fromEntries(headers.map((header, i) => [header, row.cells[i] ?? ''])),
        }));

    if (!rows.length) throw fail(400, 'The file has a header row but no data rows.');
    if (rows.length > MAX_ROWS) throw fail(400, `The file has ${rows.length} rows. Split it into files of up to ${MAX_ROWS} rows.`);

    return { headers, rows, preamble: grid.preamble || [] };
};

// RFC 4180-style CSV: commas (or semicolons), quoted fields, "" inside quotes.
const parseCsvText = (text) => {
    const firstLine = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n'));
    const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';

    const grid = [];
    let cells = [];
    let field = '';
    let quoted = false;
    let line = 1;
    let rowStart = 1;

    const endField = () => {
        cells.push(field.trim());
        field = '';
    };
    const endRow = () => {
        endField();
        grid.push({ rowNumber: rowStart, cells });
        cells = [];
        rowStart = line;
    };

    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"' && text[i + 1] === '"') {
                field += '"';
                i += 1;
            } else if (ch === '"') {
                quoted = false;
            } else {
                if (ch === '\n') line += 1;
                field += ch;
            }
        } else if (ch === '"' && field.trim() === '') {
            field = '';
            quoted = true;
        } else if (ch === delimiter) {
            endField();
        } else if (ch === '\n') {
            line += 1;
            endRow();
        } else if (ch !== '\r') {
            field += ch;
        }
    }
    if (field !== '' || cells.length) endRow();

    return grid;
};

const readCsv = (buffer) => {
    let text = buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    return toTable(parseCsvText(text));
};

const readXlsx = async (buffer) => {
    const workbook = new ExcelJS.Workbook();
    try {
        await workbook.xlsx.load(buffer);
    } catch {
        throw fail(400, "This file couldn't be read as an Excel workbook. Save it as .xlsx or .csv and try again.");
    }

    // First sheet that has data.
    const sheet = workbook.worksheets.find((ws) => ws.actualRowCount > 0);
    if (!sheet) throw fail(400, 'The workbook has no data.');

    const grid = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const cells = [];
        row.eachCell({ includeEmpty: true }, (cell, col) => {
            cells[col - 1] = cellValue(cell.value);
        });
        grid.push({ rowNumber, cells: Array.from(cells, (value) => value ?? '') });
    });

    return toTable(grid);
};

const IMAGE = /\.(jpe?g|png|gif|bmp|webp|heic|heif|tiff?)$/;

const parseFile = async (fileName, buffer) => {
    if (!buffer || !buffer.length) throw fail(400, 'The uploaded file is empty.');

    const name = String(fileName || '').toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.txt')) return readCsv(buffer);
    if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return readXlsx(buffer);
    if (name.endsWith('.docx')) return toTable(await readDocx(buffer));
    if (name.endsWith('.pdf')) return toTable(await readPdf(buffer));

    if (name.endsWith('.xls')) throw fail(400, 'Old .xls files are not supported. Open the file in Excel and save it as .xlsx or .csv.');
    if (name.endsWith('.doc')) throw fail(400, 'Old .doc files are not supported. Open the file in Word and save it as .docx.');
    if (IMAGE.test(name)) {
        throw fail(400, "Photos can't be read yet. Export the list from your old app as Excel, CSV, Word or PDF, or type it into our template.");
    }

    throw fail(400, 'Upload an Excel (.xlsx), CSV, Word (.docx) or PDF file.');
};

module.exports = { parseFile, parseCsvText, MAX_ROWS };
