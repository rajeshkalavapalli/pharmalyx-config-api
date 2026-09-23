const userService = require('../Users/UserService');

exports.getDesignation = async (req, res) => {
    try {
        const userDesignation = await userService.getDesignation();
        res.status(200).json(userDesignation);
        console.log("userdesignationnnnn", userDesignation);
    } catch (err) {
        console.log("error while getting the user designation", err);
        res.status(500).json({ success: false, message: err.message || 'Error fetching designations' });
    }
};

exports.createUser = async (req, res) => {
    try {
        const userData = req.body;
        const createdUser = await userService.createUser(userData);

        res.status(201).json(createdUser);
    } catch (err) {
        console.log("error creating the user", err);
        res.status(400).json({
            success: false,
            message: err.message || 'Failed to create user',
            error: err.message || 'Failed to create user',
        });
    }
};

exports.getUsers = async (req, res) => {
    try {
        const result = await userService.getUsers();
        console.log("userresults", result);
        res.status(200).json({
            message: 'sucessfully fetched the users',
            result,
        });
    } catch (err) {
        console.log("error to fetch the user", err);
        res.status(500).json({
            success: false,
            message: err.message || 'Error fetching users',
        });
    }
};