
const {createDivision,getDivisions} = require('./divisionDA')
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