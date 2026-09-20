const Areaservice = require('../Areas/Areaservice')

exports.createArea = async (req,res)=>{
    try{
        const reqData = req.body;
        console.log("area data from frontend",reqData)

        if (!reqData.TerritoryId || !reqData.AreaName) {
            return res.status(400).json({
                message: "Territory and area name are required"
            });
        }

        const result = await Areaservice.createArea(reqData)
        res.status(200).json(result)
    }catch(err){
        console.log("error creating area", err)
        res.status(err.statusCode || 500).json({
            message: err.statusCode === 409
                ? err.message
                : "Failed to create area"
        });
    }
}

exports.getnextAreaSequence = async (req,res)=>{
    try{  
        const {TerritoryId} = req.params;
        const result = await Areaservice.getNextAreaSequence(TerritoryId)
        res.status(200).json(result)
    }catch(err){
        console.log("error in get next area sequence", err)
        res.status(500).json({
            message: "Failed to get next area sequence"
        });

    }
}

exports.getAreasCode = async (req,res)=>{
    try{
        const result = await Areaservice.getAreasCode()
        res.status(200).json(result)
    }catch(err){
        console.log("error in get area code", err)
        res.status(500).json({
            message: "Failed to get area code"
        });
    }
}

exports.checkAreaExists = async (req,res)=>{
    console.log("check area exists called", req.params)
    try{
        const {TerritoryId, AreaName} = req.params;
        const result = await Areaservice.checkAreaExists(TerritoryId, AreaName)
        res.status(200).json(result)    

    }catch(err){
        console.log("error in check area exists", err)
        res.status(500).json({
            message: "Failed to check area exists"
        });
    }
}

exports.previewAreaCode = async (req,res)=>{
    try{
        const {TerritoryId, AreaName} = req.params;
        const result = await Areaservice.previewAreaCode(TerritoryId, AreaName)
        res.status(200).json(result)    

    }catch(err){
        console.log("error in preview area code", err)
        res.status(500).json({
            message: "Failed to preview area code"
        });
    }
}