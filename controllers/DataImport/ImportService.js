// Data Import Center: upload -> match columns -> check -> import -> (undo).
const ExcelJS = require('exceljs');
const { fail, isGuid } = require('../../utils/access');
const { writeAudit } = require('../../utils/audit');
const { generateUUID } = require('../../utils/commonUtils');
const { ENTITIES, ENTITY_TYPES, isMatchable } = require('./entities');
const { parseFile } = require('./parseFile');
const { detectKind } = require('./detectKind');
const { parseMonth } = require('./statement');
const { suggestColumnMap, cleanColumnMap, missingRequired } = require('./columnMatch');
const { checkRows, lookupKey } = require('./validate');
const W = require('./writers');
const DA = require('./ImportDA');
const sql = require('./sql');

const CHUNK = 1000; // rows per bulk statement
const MAX_ISSUE_ROWS = 2000; // problem rows sent to the screen (the CSV has all of them)
const SKIP_TABLES = ['ImportBatches', 'ImportRows', 'ImportLinks', 'AuditLog'];

const json = (value) => JSON.stringify(value ?? null);
const parse = (text, fallback) => {
    try {
        return text ? JSON.parse(text) : fallback;
    } catch {
        return fallback;
    }
};
const chunks = (list, size = CHUNK) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
const lower = (id) => (id == null ? null : String(id).toLowerCase());

const requireType = (entityType) => {
    if (!ENTITIES[entityType]) throw fail(400, 'Unknown import type.');
    return ENTITIES[entityType];
};

const getBatch = async (batchId) => {
    if (!isGuid(batchId)) throw fail(400, 'Import is invalid.');
    const batch = (await DA.customQuery(sql.GET_BATCH(), { BatchId: batchId }))[0];
    if (!batch) throw fail(404, 'Import not found.');
    return {
        ...batch,
        Headers: parse(batch.Headers, []),
        ColumnMap: parse(batch.ColumnMap, {}),
        ValueMap: parse(batch.ValueMap, {}),
        Options: parse(batch.Options, {}),
        Summary: parse(batch.Summary, null),
    };
};

const loadRows = async (batchId) =>
    (await DA.customQuery(sql.LIST_ROWS(), { BatchId: batchId })).map((r) => ({
        rowNumber: r.RowNumber,
        values: parse(r.RawData, {}),
        status: r.Status,
        messages: parse(r.Messages, []),
        decision: r.Decision,
        action: r.Action,
        entityId: r.EntityId,
    }));

// Field descriptions for the screen.
const describeFields = (entityType) =>
    ENTITIES[entityType].fields.map(({ key, label, kind, required, requiredUnless, ref, values, feature }) => ({
        key,
        label,
        kind,
        required: Boolean(required),
        requiredUnless: requiredUnless || null,
        ref: ref || null,
        values: values || null,
        feature: feature || null,
    }));

// ---------------------------------------------------------
// Catalogue and templates
// ---------------------------------------------------------

exports.getCatalogue = async () => {
    const batches = await DA.customQuery(sql.LIST_BATCHES());
    return {
        types: ENTITY_TYPES.map((type) => {
            const def = ENTITIES[type];
            const imported = batches.filter((b) => b.EntityType === type && b.Status === 'IMPORTED');
            return {
                type,
                label: def.label,
                singular: def.singular,
                description: def.description,
                order: def.order,
                dependsOn: def.dependsOn || [],
                fields: describeFields(type),
                importedBatches: imported.length,
                importedRows: imported.reduce((sum, b) => sum + ((parse(b.Summary, {}) || {}).created || 0), 0),
            };
        }),
        history: batches.map((b) => ({ ...b, Summary: parse(b.Summary, null) })),
    };
};

