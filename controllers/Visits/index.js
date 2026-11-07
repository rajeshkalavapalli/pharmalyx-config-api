const express = require('express');

const router = express.Router();

const Visits = require('./VisitsHandler');

router.get('/visits', Visits.getVisits);
router.get('/visits/follow-ups', Visits.getFollowUps);
router.get('/visits/:visitId', Visits.getVisitById);

// Voice note on a visit: raw audio body (m4a / 3gp / aac ...), optional ?duration= in seconds.
const VoiceNotes = require('./VoiceNotes');
const { actingUser } = require('../../utils/http');
const rawAudio = (req, res, next) =>
    express.raw({ type: () => true, limit: '4mb' })(req, res, (error) => {
        if (error) return res.status(error.status === 413 ? 413 : 400).json({ message: error.status === 413 ? 'The recording is too long.' : 'Could not read the recording.' });
        return next();
    });
router.post('/visits/:visitId/voice', rawAudio, async (req, res) => {
    try {
        res.status(201).json(await VoiceNotes.upload(actingUser(req), req.params.visitId, req.body, req.query.duration));
    } catch (error) {
        if (!error.status) console.error('Error saving the voice note:', error);
        res.status(error.status || 500).json({ message: error.status ? error.message : 'Failed to save the voice note.' });
    }
});
router.get('/visits/:visitId/voice', async (req, res) => {
    try {
        const note = await VoiceNotes.get(actingUser(req), req.params.visitId);
        res.set('Content-Type', note.contentType).set('Cache-Control', 'private, max-age=300').send(note.buffer);
    } catch (error) {
        if (!error.status) console.error('Error opening the voice note:', error);
        res.status(error.status || 500).json({ message: error.status ? error.message : 'Failed to open the voice note.' });
    }
});
router.post('/visits', Visits.createVisit);

module.exports = router;
