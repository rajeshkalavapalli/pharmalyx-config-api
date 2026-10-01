const {createDivision,getDivisions,getDivisionById,updateDivision,deleteDivision} = require('./divisionService')
exports.createDivision = async(req, res)=>{
    try{
        const divData = req.body;
        console.log("divisiondata from frontend",divData)
        const result = await createDivision(divData)
        res.status(200).json(result)
    }catch(err){
        console.log("error creating the division", err)
    }
}


exports.getDivisions = async(req, res)=>{
    try{
        const divisions = await getDivisions()
        console.log("division details ", divisions) 
        res.status(200).json(divisions)
        
    }catch(err){
        console.log("error in get division", err)
    }
}

exports.getDivisionById = async(req, res)=>{
    try{
        const divisionId = req.params.divisionId;
        const division = await getDivisionById(divisionId)
        res.status(200).json(division)
    }catch(err){
        console.log("error in get division by ID", err)
    }
}

exports.updateDivision = async(req, res)=>{
    try{
        const divisionId = req.params.divisionId;
        const updatedDivision = req.body;
        const result = await updateDivision(divisionId, updatedDivision)
        res.status(200).json(result)
    }catch(err){
        console.log("error updating the division", err)
    }
}

exports.deleteDivision = async(req, res)=>{
    try{
        const divisionId = req.params.divisionId;
        const result = await deleteDivision(divisionId)
        res.status(200).json(result)
    }catch(err){
        console.log("error deleting the division", err)
    }
}