exports.buildTemplate = async (entityType) => {
    const def = requireType(entityType);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(def.label);

    sheet.columns = def.fields.map((field) => ({
        header: field.required ? `${field.label} *` : field.label,
        key: field.key,
        width: Math.max(14, field.label.length + 4),
    }));
    sheet.getRow(1).font = { bold: true };
    sheet.addRow(def.example);
    sheet.getRow(2).font = { italic: true, color: { argb: 'FF5B6676' } };
    // Phone-like columns as text so Excel keeps every digit.
    def.fields.forEach((field, i) => {
        if (field.kind === 'phone' || field.kind === 'code') sheet.getColumn(i + 1).numFmt = '@';
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    const notes = workbook.addWorksheet('How to fill');
    notes.columns = [
        { header: 'Column', key: 'label', width: 24 },
        { header: 'Required', key: 'required', width: 10 },
        { header: 'What to enter', key: 'help', width: 80 },
    ];
    notes.getRow(1).font = { bold: true };
    const help = {
        code: 'Its ID in your previous app. Lets later files refer to it and lets you re-import changes safely.',
        text: 'Plain text.',
        phone: 'Mobile or landline. Keep the column formatted as Text.',
        email: 'A valid email address.',
        date: 'dd-mm-yyyy, for example 14-03-1972.',
        int: 'A whole number.',
        enum: 'One of the listed values.',
        active: 'Yes or No. Blank means Yes.',
        ref: 'The name (or old-app code) of a record that already exists in Pharmalyx.',
        refList: 'One or more names separated by commas.',
        qty: 'A whole number of units. Blank means 0.',
        money: 'Price per unit in rupees.',
        month: 'The statement month, e.g. Feb 2023 or 2023-02.',
    };
    def.fields.forEach((field) =>
        notes.addRow({
            label: field.label,
            required: field.required ? 'Yes' : '',
            help: `${help[field.kind] || ''}${field.values ? ` Allowed: ${field.values.join(', ')}.` : ''}${field.max ? ` Up to ${field.max} characters.` : ''}`,
        })
    );
    notes.addRow({});
    notes.addRow({ label: 'Note', help: 'Row 2 of the first sheet is an example. Replace it with your data. Column names may differ; you match them after uploading.' });

    return { fileName: `pharmalyx-${def.singular}-template.xlsx`, buffer: Buffer.from(await workbook.xlsx.writeBuffer()) };
};

// ---------------------------------------------------------
// Upload
// ---------------------------------------------------------

exports.upload = async (actorId, entityType, { fileName, sourceSystem, buffer }) => {
    requireType(entityType);
    const name = String(fileName || 'upload').slice(0, 260);
    const source = String(sourceSystem || '').trim().slice(0, 100) || null;
    const { headers, rows, preamble } = await parseFile(name, buffer);
    // A file that isn't a list (e.g. a stock & sales statement) is flagged on the next screen.
    const detected = detectKind(headers, preamble, rows.length);
    const options = json({ existing: 'SKIP', detected, defaults: entityType === 'STATEMENT' ? statementDefaults(detected) : {} });

    let previous = null;
    if (source) {
        const last = (await DA.customQuery(sql.LAST_COLUMN_MAP(), { EntityType: entityType, SourceSystem: source }))[0];
        previous = last ? { columnMap: parse(last.ColumnMap, {}), valueMap: parse(last.ValueMap, {}) } : null;
    }
    const columnMap = suggestColumnMap(entityType, headers, previous?.columnMap);

    const batchId = generateUUID();
    const now = new Date();
    await DA.inTransaction(async (run) => {
        await run(sql.INSERT_BATCH(), {
            BatchId: batchId,
            EntityType: entityType,
            SourceSystem: source,
            FileName: name,
            TotalRows: rows.length,
            Headers: json(headers),
            ColumnMap: json(columnMap),
            Options: options,
            CreatedBy: actorId,
            Now: now,
        });
        for (const part of chunks(rows)) {
            await run(sql.INSERT_ROWS(), { BatchId: batchId, Rows: json(part.map((r) => ({ RowNumber: r.rowNumber, RawData: r.values }))) });
        }
    });

    // Value matches from last time are carried over too.
    if (previous?.valueMap) {
        await DA.customQuery(sql.SAVE_MAPS(), { BatchId: batchId, ColumnMap: json(columnMap), ValueMap: json(previous.valueMap), Options: options, SourceSystem: source });
    }

    return exports.getUpload(batchId);
};

// Batch details for the column-matching step.
exports.getUpload = async (batchId) => {
    const batch = await getBatch(batchId);
    const sample = (await loadRows(batchId)).slice(0, 5).map((r) => r.values);
    return {
        batchId: batch.BatchId,
        entityType: batch.EntityType,
        fileName: batch.FileName,
        sourceSystem: batch.SourceSystem,
        status: batch.Status,
        totalRows: batch.TotalRows,
        headers: batch.Headers,
        columnMap: batch.ColumnMap,
        valueMap: batch.ValueMap,
        options: batch.Options,
        detected: batch.Options?.detected || null,
        summary: batch.Summary,
        fields: describeFields(batch.EntityType),
        sample,
    };
};

// ---------------------------------------------------------
// Check
// ---------------------------------------------------------

const cleanValueMap = (entityType, valueMap) => {
    const out = {};
    ENTITIES[entityType].fields.filter(isMatchable).forEach((field) => {
        const entries = Object.entries(valueMap?.[field.key] || {}).filter(([, v]) => v);
        if (entries.length) out[field.key] = Object.fromEntries(entries.map(([raw, v]) => [lookupKey(raw), String(v)]));
    });
    return out;
};

const runCheck = async (batch, rows) => {
    const ctx = await DA.loadContext(batch.EntityType);
    const { defaults = {}, detected = null, ...options } = batch.Options || {};
    return { ctx, ...checkRows(batch.EntityType, rows, ctx, { columnMap: batch.ColumnMap, valueMap: batch.ValueMap, defaults, options, detected }) };
};

// Values typed for a whole column ("every row is in Tirupati"), known fields only.
const cleanDefaults = (entityType, defaults) =>
    Object.fromEntries(
        ENTITIES[entityType].fields
            .filter((field) => field.kind !== 'code' && String(defaults?.[field.key] ?? '').trim())
            .map((field) => [field.key, String(defaults[field.key]).trim().slice(0, 250)])
    );

// What place values can be matched to instead of creating a new record.
const placeChoices = (ctx) => ({
    STATE: [...new Set(ctx.refs.STATE_HOME.values())].map((s) => ({ id: s.id, label: s.label })),
    TERRITORY: [...new Set(ctx.refs.TERRITORY.values())].map((t) => ({ id: t.id, label: t.label })),
    AREA: [...ctx.refs.AREA.byId.values()].map((a) => ({ id: a.id, label: `${a.label} · ${a.territoryName || ''}` })),
    ...(ctx.refs.PRODUCT && {
        PRODUCT: [...new Set(ctx.refs.PRODUCT.values())].map((p) => ({ id: p.id, label: p.label })).sort((a, b) => a.label.localeCompare(b.label)),
        STOCKIST: [...new Set(ctx.refs.STOCKIST.values())].map((x) => ({ id: x.id, label: x.label })).sort((a, b) => a.label.localeCompare(b.label)),
    }),
});
const PLACE_FIELD = { STATE: 'state', TERRITORY: 'territory', AREA: 'area', PRODUCT: 'product', STOCKIST: 'stockist' };

const rowView = (r, raw) => ({
    rowNumber: r.rowNumber,
    status: r.status,
    action: r.action,
    allowed: r.allowed,
    match: r.match ? { id: r.match.id, label: r.match.label, how: r.match.how, possible: Boolean(r.match.possible) } : null,
    messages: r.messages,
    values: raw,
});

exports.check = async (actorId, batchId, payload = {}) => {
    const batch = await getBatch(batchId);
    if (!['UPLOADED', 'CHECKED'].includes(batch.Status)) throw fail(409, 'This import has already run.');

    const columnMap = cleanColumnMap(batch.EntityType, batch.Headers, payload.columnMap || batch.ColumnMap);
    // Reopening a checked import keeps its last choices.
    const previous = batch.Options || {};
    const defaults = payload.defaults ? cleanDefaults(batch.EntityType, payload.defaults) : previous.defaults || {};
    const missing = missingRequired(batch.EntityType, columnMap, defaults);
    if (missing.length) throw fail(400, `Choose a column, or type a value for every row, for: ${missing.join(' or ')}.`);

    batch.ColumnMap = columnMap;
    batch.ValueMap = payload.valueMap ? cleanValueMap(batch.EntityType, payload.valueMap) : batch.ValueMap;
    const existing = payload.options?.existing ?? previous.existing;
    const createMissing = payload.options?.createMissing ?? previous.createMissing ?? true;
    batch.Options = { existing: existing === 'UPDATE' ? 'UPDATE' : 'SKIP', createMissing: createMissing !== false, defaults, detected: previous.detected || null };
    const sourceSystem = payload.sourceSystem !== undefined ? String(payload.sourceSystem || '').trim().slice(0, 100) || null : batch.SourceSystem;

    const rows = await loadRows(batchId);
    const decisions = new Map((payload.decisions || []).map((d) => [Number(d.rowNumber), d.decision]));
    rows.forEach((r) => {
        if (decisions.has(r.rowNumber)) r.decision = ['CREATE', 'UPDATE', 'SKIP'].includes(decisions.get(r.rowNumber)) ? decisions.get(r.rowNumber) : null;
    });

    const { ctx, results, summary, unresolved, places, statement } = await runCheck(batch, rows);

    await DA.inTransaction(async (run) => {
        await run(sql.SAVE_MAPS(), { BatchId: batchId, ColumnMap: json(columnMap), ValueMap: json(batch.ValueMap), Options: json(batch.Options), SourceSystem: sourceSystem });
        for (const part of chunks(results)) {
            await run(sql.SAVE_CHECK(), {
                BatchId: batchId,
                Rows: json(part.map((r) => ({ RowNumber: r.rowNumber, Status: r.status, Messages: r.messages, MatchEntityId: r.match?.id || null }))),
            });
        }
        if (decisions.size) {
            for (const part of chunks(rows.filter((r) => decisions.has(r.rowNumber)))) {
                await run(sql.SAVE_DECISIONS(), { BatchId: batchId, Rows: json(part.map((r) => ({ RowNumber: r.rowNumber, Decision: r.decision }))) });
            }
        }
        await run(sql.MARK_CHECKED(), { BatchId: batchId, Summary: json(summary), Now: new Date() });
    });

    // Unknown values, with what each can be matched to.
    const fields = ENTITIES[batch.EntityType].fields;
    const refs = [...new Set(Object.keys(unresolved).map((key) => fields.find((f) => f.key === key)?.ref).filter(Boolean))];
    const choices = { ...(await DA.loadChoices(refs.filter((ref) => !PLACE_FIELD[ref]))), ...placeChoices(ctx) };
    const unknownValues = Object.entries(unresolved).map(([key, values]) => {
        const field = fields.find((f) => f.key === key);
        return {
            field: key,
            label: field.label,
            required: Boolean(field.required),
            choices: field.kind === 'enum' ? field.values.map((v) => ({ id: v, label: v })) : choices[field.ref] || [],
            values,
        };
    });

    const rawByRow = new Map(rows.map((r) => [r.rowNumber, r.values]));
    const issues = results.filter((r) => r.status !== 'READY' || r.match);

    // States / territories / areas the import will create, and spellings it corrected.
    const newPlaces = places.planned.map((p) => ({ ...p, field: PLACE_FIELD[p.type], choices: choices[p.type] || [] }));
    const corrections = places.corrected.map((c) => ({ ...c, choices: choices[fields.find((f) => f.key === c.field)?.ref] || [] }));

    const notices = [];
    if (columnMap.address && fields.some((f) => f.key === 'address' && f.feature === 'clinicAddress') && !ctx.features.clinicAddress) {
        notices.push('Clinic addresses will be skipped: run the database script DataImport/schema.sql again to add the address column, then check again.');
    }

    return {
        batchId,
        summary,
        unknownValues,
        newPlaces,
        corrections,
        notices,
        statement: statement || null,
        valueMap: batch.ValueMap,
        options: batch.Options,
        issues: issues.slice(0, MAX_ISSUE_ROWS).map((r) => rowView(r, rawByRow.get(r.rowNumber))),
        issuesTruncated: issues.length > MAX_ISSUE_ROWS,
    };
};

// All problem rows as CSV: the original columns plus what to fix.
exports.issuesCsv = async (batchId) => {
    const batch = await getBatch(batchId);
    const rows = await loadRows(batchId);
    const flagged = rows.filter((r) => ['ERROR', 'WARNING'].includes(r.status));
    const cell = (value) => {
        const textValue = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? '');
        return /[",\n\r]/.test(textValue) ? `"${textValue.replace(/"/g, '""')}"` : textValue;
    };
    const lines = [
        ['Row', 'Status', 'Problems', ...batch.Headers].map(cell).join(','),
        ...flagged.map((r) =>
            [
                r.rowNumber,
                r.status === 'ERROR' ? 'Error' : 'Warning',
                r.messages.filter((m) => m.level !== 'info').map((m) => m.text).join(' | '),
                ...batch.Headers.map((h) => r.values[h]),
            ]
                .map(cell)
                .join(',')
        ),
    ];
    const base = batch.FileName.replace(/\.[^.]+$/, '');
    return { fileName: `${base}-to-fix.csv`, text: `﻿${lines.join('\r\n')}` };
};

// Values typed for every row of a statement, read from its letterhead and period.
const statementDefaults = (detected) => {
    if (!detected) return {};
    const month = detected.period ? parseMonth(detected.period) : null;
    return Object.fromEntries(
        Object.entries({
            stockist: detected.from,
            month: month && month.slice(0, 7),
            state: detected.state,
            territory: detected.town,
        }).filter(([, value]) => value)
    );
};

// Changes what an uploaded file is imported as (before it's imported).
exports.retype = async (actorId, batchId, entityType) => {
    requireType(entityType);
    const batch = await getBatch(batchId);
    if (!['UPLOADED', 'CHECKED'].includes(batch.Status)) throw fail(409, 'This import has already run.');

    const detected = batch.Options?.detected || null;
    const columnMap = suggestColumnMap(entityType, batch.Headers);
    const options = { existing: 'SKIP', detected, defaults: entityType === 'STATEMENT' ? statementDefaults(detected) : {} };
    await DA.customQuery(sql.RETYPE_BATCH(), { BatchId: batchId, EntityType: entityType, ColumnMap: json(columnMap), Options: json(options) });
    return exports.getUpload(batchId);
};

exports.cancel = async (batchId) => {
    await getBatch(batchId);
    await DA.customQuery(sql.CANCEL_BATCH(), { BatchId: batchId });
    return { cancelled: true };
};

// ---------------------------------------------------------
// Import
// ---------------------------------------------------------

// Area codes continue each territory's sequence: CHI-001, CHI-002, ...
const areaCodeMaker = (ctx) => {
    const next = new Map();
    ctx.refs.AREA.byTerritory.forEach((areas, territoryId) => {
        let max = 0;
        areas.forEach((a) => {
            const n = parseInt(String(a.code || '').slice(-3), 10);
            if (Number.isInteger(n) && n > max) max = n;
        });
        next.set(territoryId, max + 1);
    });
    return (territoryId) => (name) => {
        const key = lower(territoryId);
        const n = next.get(key) || 1;
        next.set(key, n + 1);
        return `${String(name).replace(/\s+/g, '').slice(0, 3).toUpperCase()}-${String(n).padStart(3, '0')}`;
    };
};

const rowRecord = (writer, values, id, extra) => {
    const record = { [writer.idColumn]: id };
    writer.columns.forEach(([column, , value]) => {
        const v = value(values, extra);
        record[column] = v instanceof Date ? v.toISOString() : v ?? null;
    });
    return record;
};

exports.commit = async (actorId, batchId) => {
    const batch = await getBatch(batchId);
    if (batch.Status !== 'CHECKED') throw fail(409, batch.Status === 'IMPORTED' ? 'This file has already been imported.' : 'Check the file before importing.');

    const rows = await loadRows(batchId);

    // Check again: data may have changed since the last check.
    const { ctx, results, summary } = await runCheck(batch, rows);
    const writer = W.forFeatures(W.WRITERS[batch.EntityType], ctx.features);
    const toCreate = results.filter((r) => r.action === 'CREATE');
    const toUpdate = results.filter((r) => r.action === 'UPDATE');
    if (!toCreate.length && !toUpdate.length) throw fail(400, 'No rows are ready to import.');

    const nextCode = areaCodeMaker(ctx);
    const now = new Date();

    // New states / territories / areas that the imported rows use get real ids first,
    // so every record built below points at them.
    const newPlaces = Object.fromEntries(W.MASTER_ORDER.map((type) => [type, new Set()]));
    const addPlace = (item) => {
        if (!item?.isNew || newPlaces[item.type].has(item)) return;
        newPlaces[item.type].add(item);
        addPlace(item.state);
        addPlace(item.territory);
        addPlace(item.area);
    };
    [...toCreate, ...toUpdate].forEach((r) => [r.values.state, r.values.territory, r.values.area, r.values.stockist, r.values.product].forEach(addPlace));
    W.MASTER_ORDER.forEach((type) => newPlaces[type].forEach((item) => (item.id = generateUUID())));
    const masterRecords = Object.fromEntries(W.MASTER_ORDER.map((type) => [type, [...newPlaces[type]].map((item) => W.MASTERS[type].record(item, nextCode))]));
    const createdMasters = Object.fromEntries(W.MASTER_ORDER.map((type) => [type, masterRecords[type].map((record) => record[W.MASTERS[type].idColumn])]));

    const idOfRow = new Map(); // rowNumber -> record id (new or matched)
    toCreate.forEach((r) => idOfRow.set(r.rowNumber, generateUUID()));
    toUpdate.forEach((r) => idOfRow.set(r.rowNumber, r.match.id));

    // A statement file becomes one statement; its rows are the lines.
    const statementId = batch.EntityType === 'STATEMENT' ? generateUUID() : null;
    const createRecords = toCreate.map((r) =>
        rowRecord(writer, r.values, idOfRow.get(r.rowNumber), { creating: true, actorId, statementId, nextAreaCode: nextCode(r.values.territory?.id) })
    );
    const updateRecords = toUpdate.map((r) => rowRecord(writer, r.values, idOfRow.get(r.rowNumber), { creating: false, actorId }));

    const outcome = await DA.inTransaction(async (run) => {
        await run(sql.CLAIM_BATCH(), { BatchId: batchId, ActorId: actorId, Now: now, Summary: json(summary) });

        for (const type of W.MASTER_ORDER) {
            for (const part of chunks(masterRecords[type])) await run(W.MASTERS[type].insert, { Rows: json(part), Now: now });
        }

        // Values before the update, kept for undo.
        const previous = new Map();
        for (const part of chunks(toUpdate)) {
            const found = await run(W.previousSql(writer), { Ids: json(part.map((r) => idOfRow.get(r.rowNumber))) });
            found.forEach((row) => {
                const { EntityId, ...rest } = row;
                // DATE columns come back as timestamps; keep the plain date so undo restores it exactly.
                writer.columns.forEach(([column, type]) => {
                    if (type === 'DATE' && rest[column] instanceof Date) rest[column] = rest[column].toISOString().slice(0, 10);
                });
                previous.set(lower(EntityId), rest);
            });
        }

        if (statementId) {
            const { stockist, month } = toCreate[0].values;
            const sum = (column) => Math.round(createRecords.reduce((total, line) => total + Number(line[column] || 0), 0) * 100) / 100;
            await run(W.INSERT_STATEMENT_SQL, {
                StatementId: statementId,
                StockistId: stockist.id,
                StatementMonth: month,
                UserId: ctx.stockistOwner.get(lower(stockist.id)) || actorId,
                TotalSalesQty: createRecords.reduce((total, line) => total + line.SalesQty, 0),
                SalesValue: sum('SalesValue'),
                ClosingValue: sum('ClosingValue'),
                Remarks: `Imported from ${batch.FileName}`.slice(0, 500),
                ActorId: actorId,
                Now: now,
            });
        }

        for (const part of chunks(createRecords)) await run(W.insertSql(writer), { Rows: json(part), Now: now });
        for (const part of chunks(updateRecords)) await run(W.updateSql(writer), { Rows: json(part), Now: now });

        // Owned rows (territory divisions, user territories, ...), added where missing.
        for (const child of writer.children) {
            const childRows = [...toCreate, ...toUpdate].flatMap((r) => child.rows(r.values, idOfRow.get(r.rowNumber)));
            for (const part of chunks(childRows)) await run(child.insert, { Rows: json(part), Now: now });
        }

        // Managers, now that every user in the file exists.
        if (batch.EntityType === 'USER') {
            const managerRows = [...toCreate, ...toUpdate]
                .filter((r) => r.values.manager)
                .map((r) => {
                    const m = r.values.manager;
                    const managerId = m.row ? idOfRow.get(m.row) || results.find((x) => x.rowNumber === m.row)?.match?.id : m.id;
                    return managerId ? { UserId: idOfRow.get(r.rowNumber), ManagerId: managerId } : null;
                })
                .filter(Boolean);
            for (const part of chunks(managerRows)) await run(W.SET_MANAGERS_SQL, { Rows: json(part), Now: now });
        }

        // Old-app codes -> records, for re-imports and for later files that refer to them.
        const linkRows = results
            // A "possible duplicate" that was skipped isn't linked: the match is only a guess.
            .filter((r) => r.values.code && r.status !== 'ERROR' && (idOfRow.get(r.rowNumber) || (r.match && !r.match.possible)))
            .map((r) => ({ LegacyCode: String(r.values.code).slice(0, 100), EntityId: idOfRow.get(r.rowNumber) || r.match.id }));
        for (const part of chunks(linkRows)) await run(sql.INSERT_LINKS(), { EntityType: batch.EntityType, BatchId: batchId, Rows: json(part), Now: now });

        const resultRows = results.map((r) => {
            const id = idOfRow.get(r.rowNumber) || null;
            const action = r.action === 'CREATE' ? 'CREATED' : r.action === 'UPDATE' ? 'UPDATED' : 'SKIPPED';
            return {
                RowNumber: r.rowNumber,
                Status: r.status === 'ERROR' ? 'ERROR' : action === 'SKIPPED' ? 'SKIPPED' : 'IMPORTED',
                Action: action,
                EntityId: id,
                PreviousData: action === 'UPDATED' ? previous.get(lower(id)) || null : null,
            };
        });
        for (const part of chunks(resultRows)) await run(sql.SAVE_RESULTS(), { BatchId: batchId, Rows: json(part) });

        const result = {
            created: toCreate.length,
            updated: toUpdate.length,
            skipped: results.length - toCreate.length - toUpdate.length,
            newStates: createdMasters.STATE.length,
            newTerritories: createdMasters.TERRITORY.length,
            newAreas: createdMasters.AREA.length,
            newStockists: createdMasters.STOCKIST.length,
            newProducts: createdMasters.PRODUCT.length,
        };
        // Saved with the import itself, so undo always knows what to remove.
        await run('UPDATE dbo.ImportBatches SET Summary = @Summary WHERE BatchId = @BatchId', {
            BatchId: batchId,
            Summary: json({ ...summary, ...result, createdMasters, statementId }),
        });
        return result;
    });

    await writeAudit({ entityType: 'IMPORT_BATCH', entityId: batchId, action: 'IMPORT', actorId, after: { type: batch.EntityType, file: batch.FileName, ...outcome } });

    return { batchId, ...outcome };
};

// ---------------------------------------------------------
// Undo
// ---------------------------------------------------------

exports.undo = async (actorId, batchId) => {
    const batch = await getBatch(batchId);
    if (batch.Status !== 'IMPORTED') throw fail(409, 'Only a completed import can be undone.');

    const later = (await DA.customQuery(sql.LATER_IMPORT(), { EntityType: batch.EntityType, ImportedOn: batch.ImportedOn, BatchId: batchId }))[0];
    if (later) throw fail(409, `Undo the later import "${later.FileName}" first.`);

    const writer = W.forFeatures(W.WRITERS[batch.EntityType], (await DA.loadFeatures()) || {});
    const skipTables = [...SKIP_TABLES, ...writer.children.map((c) => c.table.replace(/^dbo\./, ''))];
    const createdMasters = batch.Summary?.createdMasters || {};
    const masterTypes = [...W.MASTER_ORDER].reverse().filter((type) => createdMasters[type]?.length);
    const masterColumns = {};
    for (const type of masterTypes) {
        const owned = (W.MASTERS[type].owned || []).map((table) => table.replace(/^dbo\./, ''));
        masterColumns[type] = await DA.customQuery(sql.REFERENCE_COLUMNS(), { Columns: json(W.MASTERS[type].referenceColumns), SkipTables: json([...SKIP_TABLES, ...owned]), IncludeActors: 0 });
    }
    const columns = await DA.customQuery(sql.REFERENCE_COLUMNS(), {
        Columns: json(writer.referenceColumns),
        SkipTables: json(skipTables),
        IncludeActors: writer.includeActors ? 1 : 0,
    });

    const now = new Date();
    const result = await DA.inTransaction(async (run) => {
        // 1. Put updated records back first (their old values may be what other rows point to).
        if (writer.update.length) await run(W.restoreSql(writer), { BatchId: batchId, Now: now });

        // 2. Records this import created must not be in use yet.
        if (columns.length) {
            const counts = (await run(W.referenceCountSql(writer, columns), { BatchId: batchId })).filter((c) => c.n > 0);
            if (counts.length) {
                const where = counts.map((c) => `${c.n} in ${c.tableName}`).join(', ');
                throw fail(409, `Can't undo: records from this import are already in use (${where}). Deactivate them instead.`);
            }
        }

        // 3. Remove created records (and a statement import's statement).
        await run(W.deleteCreatedSql(writer), { BatchId: batchId });
        if (batch.Summary?.statementId) await run(W.DELETE_STATEMENT_SQL, { StatementId: batch.Summary.statementId });

        // 4. Products, stockists, areas, territories and states the import created (in that order), if nothing else uses them now.
        for (const type of masterTypes) {
            const master = W.MASTERS[type];
            const inputs = { MasterIds: json(createdMasters[type]) };
            if (masterColumns[type].length) {
                const counts = (await run(W.referenceCountSql(master, masterColumns[type], W.MASTER_IDS_SQL), inputs)).filter((c) => c.n > 0);
                if (counts.length) {
                    const where = counts.map((c) => `${c.n} in ${c.tableName}`).join(', ');
                    throw fail(409, `Can't undo: ${type.toLowerCase()} records this import created are now used elsewhere (${where}).`);
                }
            }
            await run(W.deleteMasterSql(master), inputs);
        }

        await run(sql.MARK_UNDONE(), { BatchId: batchId, ActorId: actorId, Now: now });
        return { undone: true };
    });

    await writeAudit({ entityType: 'IMPORT_BATCH', entityId: batchId, action: 'UNDO', actorId, after: { type: batch.EntityType, file: batch.FileName } });
    return result;
};
