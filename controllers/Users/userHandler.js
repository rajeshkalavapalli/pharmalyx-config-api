const userService = require('../Users/UserService');
const { issueToken, issueChoiceTicket, verifyChoiceTicket } = require('../../utils/auth');
const { getSeats } = require('../../utils/seats');

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

// The company's user limit for the Users screen: { max, used, free }, or null without organisations.
exports.getSeats = async (req, res) => {
    try {
        return res.status(200).json({ seats: await getSeats() });
    } catch (err) {
        console.log("error loading user seats", err);
        return res.status(500).json({ message: "Failed to load the user limit." });
    }
};

exports.getUsers = async (req, res) => {
    try {
        const result = await userService.getUsers(req.user?.userId);
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
        const updatedUser = await userService.updateUser(updatedUserData, req.user?.userId);

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
        const result = await userService.deleteUser(userId, req.user?.userId);

        res.status(200).json(result);
    } catch (err) {
        console.log("error deleting the user", err);
        res.status(err.status || 400).json({
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
// A new session. Someone who must choose their own password gets a session that only allows that.
const signedIn = async (user, organisation) => {
    const mustChangePassword = await userService.mustChangePassword(user.UserId, organisation?.OrganisationId);
    const session = issueToken(user.UserId, organisation?.OrganisationId, { mustChangePassword });
    return { user, organisation, mustChangePassword, ...session };
};

// Second step of sign-in when the password matched in several companies.

exports.chooseOrganisation = async (req, res) => {
    const claims = verifyChoiceTicket(req.body?.ticket);
    if (!claims) return res.status(401).json({ message: "This sign-in has expired. Please sign in again." });

    const choice = claims.choices.find((c) => String(c.o.OrganisationId).toLowerCase() === String(req.body?.organisationId || "").toLowerCase());
    if (!choice) return res.status(400).json({ message: "Choose one of the listed companies." });

    try {
        return res.status(200).json(await signedIn(choice.u, choice.o));
    } catch (err) {
        console.log("error signing in", err);
        return res.status(500).json({ message: "Sign-in failed. Please try again." });
    }
};

exports.login = async (req, res) => {
    try {
        const { login, password } = req.body || {};

        if (!login || !password) {
            return res.status(400).json({ message: "Enter your username and password." });
        }

        const result = await userService.login(login, password);

        // The password matched in several companies: the person picks one (POST /login/choose).
        if (result.choices) {
            return res.status(200).json({
                chooseOrganisation: true,
                organisations: result.choices.map((c) => ({ organisationId: c.organisation.OrganisationId, name: c.organisation.Name })),
                ticket: issueChoiceTicket(result.choices.map((c) => ({ u: c.user, o: c.organisation }))),
            });
        }

        return res.status(200).json(await signedIn(result.user, result.organisation));
    } catch (err) {
        if (err.status) {
            return res.status(err.status).json({ message: err.message });
        }

        console.log("error signing in", err);
        return res.status(500).json({ message: "Sign-in failed. Please try again." });
    }
};

// The signed-in person sets their own password (also the first sign-in step when required).
// Returns a fresh session without the "must change password" restriction.
exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body || {};
        await userService.changePassword(req.user.userId, currentPassword, newPassword);
        const session = issueToken(req.user.userId, req.user.organisationId);
        return res.status(200).json({ message: "Your password has been changed.", mustChangePassword: false, ...session });
    } catch (err) {
        if (err.status) return res.status(err.status).json({ message: err.message });
        console.log("error changing the password", err);
        return res.status(500).json({ message: "Couldn't change your password. Please try again." });
    }
};

exports.getPeople = async (req, res) => {
    try {
        res.status(200).json(await userService.getPeople(req.user.userId));
    } catch (err) {
        console.log("error fetching people", err);
        res.status(err.status || 500).json({ message: err.status ? err.message : "Couldn't load people." });
    }
};
