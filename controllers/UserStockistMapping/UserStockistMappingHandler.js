const UserStockistMappingService = require('./UserStockistMappingService');


exports.createuserstockistmapping = async (req, res) => {
    try {
        const { userId, mappings } = req.body;
        const result = await UserStockistMappingService.createUserStockistMappings(
            userId,
            mappings
        );

        res.status(201).json(result);
    } catch (err) {
        console.error("error creating user stockist mapping", err);
        res.status(err.statusCode || 400).json({
            success: false,
            message: err.message || "Failed to save user stockist mapping",
        });
    }
}

exports.getUserStockistMappings = async (req, res) => {
    try {
        const result = await UserStockistMappingService.getUserStockistMappings();

        res.status(200).json({
            result,
        });
    } catch (err) {
        console.error("error getting user stockist mappings", err);
        res.status(500).json({
            success: false,
            message: err.message || "Failed to get user stockist mappings",
        });
    }
};

exports.updateUserStockistMapping = async (req, res) => {
    try {
        const { userId, stockistId } = req.body;
        const result = await UserStockistMappingService.updateUserStockistMapping({
            UserId: userId,
            StockistId: stockistId
        });

        res.status(200).json(result);
    } catch (err) {
        console.error("error updating user stockist mapping", err);
        res.status(err.statusCode || 400).json({
            success: false,
            message: err.message || "Failed to update user stockist mapping",
        });
    }
};
exports.getUserStockistMappingById = async (req, res) => {
    try {
        const { userStockistMappingId } = req.params;
        const result = await UserStockistMappingService.getUserStockistMappingById(userStockistMappingId);

        res.status(200).json(result);
    } catch (err) {
        console.error("error getting user stockist mapping by id", err);
        res.status(err.statusCode || 400).json({
            success: false,
            message: err.message || "Failed to get user stockist mapping by id",
        });
    }
};

exports.getUserStockistMappingByUserId = async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await UserStockistMappingService.getUserStockistMappingByUserId(userId);

        res.status(200).json(result);
    } catch (err) {
        console.error("error getting user stockist mapping by user id", err);
        res.status(err.statusCode || 400).json({
            success: false,
            message: err.message || "Failed to get user stockist mapping by user id",
        });
    }
};

exports.deleteUserStockistMappings = async (req, res) => {
    try {
        const { userId } = req.body;
        const result = await UserStockistMappingService.deleteUserStockistMappings(userId);

        res.status(200).json(result);
    } catch (err) {
        console.error("error deleting user stockist mappings", err);
        res.status(err.statusCode || 400).json({
            success: false,
            message: err.message || "Failed to delete user stockist mappings",
        });
    }
};
