const { displayName } = require('../../utils/reportScope');

module.exports = {
    // The user's open STP (draft / submitted / returned) and their current approved one.
    GET_STPS: () => {
        return `
            SELECT s.StpId, s.UserId, s.Status, s.CycleWeeks, s.SubmittedOn, s.ReviewedOn, s.ReviewRemarks, s.CreatedOn, s.ModifiedOn,
                   ${displayName('sb')} AS SubmittedByName, ${displayName('rv')} AS ReviewedByName
            FROM dbo.Stp s
            LEFT JOIN Users sb ON sb.UserId = s.SubmittedBy
            LEFT JOIN Users rv ON rv.UserId = s.ReviewedBy
            WHERE s.UserId = @UserId AND s.Status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED')
            ORDER BY CASE s.Status WHEN 'APPROVED' THEN 1 ELSE 0 END, COALESCE(s.ModifiedOn, s.CreatedOn) DESC
        `;
    },

    // People whose plan the acting user may prepare (direct reports).
    DIRECT_REPORTS: () => {
        return `
            SELECT u.UserId, ${displayName('u')} AS Name
            FROM Users u
            WHERE u.ManagerId = @UserId AND ISNULL(u.IsActive, 1) = 1
            ORDER BY Name
        `;
    },

    GET_STP: () => `SELECT * FROM dbo.Stp WHERE StpId = @StpId`,

    GET_PATCHES: () => {
        return `
            SELECT p.AreaId, a.AreaName, t.TerritoryId, t.TerritoryName, p.PatchType
            FROM dbo.StpPatches p
            INNER JOIN Areas a ON a.AreaId = p.AreaId
            LEFT JOIN Territory t ON t.TerritoryId = a.TerritoryId
            WHERE p.StpId = @StpId
            ORDER BY a.AreaName
        `;
    },

    GET_DAYS: () => `SELECT CycleWeek, Weekday, AreaId FROM dbo.StpDays WHERE StpId = @StpId ORDER BY CycleWeek, Weekday`,

    APPROVED_FOR_USER: () => `SELECT TOP 1 * FROM dbo.Stp WHERE UserId = @UserId AND Status = 'APPROVED' ORDER BY ReviewedOn DESC`,

    INSERT_STP: () => {
        return `
            INSERT INTO dbo.Stp (StpId, UserId, Status, CycleWeeks, CreatedBy, CreatedOn)
            VALUES (@StpId, @UserId, 'DRAFT', @CycleWeeks, @ActorId, @Now)
        `;
    },

    // Edits only while not waiting for head office.
    UPDATE_STP: () => {
        return `
            UPDATE dbo.Stp SET CycleWeeks = @CycleWeeks, Status = 'DRAFT', ModifiedOn = @Now
            WHERE StpId = @StpId AND Status IN ('DRAFT', 'RETURNED');
            IF @@ROWCOUNT = 0 THROW 50409, 'This standard tour plan is with head office and can''t be changed now.', 1;
            DELETE FROM dbo.StpPatches WHERE StpId = @StpId;
            DELETE FROM dbo.StpDays WHERE StpId = @StpId;
        `;
    },

    INSERT_PATCH: () => `INSERT INTO dbo.StpPatches (StpId, AreaId, PatchType) VALUES (@StpId, @AreaId, @PatchType)`,

    INSERT_DAY: () => `INSERT INTO dbo.StpDays (StpId, CycleWeek, Weekday, AreaId) VALUES (@StpId, @CycleWeek, @Weekday, @AreaId)`,

    SUBMIT_STP: () => {
        return `
            UPDATE dbo.Stp SET Status = 'SUBMITTED', SubmittedBy = @ActorId, SubmittedOn = @Now, ModifiedOn = @Now
            WHERE StpId = @StpId AND Status IN ('DRAFT', 'RETURNED');
            IF @@ROWCOUNT = 0 THROW 50409, 'Only a draft or returned plan can be sent to head office.', 1;
        `;
    },

    // The MR (or their manager) takes a plan back from head office to change it.
    WITHDRAW_STP: () => {
        return `
            UPDATE dbo.Stp SET Status = 'DRAFT', ModifiedOn = @Now
            WHERE StpId = @StpId AND Status = 'SUBMITTED';
            IF @@ROWCOUNT = 0 THROW 50409, 'Head office has already decided on this plan.', 1;
        `;
    },

    APPROVE_STP: () => {
        return `
            UPDATE dbo.Stp SET Status = 'RETIRED', ModifiedOn = @Now WHERE UserId = @UserId AND Status = 'APPROVED';
            UPDATE dbo.Stp SET Status = 'APPROVED', ReviewedBy = @ActorId, ReviewedOn = @Now, ReviewRemarks = @Remarks, ModifiedOn = @Now
            WHERE StpId = @StpId AND Status = 'SUBMITTED';
            IF @@ROWCOUNT = 0 THROW 50409, 'This plan was already decided.', 1;
        `;
    },

    RETURN_STP: () => {
        return `
            UPDATE dbo.Stp SET Status = 'RETURNED', ReviewedBy = @ActorId, ReviewedOn = @Now, ReviewRemarks = @Remarks, ModifiedOn = @Now
            WHERE StpId = @StpId AND Status = 'SUBMITTED';
            IF @@ROWCOUNT = 0 THROW 50409, 'This plan was already decided.', 1;
        `;
    },

    // Head office queue.
    SUBMITTED_STPS: () => {
        return `
            SELECT s.StpId, s.UserId, ${displayName('u')} AS UserName, ${displayName('m')} AS ManagerName, s.Status, s.CycleWeeks,
                   s.SubmittedOn, ${displayName('sb')} AS SubmittedByName,
                   (SELECT COUNT(*) FROM dbo.StpPatches p WHERE p.StpId = s.StpId) AS Patches
            FROM dbo.Stp s
            INNER JOIN Users u ON u.UserId = s.UserId
            LEFT JOIN Users m ON m.UserId = u.ManagerId
            LEFT JOIN Users sb ON sb.UserId = s.SubmittedBy
            WHERE s.Status = 'SUBMITTED'
            ORDER BY s.SubmittedOn
        `;
    },
};
