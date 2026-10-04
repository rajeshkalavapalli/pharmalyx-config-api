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

exports.updateUserDoctorMapping = async (req, res) => {
    try {
        const { userId, doctorId } = req.body;
        const result = await UserDoctorMappingService.updateUserDoctorMapping({
            UserId: userId,
            DoctorId: doctorId
        });

        res.status(200).json(result);
    } catch (err) {
        console.error("error updating user doctor mapping", err);
        res.status(err.statusCode || 400).json({
            success: false,
            message: err.message || "Failed to update user doctor mapping",
        });
    }
};
exports.getUserDoctorMappingById = async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await UserDoctorMappingService.getUserDoctorMappingById(userId);

        res.status(200).json(result);
    } catch (err) {
        console.error("error getting user doctor mapping by id", err);
        res.status(err.statusCode || 400).json({
            success: false,
            message: err.message || "Failed to get user doctor mapping by id",
        });
    }
};

exports.getUserDoctorMappingByUserId = async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await UserDoctorMappingService.getUserDoctorMappingByUserId(userId);

        res.status(200).json(result);
    } catch (err) {
        console.error("error getting user doctor mapping by user id", err);
        res.status(err.statusCode || 400).json({
            success: false,
            message: err.message || "Failed to get user doctor mapping by user id",
        });
    }
};

exports.deleteUserDoctorMappings = async (req, res) => {
    try {
        const { userId } = req.body;
        const result = await UserDoctorMappingService.deleteUserDoctorMappings(userId);

        res.status(200).json(result);
    } catch (err) {
        console.error("error deleting user doctor mappings", err);
        res.status(err.statusCode || 400).json({
            success: false,
            message: err.message || "Failed to delete user doctor mappings",
        });
    }
};
