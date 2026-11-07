const fileStore = require('../../utils/fileStore');
const { customQuery } = require('../../utils/dbFunctions');
const { generateUUID } = require('../../utils/commonUtils');
const { canViewUser, fail, isGuid, requireActingUser, sameId } = require('../../utils/access');

// A short voice note on a visit (instead of typing). Stored like other uploads (fileStore); counts / names only in the DB.

const MAX_BYTES = 3 * 1024 * 1024; // about 3 minutes of speech
const missing = (error) => /Invalid object name 'dbo\.VisitVoiceNotes'/i.test(error?.message || '');

const VISIT = `SELECT TOP 1 VisitId, UserId FROM dbo.Visits WHERE VisitId = @VisitId`;
const INSERT = `INSERT INTO dbo.VisitVoiceNotes (NoteId, VisitId, UserId, StorageKey, ContentType, DurationSec, SizeBytes, CreatedOn)
                VALUES (@NoteId, @VisitId, @UserId, @StorageKey, @ContentType, @DurationSec, @SizeBytes, @Now)`;
const LATEST = `SELECT TOP 1 NoteId, StorageKey, ContentType, DurationSec FROM dbo.VisitVoiceNotes WHERE VisitId = @VisitId ORDER BY CreatedOn DESC`;

// Audio we accept, from the file's first bytes (m4a / mp4, 3gp, aac, webm, ogg, wav).
const sniffAudio = (b) => {
    if (!b || b.length < 12) return null;
    const box = b.slice(4, 8).toString('ascii');
    if (box === 'ftyp') return b.slice(8, 11).toString('ascii').startsWith('3g') ? { ext: '3gp', type: 'audio/3gpp' } : { ext: 'm4a', type: 'audio/mp4' };
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { ext: 'webm', type: 'audio/webm' };
    if (b.slice(0, 4).toString('ascii') === 'OggS') return { ext: 'ogg', type: 'audio/ogg' };
    if (b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WAVE') return { ext: 'wav', type: 'audio/wav' };
    if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return { ext: 'aac', type: 'audio/aac' };
    if (b.slice(0, 6).toString('ascii') === '#!AMR\n') return { ext: 'amr', type: 'audio/amr' };
    return null;
};

exports.upload = async (actingUserId, visitId, buffer, durationSec) => {
    requireActingUser(actingUserId);
    if (!isGuid(visitId)) throw fail(400, 'Visit is invalid.');
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw fail(400, 'No recording received.');
    if (buffer.length > MAX_BYTES) throw fail(413, 'The recording is too long (about 3 minutes at most).');
    const kind = sniffAudio(buffer);
    if (!kind) throw fail(400, 'Unsupported recording format.');

    const [visit] = await customQuery(VISIT, { VisitId: visitId });
    if (!visit) throw fail(404, 'Visit not found.');
    if (!sameId(visit.UserId, actingUserId)) throw fail(403, 'Only the person who made the visit can add its voice note.');

    const noteId = generateUUID();
    const key = `voice-notes/${String(visitId).toLowerCase()}/${noteId}.${kind.ext}`;
    const stored = await fileStore.put(key, buffer);
    try {
        await customQuery(INSERT, {
            NoteId: noteId, VisitId: visitId, UserId: actingUserId, StorageKey: stored.key, ContentType: kind.type,
            DurationSec: Number.isFinite(Number(durationSec)) ? Math.round(Number(durationSec)) : null, SizeBytes: buffer.length, Now: new Date(),
        });
    } catch (error) {
        await fileStore.remove(stored.key).catch(() => null);
        if (missing(error)) throw fail(503, 'Voice notes are not set up yet. Run their SQL in the database first.');
        throw error;
    }
    return { message: 'Voice note saved.', noteId };
};

// The visit's latest voice note (owner, their seniors, head office).
exports.get = async (actingUserId, visitId) => {
    requireActingUser(actingUserId);
    if (!isGuid(visitId)) throw fail(400, 'Visit is invalid.');
    const [visit] = await customQuery(VISIT, { VisitId: visitId });
    if (!visit) throw fail(404, 'Visit not found.');
    if (!(await canViewUser(actingUserId, visit.UserId))) throw fail(403, 'You cannot open this voice note.');
    let note;
    try {
        [note] = await customQuery(LATEST, { VisitId: visitId });
    } catch (error) {
        if (missing(error)) throw fail(404, 'No voice note.');
        throw error;
    }
    if (!note) throw fail(404, 'No voice note.');
    return { buffer: await fileStore.get(note.StorageKey), contentType: note.ContentType, durationSec: note.DurationSec };
};
