const UserDoctorMappingService = require('./UserDoctorMappingService');


exports.createuserdoctormapping = async (req, res) => {
    try {
        const { userId, mappings } = req.body;
        const result = await UserDoctorMappingService.createUserDoctorMappings(
            userId,
            mappings
        );

        res.status(201).json(result);
    } catch (err) {
        console.error("error creating user doctor mapping", err);
        res.status(err.statusCode || 400).json({
            success: false,
            message: err.message || "Failed to save user doctor mapping",
        });
    }
}

exports.getUserDoctorMappings = async (req, res) => {
    try {
        const result = await UserDoctorMappingService.getUserDoctorMappings();

        res.status(200).json({
            result,
        });
    } catch (err) {
        console.error("error getting user doctor mappings", err);
        res.status(500).json({
            success: false,
            message: err.message || "Failed to get user doctor mappings",
        });
    }
};
