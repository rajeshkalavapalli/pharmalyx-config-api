const VisitsService = require('./VisitsService');

const actingUser = (req) => req.get('x-user-id') || null;

const respond = (res, label) => (error) => {
    console.error(`Error in visits ${label}:`, error);

    return res.status(error.status || 500).json({
        message: error.status ? error.message : `Failed to ${label}.`,
        error: error.message,
    });
};

const createdMessage = (result) => {
    if (result.duplicate) return 'Visit was already saved.';
    if (result.deviationCreated) return 'Visit logged. It was outside your plan, so a deviation was sent for review.';
    if (result.PlanStatus === 'OUT_OF_PLAN') return 'Visit logged and linked to an existing deviation.';
    return 'Visit logged.';
};

exports.getVisits = async (req, res) => {
    try {
        const visits = await VisitsService.getVisits(actingUser(req), req.query);

        return res.status(200).json({ visits });
    } catch (error) {
        return respond(res, 'load visits')(error);
    }
};

exports.getVisitById = async (req, res) => {
    try {
        const visit = await VisitsService.getVisitById(actingUser(req), req.params.visitId);

        return res.status(200).json({ visit });
    } catch (error) {
        return respond(res, 'load visit')(error);
    }
};

exports.getFollowUps = async (req, res) => {
    try {
        const followUps = await VisitsService.getFollowUps(actingUser(req), req.query.userId);

        return res.status(200).json({ followUps });
    } catch (error) {
        return respond(res, 'load follow-ups')(error);
    }
};

exports.createVisit = async (req, res) => {
    try {
        const result = await VisitsService.createVisit(actingUser(req), req.body || {});

        return res.status(result.duplicate ? 200 : 201).json({
            message: createdMessage(result),
            data: result,
        });
    } catch (error) {
        return respond(res, 'log visit')(error);
    }
};
