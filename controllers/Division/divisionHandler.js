const {createDivision,getDivisions} = require('./divisionService')
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