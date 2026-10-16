const DcrService = require('./DcrService');

const actingUser = (req) => req.get('x-user-id') || null;

const respond = (res, label) => (error) => {
    console.error(`Error in DCR ${label}:`, error);

    return res.status(error.status || 500).json({
        message: error.status ? error.message : `Failed to ${label}.`,
        error: error.message,
    });
};

exports.getMonth = async (req, res) => {
    try {
        return res.status(200).json(await DcrService.getMonth(actingUser(req), req.query));
    } catch (error) {
        return respond(res, 'load DCR calendar')(error);
    }
};

exports.getDay = async (req, res) => {
    try {
        return res.status(200).json(await DcrService.getDay(actingUser(req), req.query));
    } catch (error) {
        return respond(res, 'load DCR')(error);
    }
};

exports.getPendingReviews = async (req, res) => {
    try {
        const reviews = await DcrService.getPendingReviews(actingUser(req));

        return res.status(200).json({ reviews });
    } catch (error) {
        return respond(res, 'load DCR reviews')(error);
    }
};

exports.submitDcr = async (req, res) => {
    try {
        const result = await DcrService.submitDcr(actingUser(req), req.body || {});

        return res.status(200).json({
            message: result.resubmitted ? 'DCR resubmitted for review.' : 'DCR sent to your manager for review.',
            data: result,
        });
    } catch (error) {
        return respond(res, 'submit DCR')(error);
    }
};

exports.approveDcr = async (req, res) => {
    try {
        const result = await DcrService.reviewDcr(
            actingUser(req),
            req.params.dcrId,
            'APPROVED',
            req.body?.remarks
        );

        return res.status(200).json({ message: 'DCR approved.', data: result });
    } catch (error) {
        return respond(res, 'approve DCR')(error);
    }
};

exports.returnDcr = async (req, res) => {
    try {
        const result = await DcrService.reviewDcr(
            actingUser(req),
            req.params.dcrId,
            'RETURNED',
            req.body?.remarks
        );

        return res.status(200).json({ message: 'DCR returned to the representative.', data: result });
    } catch (error) {
        return respond(res, 'return DCR')(error);
    }
};
