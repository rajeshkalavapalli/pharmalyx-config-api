// Reads a table out of a text PDF (one exported from software, where the text can be selected)
// as a grid: [{ rowNumber, cells: [text] }], plus `preamble`: the text above the table
// (letterhead, title), which often names the company the document is from.
//
// A PDF only knows "this word is drawn at x, y", so the table is rebuilt:
//   1. words at the same height form a line; words close together on a line form a cell
//   2. the table's width is the most common number of cells per line; its columns sit where
//      those lines' cells sit
//   3. the header is the first such line when it's all text (a list), or the text lines just
//      above the first such line (a report whose rows are numbers, often a two-line header)
//   4. each later line's cells go to the nearest column; "-----" lines, group headings,
//      total lines, page numbers and headers repeated on each page are dropped
//   5. a short line with nothing in the first column continues the row above (a wrapped address)
//   6. the table ends where a separator is followed by something that isn't a row
//      (a totals block, a second table)
// Scanned PDFs have no text at all and get a clear message instead.
const { fail } = require('../../../utils/access');

const MAX_PAGES = 200;

let pdfjsPromise = null;
const loadPdfjs = () => {
    pdfjsPromise = pdfjsPromise || import('pdfjs-dist/legacy/build/pdf.mjs');
    return pdfjsPromise;
};

// ---------- 1. words -> lines -> cells ----------

const toLines = (items, page = 1) => {
    const words = items
        .filter((item) => item.str && item.str.trim())
        .map((item) => ({
            text: item.str,
            x: item.transform[4],
            y: item.transform[5],
            width: item.width,
            height: Math.abs(item.transform[3]) || item.height || 10,
        }))
        .sort((a, b) => b.y - a.y || a.x - b.x);

    const lines = [];
    words.forEach((word) => {
        const line = lines[lines.length - 1];
        if (line && Math.abs(line.y - word.y) <= Math.max(2, word.height * 0.45)) line.words.push(word);
        else lines.push({ y: word.y, words: [word] });
    });

    return lines.map((line) => {
        const sorted = line.words.sort((a, b) => a.x - b.x);
        const cells = [];
        sorted.forEach((word) => {
            const charWidth = word.width / Math.max(1, word.text.length) || word.height * 0.5;
            const cell = cells[cells.length - 1];
            const gap = cell ? word.x - cell.x1 : Infinity;
            const piece = { text: word.text.trim(), x0: word.x, x1: word.x + word.width };
            // A gap wider than about two characters starts a new cell.
            if (cell && gap < Math.max(4, charWidth * 2.2)) {
                cell.text += gap > charWidth * 0.2 && !cell.text.endsWith(' ') ? ` ${word.text}` : word.text;
                cell.x1 = Math.max(cell.x1, piece.x1);
                cell.words.push(piece);
            } else {
                cells.push({ text: word.text, x0: piece.x0, x1: piece.x1, words: [piece] });
            }
        });
        const clean = cells.map((c) => ({ ...c, text: c.text.replace(/\s+/g, ' ').trim() })).filter((c) => c.text);
        return Object.assign(clean, { page });
    });
};

// ---------- 2-6. lines -> table ----------

const SEPARATOR = /^[-=_.*~\s]{5,}$/;
const PAGE_NUMBER = /^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i;
const TOTALS = /^(grand\s+)?(sub\s*)?total\b|^(quantity|qty|value|amount)\b.*$|^total\s*:/i;
const NUMBERISH = /^[\d.,:/()%+\- ]+$/;

const isSeparator = (cells) => cells.length === 1 && SEPARATOR.test(cells[0].text);
const center = (c) => (c.x0 + c.x1) / 2;
const lineText = (cells) => cells.map((c) => c.text.toLowerCase()).join('|');
const median = (list) => {
    const sorted = [...list].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};

