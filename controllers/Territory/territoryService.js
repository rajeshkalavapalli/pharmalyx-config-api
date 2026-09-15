const { response } = require('express')
const { generateUUID } = require('../../utils/commonUtils')
const TerritoryDA = require('./TerritoryDA')


exports.createTerriTory = async(NewTerritory)=>{
    const territoryId = generateUUID()
    try{
    
         console.log("datafrom handler ", NewTerritory)
         const finaldata = {
            ...NewTerritory,
            territoryId:territoryId,
            createdOn:new Date(),
            modifiedOn:new Date(),
         }

        const territory = await TerritoryDA.CreateTerritory(finaldata)
        console.log('territory details in service', territory)
        return territory;
    }catch(err){
        console.log("error creating territory", err)
    }
}

exports.getTerritorie = async (StateId) => {

    try {

        const territories =
            await TerritoryDA.getTerritorie(StateId);

        return territories;

    } catch (err) {

        console.log(
            "error getting territories",
            err
        );

        throw err;

    }

};

exports.getTerritories = async()=>{
    try{
        const territores = await TerritoryDA.getTerritories();
        
        return territores;

    }catch(err){
        console.log("error getting territores", err)
    }
}