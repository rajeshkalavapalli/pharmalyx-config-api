
const {createDivision,getDivisions,getDivisionById,updateDivision,deleteDivision} = require('./divisionDA')
const { generateUUID } = require("../../utils/commonUtils")



exports.createDivision = async(divData)=>{
    try{
        console.log("from handler ", divData)
        const DivisionId = generateUUID();
    

        const finaldata = {
            ...divData,
            DivisionId:DivisionId,
        
        }

        console.log("finaldata for division creation", finaldata)

        const finalDivision = await createDivision(finaldata)

    }catch(err){
        console.log("error creating division", err)
    }    
}

exports.getDivisions = async()=>{
    try{
        const result = await getDivisions()
        return result
    }catch(err){
        console.log("error getting divisions", err)
    }
}

exports.getDivisionById = async(divisionId)=>{
    try{
        const result = await getDivisionById(divisionId)
        return result
    }catch(err){
        console.log("error getting division by ID", err)
    }
}

exports.updateDivision = async(divisionId, updatedDivision)=>{
    try{
        const result = await updateDivision(divisionId, updatedDivision)
        return result
    }catch(err){
        console.log("error updating division", err)
    }
}

exports.deleteDivision = async(divisionId)=>{
    try{
        const result = await deleteDivision(divisionId)
        return result
    }catch(err){
        console.log("error deleting division", err)
    }
}