const userService = require('../Users/UserService');
const { issueToken } = require('../../utils/auth');

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

exports.updateUser = async (req, res) => {
    try {
        const updatedUserData = req.body;
        console.log("updatedUserData from frontend===>", updatedUserData);
        const updatedUser = await userService.updateUser(updatedUserData);

        res.status(200).json(updatedUser);
    } catch (err) {
        console.log("error updating the user", err);
        res.status(400).json({
            success: false,
            message: err.message || 'Failed to update user',
            error: err.message || 'Failed to update user',
        });
    }
};  

exports.deleteUser = async (req, res) => {
    try {
        const { userId } = req.params;
        const deletedUser = await userService.deleteUser(userId);

        res.status(200).json(deletedUser);
    } catch (err) {
        console.log("error deleting the user", err);
        res.status(400).json({
            success: false,
            message: err.message || 'Failed to delete user',
            error: err.message || 'Failed to delete user',
        });
    }
};

exports.getUserById = async (req, res) => {
    try {
        const { userId } = req.params;
        const user = await userService.getUserById(userId);

        res.status(200).json(user);
    } catch (err) {
        console.log("error fetching the user by ID", err);
        res.status(400).json({
            success: false,
            message: err.message || 'Failed to fetch user by ID',
            error: err.message || 'Failed to fetch user by ID',
        });
    }
};
exports.login = async (req, res) => {
    try {
        const { login, password } = req.body || {};

        if (!login || !password) {
            return res.status(400).json({ message: "Enter your username and password." });
        }

        const user = await userService.login(login, password);
        const session = issueToken(user.UserId);

        // `user` is unchanged for existing callers; the token is new.
        return res.status(200).json({ user, ...session });
    } catch (err) {
        if (err.status) {
            return res.status(err.status).json({ message: err.message });
        }

        console.log("error signing in", err);
        return res.status(500).json({ message: "Sign-in failed. Please try again." });
    }
};
