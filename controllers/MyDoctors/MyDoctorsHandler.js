const MyDoctorsService = require('./MyDoctorsService');

const actingUser = (req) => req.get('x-user-id') || null;

const respond = (res, label) => (error) => {
    console.error(`Error in my doctors ${label}:`, error);

    return res.status(error.status || 500).json({
        message: error.status ? error.message : `Failed to ${label}.`,
        error: error.message,
    });
};

exports.getMyDoctors = async (req, res) => {
    try {
        const doctors = await MyDoctorsService.getMyDoctors(actingUser(req), req.query.userId);

        return res.status(200).json({ doctors });
    } catch (error) {
        return respond(res, 'load doctors')(error);
    }
};

exports.getTeam = async (req, res) => {
    try {
        const team = await MyDoctorsService.getTeam(actingUser(req));

        return res.status(200).json({ team });
    } catch (error) {
        return respond(res, 'load team')(error);
    }
};
