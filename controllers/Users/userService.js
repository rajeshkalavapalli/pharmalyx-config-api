const userDa = require('../Users/userDA')
const {generateUUID} = require('../../utils/commonUtils')
const argon2 = require("argon2");

exports.getDesignation = async()=>{
    try{
        return await userDa.getDesignation();
    }catch(err){
        console.log("error fetching the designation", err)
    }
}

exports.createUser = async (userData)=>{
    try{
        console.log("userdataaa", userData)
        const userId = generateUUID();
        const PasswordHash = await argon2.hash(userData.password);
        const {password,...userDetails} = userData

       const newUser = {
            ...userDetails,
            UserId:userId,
            PasswordHash:PasswordHash,
       }
       const result = await userDa.createUser(newUser)
        
       return  {
        message: "User created successfully",
        UserId: userId,
        UserName: newUser.UserName,
        DesignationId: newUser.DesignationId
       }

    }catch(err){
        console.log("error while creating the user", err)
    }
    

}

exports.getUsers= async ()=>{
    try{
    
        const result = await userDa.getUsers();
        return result;
        
    }catch(err){
        
        console.log("error getting users", err)
    }
}