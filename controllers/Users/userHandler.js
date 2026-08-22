const userService = require('../Users/userService')

exports.getDesignation= async (req,res)=>{
    try{
        const userDesignation = await userService.getDesignation();
        res.status(200).json(userDesignation)
        console.log("userdesignationnnnn",userDesignation)
    }catch(err){
        console.log("error while getting the user designation", err)
    }
}