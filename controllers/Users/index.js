const express = require('express');

const router = express.Router();

const userHandler = require('./userHandler');

router.get('/designation', userHandler.getDesignation);
router.post('/create-user', userHandler.createUser);
router.get('/get-users',userHandler.getUsers);
router.put('/update-user', userHandler.updateUser);
router.delete('/delete-user/:userId', userHandler.deleteUser);
router.get('/get-user/:userId', userHandler.getUserById);




module.exports = router;
