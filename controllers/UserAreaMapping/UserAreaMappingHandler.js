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