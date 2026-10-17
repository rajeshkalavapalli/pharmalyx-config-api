const { customQuery } = require('./dbFunctions');
const { getPermissions } = require('./permissions');
const { fail, isGuid, requireActingUser, sameId, toDateKey } = require('./access');

// Shared by every report: who the acting user may see, and the common filters.
//
// Scope = the acting user plus everyone below them in the reporting hierarchy, at any depth.
// Users with `reports.viewall` (ADMIN by default) see everyone.
// The tree walk guards against cycles in ManagerId (a user listed as their own
// indirect manager) by tracking the path, and stops at MAX_DEPTH levels.

const MAX_DEPTH = 15;
const MAX_RANGE_DAYS = 366;

// Defines a CTE named `Scope(UserId)`. Needs @ActingUserId and @ViewAll.
// Use as: `${SCOPE_CTE}, Other AS (...) SELECT ... FROM Scope s ...`
const SCOPE_CTE = `
    WITH Tree AS (
        SELECT u.UserId, CAST('/' + CAST(u.UserId AS VARCHAR(36)) + '/' AS VARCHAR(MAX)) AS Path, 0 AS Depth
        FROM Users u
        WHERE u.UserId = @ActingUserId
        UNION ALL
        SELECT c.UserId, t.Path + CAST(c.UserId AS VARCHAR(36)) + '/', t.Depth + 1
        FROM Users c
        INNER JOIN Tree t ON c.ManagerId = t.UserId
        WHERE t.Depth < ${MAX_DEPTH}
          AND t.Path NOT LIKE '%/' + CAST(c.UserId AS VARCHAR(36)) + '/%'
    ),
    Scope AS (
        SELECT DISTINCT UserId FROM Tree WHERE @ViewAll = 0
        UNION
        SELECT UserId FROM Users WHERE @ViewAll = 1
    )
`;

const displayName = (alias) =>
    `COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(${alias}.FirstName, ' ', ${alias}.LastName))), ''), ${alias}.UserName)`;

const GET_SCOPE_USERS = `
    ${SCOPE_CTE}
    SELECT
        u.UserId,
        ${displayName('u')} AS Name,
        sld.SystemLovDetailName AS DesignationName,
        ${displayName('m')} AS ManagerName,
        CAST(ISNULL(u.IsActive, 1) AS BIT) AS IsActive,
        CASE WHEN u.UserId = @ActingUserId THEN 1 ELSE 0 END AS IsSelf
    FROM Scope s
    INNER JOIN Users u ON u.UserId = s.UserId
    LEFT JOIN Users m ON m.UserId = u.ManagerId
    LEFT JOIN SystemLovDetails sld ON sld.SystemLovDetailId = u.DesignationId
    ORDER BY IsSelf DESC, Name
`;

const GET_TERRITORIES = `SELECT TerritoryId, TerritoryName FROM Territory ORDER BY TerritoryName`;

const GET_PRODUCTS = `SELECT ProductId, ProductName FROM dbo.Products WHERE IsActive = 1 ORDER BY ProductName`;

const viewAllFor = async (actingUserId) => ((await getPermissions(actingUserId)).has('reports.viewall') ? 1 : 0);

// Everyone the acting user may report on.
const getScopeUsers = async (actingUserId) => {
    requireActingUser(actingUserId);
    const ViewAll = await viewAllFor(actingUserId);
    const users = await customQuery(GET_SCOPE_USERS, { ActingUserId: actingUserId, ViewAll });
    return { users, viewAll: Boolean(ViewAll) };
};

const getFilterOptions = async (actingUserId) => {
    const [{ users, viewAll }, territories, products] = await Promise.all([
        getScopeUsers(actingUserId),
        customQuery(GET_TERRITORIES),
        customQuery(GET_PRODUCTS).catch(() => []),
    ]);

    return { users, territories, products, viewAll };
};

const daysBetween = (from, to) => Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000);

// Parses the shared query filters and returns SQL inputs.
// A requested employee must be inside the acting user's scope.
const resolveFilters = async (actingUserId, query, { product = false } = {}) => {
    requireActingUser(actingUserId);

    const from = toDateKey(query.from, 'From date');
    const to = toDateKey(query.to, 'To date');

    if (from > to) throw fail(400, 'From date must be on or before the To date.');
    if (daysBetween(from, to) >= MAX_RANGE_DAYS) throw fail(400, `Choose a range of at most ${MAX_RANGE_DAYS} days.`);

    const ViewAll = await viewAllFor(actingUserId);
    let userId = null;

    if (query.userId) {
        if (!isGuid(query.userId)) throw fail(400, 'Employee is invalid.');

        if (!ViewAll && !sameId(query.userId, actingUserId)) {
            const { users } = await getScopeUsers(actingUserId);
            if (!users.some((user) => sameId(user.UserId, query.userId))) {
                throw fail(403, 'You can only see reports for yourself and the people under you.');
            }
        }

        userId = query.userId;
    }

    if (query.territoryId && !isGuid(query.territoryId)) throw fail(400, 'Territory is invalid.');
    if (product && query.productId && !isGuid(query.productId)) throw fail(400, 'Product is invalid.');

    return {
        ActingUserId: actingUserId,
        ViewAll,
        FromDate: from,
        ToDate: to,
        UserId: userId,
        TerritoryId: query.territoryId || null,
        ...(product ? { ProductId: query.productId || null } : {}),
    };
};

module.exports = { SCOPE_CTE, displayName, getScopeUsers, getFilterOptions, resolveFilters, MAX_RANGE_DAYS };