const toGrid = (allLines) => {
    const lines = allLines.filter((cells) => cells.length);
    const wide = lines.filter((cells) => cells.length >= 2 && !isSeparator(cells));
    if (!wide.length) return null;

    // 2. Table width and where its columns sit.
    const freq = new Map();
    wide.forEach((cells) => freq.set(cells.length, (freq.get(cells.length) || 0) + 1));
    const width = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    const full = lines.filter((cells) => cells.length === width);
    const centers = Array.from({ length: width }, (_, i) => median(full.map((cells) => center(cells[i]))));
    const nearest = (x) => centers.reduce((best, c, i) => (Math.abs(c - x) < Math.abs(centers[best] - x) ? i : best), 0);

    // 3. Header.
    const first = lines.findIndex((cells) => cells.length === width);
    const isText = (cells) => cells.slice(1).every((c) => !NUMBERISH.test(c.text)) && !NUMBERISH.test(cells[0].text);
    // A report: the first full-width line is already data (numbers), so the header sits above it.
    const report = !isText(lines[first]);
    let headerLines;
    let start;
    if (!report) {
        headerLines = [lines[first]];
        start = first + 1;
    } else {
        // Rows are numbers: the header is the text lines just above (up to 3), across separators.
        headerLines = [];
        for (let i = first - 1; i >= 0 && headerLines.length < 3; i -= 1) {
            if (isSeparator(lines[i])) {
                if (headerLines.length) break;
                continue;
            }
            if (lines[i].length < 2) {
                if (headerLines.length) break;
                continue; // a group heading right above the rows ("6-WISTERIA")
            }
            headerLines.unshift(lines[i]);
        }
        start = first;
    }

    // Each header word goes to the nearest column, so a two-line header reads "OPENING STOCK".
    const labels = Array(width).fill('');
    headerLines.forEach((cells) =>
        cells.forEach((cell) =>
            cell.words.forEach((word) => {
                const i = nearest((word.x0 + word.x1) / 2);
                labels[i] = labels[i] ? `${labels[i]} ${word.text}` : word.text;
            })
        )
    );
    const header = labels.map((label, i) => label.replace(/\s+/g, ' ').trim() || `Column ${i + 1}`);
    const headerKeys = new Set(headerLines.map(lineText));
    const preamble = lines
        .slice(0, Math.max(0, lines.indexOf(headerLines[0] ?? lines[first])))
        .filter((cells) => !isSeparator(cells))
        .map((cells) => cells.map((c) => c.text).join(' '));

    // 4-6. Rows.
    const rowLike = (cells) => cells.length >= Math.max(2, width - 2) && !TOTALS.test(cells[0].text);
    const rows = [];
    let previousPage = null;
    for (let i = start; i < lines.length; i += 1) {
        const cells = lines[i];
        if (isSeparator(cells)) {
            // A separator after the rows: the table goes on only if a real row follows.
            const next = lines.slice(i + 1).find((c) => !isSeparator(c));
            if (rows.length && next && !rowLike(next) && !headerKeys.has(lineText(next))) break;
            continue;
        }
        if (headerKeys.has(lineText(cells))) continue; // header repeated on a new page
        if (cells.length === 1 && PAGE_NUMBER.test(cells[0].text)) continue;
        if (TOTALS.test(cells[0].text)) continue;

        const row = Array(width).fill('');
        cells.forEach((cell) => {
            const index = cells.length === width ? cells.indexOf(cell) : nearest(center(cell));
            row[index] = row[index] ? `${row[index]} ${cell.text}` : cell.text;
        });
        const filled = row.filter(Boolean).length;

        // In a report, a lone line in the first column is a group heading ("6-WISTERIA"), not a row.
        // (In a list it may be a real row with only a name filled in, so it stays.)
        if (report && cells.length === 1 && row[0]) continue;

        // Nothing under the first column and at most half the columns filled, on the same
        // page: the rest of the row above (wrapped text), not a row of its own.
        const previous = rows[rows.length - 1];
        const samePage = previousPage === cells.page;
        previousPage = cells.page;
        if (!row[0] && previous && samePage && filled <= Math.max(1, Math.floor(width / 2))) {
            row.forEach((text, j) => {
                if (text) previous[j] = previous[j] ? `${previous[j]} ${text}` : text;
            });
            continue;
        }
        rows.push(row);
    }

    const grid = [header, ...rows].map((cells, i) => ({ rowNumber: i + 1, cells }));
    grid.preamble = preamble;
    return grid;
};

const readPdf = async (buffer) => {
    const pdfjs = await loadPdfjs();
    let doc;
    try {
        doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
    } catch (error) {
        if (error?.name === 'PasswordException') throw fail(400, 'This PDF is password-protected. Remove the password and upload it again.');
        throw fail(400, "This file couldn't be read as a PDF. Export the list as Excel or CSV instead.");
    }

    try {
        if (doc.numPages > MAX_PAGES) throw fail(400, `This PDF has ${doc.numPages} pages. Split it into files of up to ${MAX_PAGES} pages, or export the list as Excel.`);

        const lines = [];
        for (let page = 1; page <= doc.numPages; page += 1) {
            const content = await (await doc.getPage(page)).getTextContent();
            lines.push(...toLines(content.items, page));
        }

        if (!lines.length) {
            throw fail(400, "This PDF has no readable text: it's probably a scan or photo. Scanned files can't be read yet. Export the list from your old app as Excel/CSV, or type it into our template.");
        }

        const grid = toGrid(lines);
        if (!grid || grid.length < 2) throw fail(400, "Couldn't find a table in this PDF. Export the list as Excel or CSV instead.");
        return grid;
    } finally {
        await doc.destroy();
    }
};

module.exports = { readPdf, toLines, toGrid };
