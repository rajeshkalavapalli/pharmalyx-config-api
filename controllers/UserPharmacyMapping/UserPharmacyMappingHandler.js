const UserPharmacyMappingService = require('./UserPharmacyMappingService');


exports.createuserpharmacymapping = async (req, res) => {
    try {
        const { userId, mappings } = req.body;
        const result = await UserPharmacyMappingService.createUserPharmacyMappings(
            userId,
            mappings
        );

        res.status(201).json(result);
    } catch (err) {
        console.error("error creating user pharmacy mapping", err);
        res.status(err.statusCode || 400).json({
            success: false,
            message: err.message || "Failed to save user pharmacy mapping",
        });
    }
}

exports.getUserPharmacyMappings = async (req, res) => {
    try {
        const result = await UserPharmacyMappingService.getUserPharmacyMappings();

        res.status(200).json({
            result,
        });
    } catch (err) {
        console.error("error getting user pharmacy mappings", err);
        res.status(500).json({
            success: false,
            message: err.message || "Failed to get user pharmacy mappings",
        });
    }
};

exports.updateUserPharmacyMapping = async (req, res) => {
    try {
        const { userId, pharmacyId } = req.body;
        const result = await UserPharmacyMappingService.updateUserPharmacyMapping({
            UserId: userId,
            PharmacyId: pharmacyId
        });

        res.status(200).json(result);
    } catch (err) {
        console.error("error updating user pharmacy mapping", err);
        res.status(err.statusCode || 400).json({
            success: false,
            message: err.message || "Failed to update user pharmacy mapping",
        });
    }
};
exports.getUserPharmacyMappingById = async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await UserPharmacyMappingService.getUserPharmacyMappingById(userId);

        res.status(200).json(result);
    } catch (err) {
        console.error("error getting user pharmacy mapping by id", err);
        res.status(err.statusCode || 400).json({
            success: false,
            message: err.message || "Failed to get user pharmacy mapping by id",
        });
    }
};

exports.getUserPharmacyMappingByUserId = async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await UserPharmacyMappingService.getUserPharmacyMappingByUserId(userId);

        res.status(200).json(result);
    } catch (err) {
        console.error("error getting user pharmacy mapping by user id", err);
        res.status(err.statusCode || 400).json({
            success: false,
            message: err.message || "Failed to get user pharmacy mapping by user id",
        });
    }
};

exports.deleteUserPharmacyMappings = async (req, res) => {
    try {
        const { userId } = req.body;
        const result = await UserPharmacyMappingService.deleteUserPharmacyMappings(userId);

        res.status(200).json(result);
    } catch (err) {
        console.error("error deleting user pharmacy mappings", err);
        res.status(err.statusCode || 400).json({
            success: false,
            message: err.message || "Failed to delete user pharmacy mappings",
        });
    }
};
