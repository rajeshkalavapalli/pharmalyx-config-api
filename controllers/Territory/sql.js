module.exports = {
    CREATE_TERRITOTY:()=>{
        return`
            INSERT INTO Territory(
                TerritoryId,
                TerritoryName,
                IsActive,
                CreatedOn,
                ModifiedOn,
                StateId
            )
            Values(
                @TerritoryId,
                @TerritoryName,
                @IsActive,
                @CreatedOn,
                @ModifiedOn,
                @StateId
            
            )
        
        `
    },

     GET_TERRITORIES_BY_STATE: () => {
        return `
            SELECT
                TerritoryId,
                TerritoryName,
                StateId,
                IsActive
            FROM Territory
            WHERE StateId = @StateId
            AND IsActive = 1
            ORDER BY TerritoryName ASC
        `;
    },
    GET_TERRITORIES:()=>{
        return `
        
        SELECT
    t.TerritoryId,
    t.TerritoryName,
    t.StateId,
    s.StateName,
    t.IsActive,
    t.CreatedOn,
    t.ModifiedOn
FROM Territory t
LEFT JOIN State s
    ON s.StateId = t.StateId
ORDER BY t.TerritoryName ASC;

        `
    }
}