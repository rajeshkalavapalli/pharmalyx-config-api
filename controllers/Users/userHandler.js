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

exports.createUser = async(req,res)=>{
    try{
        const userData = req.body;
        
        const  createUser  = await userService.createUser(userData);
        
        res.status(201).json({
             createUser
        });

    }catch(err){
        console.log("error creating the user",err)
    }
}


exports.getUsers = async(req, res)=>{
    try{
        const result = await userService.getUsers();
            console.log("userresults", result)
            res.status(200).json({
                message:'sucessfully fetched the users',
                result,
            })
        
    }catch(err){
        console.log("error to fetch the user", err)
    }
}   