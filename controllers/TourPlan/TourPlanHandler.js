const TourPlanService = require('./TourPlanServer');

const actingUser = (req) => req.get('x-user-id') || null;

const respond = (res, label) => (error) => {
    console.error(`Error in tour plan ${label}:`, error);

    return res.status(error.status || 500).json({
        message: error.status ? error.message : `Failed to ${label}.`,
        error: error.message,
    });
};

exports.getTourPlan = async (req, res) => {
    try {
        const result = await TourPlanService.getTourPlan(
            actingUser(req),
            req.query.userId,
            req.query.planMonth
        );

        return res.status(200).json(result);
    } catch (error) {
        return respond(res, 'load tour plan')(error);
    }
};

exports.createTourPlan = async (req, res) => {
    try {
        const result = await TourPlanService.saveTourPlan(actingUser(req), req.body || {});

        return res.status(200).json({
            message: result.Status === 'SUBMITTED'
                ? 'Tour plan submitted for approval.'
                : 'Tour plan saved as draft.',
            data: result,
        });
    } catch (error) {
        return respond(res, 'save tour plan')(error);
    }
};

exports.approveTourPlan = async (req, res) => {
    try {
        const result = await TourPlanService.approveTourPlan(actingUser(req), req.params.tourPlanId);

        return res.status(200).json({ message: 'Tour plan approved.', data: result });
    } catch (error) {
        return respond(res, 'approve tour plan')(error);
    }
};

exports.rejectTourPlan = async (req, res) => {
    try {
        const result = await TourPlanService.rejectTourPlan(actingUser(req), req.params.tourPlanId);

        return res.status(200).json({ message: 'Tour plan rejected.', data: result });
    } catch (error) {
        return respond(res, 'reject tour plan')(error);
    }
};
