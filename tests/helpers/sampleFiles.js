// Builds small real .pdf and .docx files in memory for the import tests.
const JSZip = require('jszip');

// pages: [[{ x, y, text }]] -> a valid PDF (Helvetica 10pt, 842pt square pages), one content stream per page.
const makePdf = (pages) => {
    const esc = (text) => String(text).replace(/[\\()]/g, (c) => `\\${c}`);
    const objects = [];
    const add = (body) => {
        objects.push(body);
        return objects.length;
    };

    const catalog = add(null);
    const pagesId = add(null);
    const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const pageIds = pages.map((words) => {
        const stream = words.map((w) => `BT /F1 10 Tf ${w.x} ${w.y} Td (${esc(w.text)}) Tj ET`).join('\n');
        const content = add(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
        return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 842 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`);
    });
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

    let out = '%PDF-1.4\n';
    const offsets = objects.map((body, i) => {
        const offset = Buffer.byteLength(out);
        out += `${i + 1} 0 obj\n${body}\nendobj\n`;
        return offset;
    });
    const xref = Buffer.byteLength(out);
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1');
};

// tables: [[[cell]]] ; a cell may be { paragraphs: [...] } or { text, span }.
const makeDocx = async (tables, { before = 'Doctor list' } = {}) => {
    const esc = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const para = (text) => `<w:p><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
    const cell = (c) => {
        const spec = typeof c === 'object' ? c : { text: c };
        const span = spec.span ? `<w:tcPr><w:gridSpan w:val="${spec.span}"/></w:tcPr>` : '<w:tcPr/>';
        const body = (spec.paragraphs || [spec.text ?? '']).map(para).join('');
        return `<w:tc>${span}${body}</w:tc>`;
    };
    const table = (rows) => `<w:tbl><w:tblPr/>${rows.map((r) => `<w:tr>${r.map(cell).join('')}</w:tr>`).join('')}</w:tbl>`;
    const xml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        para(before) +
        tables.map((t) => table(t) + para('')).join('') +
        '</w:body></w:document>';

    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
    zip.file('word/document.xml', xml);
    return zip.generateAsync({ type: 'nodebuffer' });
};

module.exports = { makePdf, makeDocx };
