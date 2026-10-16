const DeviationService = require('./DeviationService');

const actingUser = (req) => req.get('x-user-id') || null;

const respond = (res, label) => (error) => {
    console.error(`Error in deviation ${label}:`, error);

    return res.status(error.status || 500).json({
        message: error.status ? error.message : `Failed to ${label}.`,
        error: error.message,
    });
};

exports.getDeviations = async (req, res) => {
    try {
        const result = await DeviationService.getDeviations(actingUser(req), req.query);

        return res.status(200).json(result);
    } catch (error) {
        return respond(res, 'load deviations')(error);
    }
};

exports.getDeviationById = async (req, res) => {
    try {
        const result = await DeviationService.getDeviationById(actingUser(req), req.params.deviationId);

        return res.status(200).json({ deviation: result });
    } catch (error) {
        return respond(res, 'load deviation')(error);
    }
};

exports.createDeviation = async (req, res) => {
    try {
        const result = await DeviationService.createDeviation(actingUser(req), req.body || {});

        return res.status(200).json({ message: 'Deviation submitted for review.', data: result });
    } catch (error) {
        return respond(res, 'submit deviation')(error);
    }
};

exports.approveDeviation = async (req, res) => {
    try {
        const result = await DeviationService.reviewDeviation(
            actingUser(req),
            req.params.deviationId,
            'APPROVED',
            req.body?.remarks
        );

        return res.status(200).json({ message: 'Deviation approved.', data: result });
    } catch (error) {
        return respond(res, 'approve deviation')(error);
    }
};

exports.rejectDeviation = async (req, res) => {
    try {
        const result = await DeviationService.reviewDeviation(
            actingUser(req),
            req.params.deviationId,
            'REJECTED',
            req.body?.remarks
        );

        return res.status(200).json({ message: 'Deviation rejected.', data: result });
    } catch (error) {
        return respond(res, 'reject deviation')(error);
    }
};
