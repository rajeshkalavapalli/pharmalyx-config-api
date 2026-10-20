const userDa = require('../Users/userDA');
const { generateUUID } = require('../../utils/commonUtils');
const argon2 = require("argon2");
const { passwordProblem } = require('../../utils/passwords');
const { getPermissions } = require('../../utils/permissions');
const { getScopeUsers } = require('../../utils/reportScope');

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

// The full user list (with phone and email). Admins see everyone; anyone else only their own team.
exports.getUsers = async (actingUserId = null) => {
    try {
        const result = await userDa.getUsers();
        const permissions = actingUserId ? await getPermissions(actingUserId) : new Set();
        if (permissions.has('masters.view') || permissions.has('users.edit')) return result;

        const { users } = await getScopeUsers(actingUserId);
        const team = new Set(users.map((u) => String(u.UserId).toLowerCase()));
        return result.filter((row) => team.has(String(row.userId).toLowerCase()));
    } catch (err) {
        console.log("error getting users", err);
        throw err;
    }
};

exports.updateUser = async (updatedUser, actingUserId = null) => {
    try {
        if (!updatedUser || !updatedUser.UserId) {
            throw new Error("UserId is required");
        }

        if (!updatedUser.UserName) {
            throw new Error("UserName is required");
        }

        // Nobody can report to themselves or to someone in their own team.
        if (updatedUser.ManagerId && (await userDa.wouldLoop(updatedUser.UserId, updatedUser.ManagerId))) {
            const error = new Error("Choose a manager who is not this person or someone in their own team.");
            error.status = 400;
            throw error;
        }

        if (!Array.isArray(updatedUser.StateIds) || updatedUser.StateIds.length === 0) {
            throw new Error("At least one state is required");
        }

        if (!Array.isArray(updatedUser.TerritoryIds) || updatedUser.TerritoryIds.length === 0) {
            throw new Error("At least one territory is required");
        }

        const {
            CountryId,
            StateIds,
            TerritoryIds,
            password,
            ...userDetails
        } = updatedUser;

        // A blank password means "keep the current one".
        const newPassword = typeof password === "string" ? password : "";
        let passwordHash = null;

        if (newPassword.length > 0) {
            if (newPassword.length < 8) {
                const error = new Error("Password must be at least 8 characters");
                error.status = 400;
                throw error;
            }

            passwordHash = await argon2.hash(newPassword);
        }

        // A password set for someone else is temporary: they choose their own at next sign-in.
        const setForSomeoneElse = String(actingUserId || "").toLowerCase() !== String(userDetails.UserId || "").toLowerCase();
        return await userDa.updateUser(userDetails, StateIds, TerritoryIds, CountryId, passwordHash, Boolean(passwordHash) && setForSomeoneElse);
    } catch (err) {
        console.log("error updating the user", err);
        throw err;
    }
};

// Plain words for the tables that most often hold someone's history.
const HISTORY_LABELS = {
    Visits: "visits",
    VisitCheckIns: "clinic check-ins",
    DailyCallReports: "DCRs",
    TourPlan: "tour plans",
    TourPlanDeviation: "plan deviations",
    Orders: "orders",
    ExpenseClaims: "expense claims",
    LeaveRequests: "leave requests",
    AttendanceLogs: "attendance days",
    LocationPings: "location records",
    WorkDays: "work days",
    SecondaryStatements: "stock statements",
    RcpaEntries: "RCPA entries",
    DoctorRequests: "doctor requests",
    PreCallPlans: "call plans",
    AuditLog: "recorded actions",
};

const describeHistory = (history) => {
    const parts = Object.entries(history)
        .sort((a, b) => b[1] - a[1])
        .map(([table, n]) => `${n} ${HISTORY_LABELS[table] || table}`);
    return parts.length > 4 ? `${parts.slice(0, 4).join(", ")} and more` : parts.join(", ");
};

const notFound = () => {
    const error = new Error("User not found.");
    error.status = 404;
    return error;
};

// Deleting someone who has done any work would leave that work pointing at nobody, so such a
// user is deactivated instead: they can't sign in, don't count towards the user limit, and
// their history stays. Only a user with no history at all is really deleted.
exports.deleteUser = async (userId, actingUserId) => {
    if (actingUserId && String(actingUserId).toLowerCase() === String(userId).toLowerCase()) {
        const error = new Error("You can't delete your own account.");
        error.status = 400;
        throw error;
    }

    const user = await userDa.getUserById(userId);
    if (!user) throw notFound();
    const name = [user.FirstName, user.LastName].filter(Boolean).join(" ") || user.UserName || "This user";

    const history = await userDa.getUserHistory(userId);
    if (Object.keys(history).length) {
        await userDa.deactivateUser(userId);
        return {
            success: true,
            deactivated: true,
            UserId: userId,
            message: `${name} has work history (${describeHistory(history)}), so they were deactivated instead of deleted. They can't sign in any more and their history is kept.`,
        };
    }

    await userDa.deleteUser(userId);
    return { success: true, deleted: true, UserId: userId, message: `${name} was deleted.` };
};

