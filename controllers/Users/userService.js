const userDa = require('../Users/userDA');
const { generateUUID } = require('../../utils/commonUtils');
const argon2 = require("argon2");

exports.getDesignation = async () => {
    try {
        return await userDa.getDesignation();
    } catch (err) {
        console.log("error fetching the designation", err);
        throw err;
    }
};

exports.createUser = async (userData) => {
    try {
        console.log("userdataaa", userData);

        if (!userData || !userData.UserName) {
            throw new Error("UserName is required");
        }

        if (!userData.DivisionId) {
            throw new Error("Division is required");
        }

        if (!Array.isArray(userData.StateIds) || userData.StateIds.length === 0) {
            throw new Error("At least one state is required");
        }

        if (!Array.isArray(userData.TerritoryIds) || userData.TerritoryIds.length === 0) {
            throw new Error("At least one territory is required");
        }

        const userId = generateUUID();
        const PasswordHash = await argon2.hash(userData.password);
        const { password, StateIds, TerritoryIds, ...userDetails } = userData;

        const newUser = {
            ...userDetails,
            UserId: userId,
            PasswordHash: PasswordHash,
        };

        return await userDa.createUser(newUser, StateIds, TerritoryIds);
    } catch (err) {
        console.log("error while creating the user", err);
        throw err;
    }
};

exports.getUsers = async () => {
    try {
        const result = await userDa.getUsers();
        return result;
    } catch (err) {
        console.log("error getting users", err);
        throw err;
    }
};