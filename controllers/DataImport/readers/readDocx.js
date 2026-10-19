// Reads the table out of a Word (.docx) file as a grid: [{ rowNumber, cells: [text] }].
// A .docx is a zip; the text lives in word/document.xml as <w:tbl> / <w:tr> / <w:tc>.
// Tables that repeat the same header (one per page) are joined into one.
const JSZip = require('jszip');
const { fail } = require('../../../utils/access');

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (text) =>
    text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, code) => {
        if (code[0] !== '#') return XML_ENTITIES[code.toLowerCase()];
        return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10));
    });

// Elements by tag; "w:p" doesn't match "w:pPr" because a space or ">" must follow the name.
const all = (xml, tag) => xml.match(new RegExp(`<w:${tag}[ >][\\s\\S]*?</w:${tag}>`, 'g')) || [];

const paragraphText = (p) =>
    decode(
        (p.replace(/<w:(tab|br)\/>/g, '<w:t> </w:t>').match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g) || [])
            .map((t) => t.replace(/<[^>]+>/g, ''))
            .join('')
    )
        .replace(/\s+/g, ' ')
        .trim();

// A cell's paragraphs joined with ", " (an address written over two lines).
const cellText = (cellXml) => all(cellXml, 'p').map(paragraphText).filter(Boolean).join(', ');

// One table -> rows of cell texts. A merged cell (gridSpan) keeps later columns aligned.
const tableRows = (tableXml) =>
    all(tableXml, 'tr').map((rowXml) =>
        all(rowXml, 'tc').flatMap((cellXml) => {
            const span = Number(/<w:gridSpan w:val="(\d+)"/.exec(cellXml)?.[1] || 1);
            return [cellText(cellXml), ...Array(Math.max(0, span - 1)).fill('')];
        })
    );

const sameRow = (a, b) => a.length === b.length && a.every((cell, i) => cell.toLowerCase() === String(b[i] || '').toLowerCase());

const readDocx = async (buffer) => {
    let xml = null;
    try {
        const zip = await JSZip.loadAsync(buffer);
        xml = await zip.file('word/document.xml')?.async('string');
    } catch {
        xml = null;
    }
    if (!xml) throw fail(400, "This file couldn't be read as a Word document. Open it in Word and save it as .docx, or export the list as Excel.");

    const tables = all(xml, 'tbl')
        .map(tableRows)
        .filter((rows) => rows.length >= 2 && Math.max(...rows.map((r) => r.length)) >= 2);
    if (!tables.length) throw fail(400, 'No table was found in this Word file. The list must be in a Word table, or upload it as Excel/CSV.');

    // The biggest table, plus the other tables that continue it under the same header, in page order.
    const header = tables.reduce((best, t) => (t.length > best.length ? t : best))[0];
    const body = tables
        .filter((t) => sameRow(t[0], header))
        .flatMap((t) => t.slice(1))
        .filter((row) => !sameRow(row, header));

    return [header, ...body].map((cells, i) => ({ rowNumber: i + 1, cells }));
};

module.exports = { readDocx };
