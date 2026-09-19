const { randomUUID } = require('crypto');

 const generateUUID = ()=>{
    return randomUUID();
 };


 module.exports = {
    generateUUID
 }