exports.getUserById = async (userId) => {
    try {
        return await userDa.getUserById(userId);
    } catch (err) {
        console.log("error fetching the user by ID", err);
        throw err;
    }
};
const orgContext = require("../../utils/orgContext");
const { customQuery } = require("../../utils/dbFunctions");

const passwordMatches = async (hash, password) => {
    if (!hash || !password) return false;
    try {
        return await argon2.verify(hash, String(password));
    } catch {
        return false;
    }
};

const publicUser = (user) => ({ UserId: user.UserId, UserName: user.UserName, Name: user.Name, DesignationName: user.DesignationName });

// Sign-in with organisations: the username may exist in several companies. The password
// is checked against each; one match signs in, several ask the person to pick a company.
// Returns { user, organisation } or { choices: [{ user, organisation }] }.
const loginAcrossOrganisations = async (login, password) => {
    const wrong = () => {
        const error = new Error("Incorrect username or password.");
        error.status = 401;
        return error;
    };

    const candidates = await orgContext.runAcrossOrganisations(() => userDa.getLoginUsersAllOrgs(String(login || "").trim()));
    const matched = [];
    for (const candidate of candidates) {
        if (await passwordMatches(candidate.PasswordHash, password)) matched.push(candidate);
    }
    if (!matched.length) throw wrong();

    const active = matched.filter((m) => m.OrganisationStatus === "ACTIVE");
    if (!active.length) {
        const error = new Error("Your company's Pharmalyx account is paused. Please contact your administrator.");
        error.status = 403;
        throw error;
    }

    const toChoice = (m) => ({
        user: publicUser(m),
        organisation: { OrganisationId: String(m.OrganisationId).toLowerCase(), Name: m.OrganisationName },
    });
    return active.length === 1 ? toChoice(active[0]) : { choices: active.map(toChoice) };
};

exports.isOrganisationMode = () => orgContext.isEnabled(customQuery);

// Verifies credentials. The same message is returned for an unknown user and a
// wrong password so usernames can't be probed.
exports.login = async (login, password) => {
    if (await exports.isOrganisationMode()) return loginAcrossOrganisations(login, password);

    const fail = () => {
        const error = new Error("Incorrect username or password.");
        error.status = 401;
        return error;
    };

    const user = await userDa.getLoginUser(String(login || "").trim());

    if (!user || !user.PasswordHash || !password) throw fail();

    let valid = false;

    try {
        valid = await argon2.verify(user.PasswordHash, String(password));
    } catch {
        valid = false;
    }

    if (!valid) throw fail();

    return { user: publicUser(user), organisation: null };
};

// Whether this user must choose their own password first (read inside their company).
exports.mustChangePassword = (userId, organisationId = null) =>
    organisationId ? orgContext.runInOrganisation(organisationId, () => userDa.mustChangePassword(userId)) : userDa.mustChangePassword(userId);

// The signed-in person replaces their password: the current one must match, the new one must
// follow the rules and differ from it. Clears the must-change flag.
exports.changePassword = async (userId, currentPassword, newPassword) => {
    const fail = (message, status = 400) => Object.assign(new Error(message), { status });

    const hash = await userDa.getPasswordHash(userId);
    if (!(await passwordMatches(hash, currentPassword))) throw fail("Your current password is not correct.");

    const problem = passwordProblem(newPassword);
    if (problem) throw fail(problem);
    if (await passwordMatches(hash, newPassword)) throw fail("Choose a password different from your current one.");

    await userDa.changeOwnPassword(userId, await argon2.hash(String(newPassword)));
};

// People for everyday screens, without phone or email:
//   me: the signed-in person; team: me + everyone below (all for head office);
//   colleagues: who I may do joint work with (manager chain, my team, territory peers).
exports.getPeople = async (actingUserId) => {
    const [{ users, viewAll }, colleagues] = await Promise.all([getScopeUsers(actingUserId), userDa.getColleagues(actingUserId)]);
    const me = users.find((u) => u.IsSelf) || null;
    const shape = (u) => ({ id: u.UserId, name: u.Name, designation: u.DesignationName || null });
    return {
        me: me ? shape(me) : null,
        team: users.filter((u) => u.IsActive !== false).map(shape),
        colleagues: colleagues.map(shape),
        viewAll,
    };
};
