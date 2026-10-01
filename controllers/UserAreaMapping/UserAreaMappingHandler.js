const UserAreaMappingService = require('./UserAreaMappingservice');


exports.createuserareamapping = async(req,res)=>{
    try {
        const { userId, mappings } = req.body;
        const result = await UserAreaMappingService.createUserAreaMappings(
            userId,
            mappings
        );

        res.status(201).json(result);
    } catch (err) {
        console.error("error creating user area mapping", err);
        res.status(err.statusCode || 400).json({
            success: false,
            message: err.message || "Failed to save user area mapping",
        });
    }
}

exports.getUserAreaMappings = async (req, res) => {
    try {
        const result = await UserAreaMappingService.getUserAreaMappings();

        res.status(200).json({
            result,
        });
    } catch (err) {
        console.error("error getting user area mappings", err);
        res.status(500).json({
            success: false,
            message: err.message || "Failed to get user area mappings",
        });
    }
};

exports.updateUserAreaMapping = async (req, res) => {
    try {
        const { userId, mappings } = req.body;
        const result = await UserAreaMappingService.updateUserAreaMapping(
            userId,
            mappings
        );

        res.status(200).json(result);
    } catch (err) {
        console.error("error updating user area mapping", err);
        res.status(err.statusCode || 400).json({
            success: false,
            message: err.message || "Failed to update user area mapping",
        });
    }
};

exports.deleteUserAreaMapping = async (req, res) => {
    try {
        const { userId } = req.params;
        const result = await UserAreaMappingService.deleteUserAreaMapping(userId);

        res.status(200).json(result);
    } catch (err) {
        console.error("error deleting user area mapping", err);
        res.status(err.statusCode || 400).json({
            success: false,
            message: err.message || "Failed to delete user area mapping",
        });
    }
};
exports.getUserAreaMappingById = async (req, res) => {  
    try {
        const { userId } = req.params;
        const result = await UserAreaMappingService.getUserAreaMappingById(userId);

        res.status(200).json(result);
    } catch (err) {
        console.error("error getting user area mapping by id", err);
        res.status(err.statusCode || 400).json({
            success: false,
            message: err.message || "Failed to get user area mapping by id",
        });
    }
};