const userDa = require('../Users/userDA')

exports.getDesignation = async()=>{
    try{
        return await userDa.getDesignation();
    }catch(err){
        console.log("error fetching the designation", err)
    }
}