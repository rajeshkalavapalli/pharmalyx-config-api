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
            s.CountryId,
            t.IsActive,
            t.CreatedOn,
            t.ModifiedOn
        FROM Territory t
        LEFT JOIN State s
            ON s.StateId = t.StateId
        ORDER BY t.TerritoryName ASC;

        `
    },
    UPDATE_TERRITORY: () => {
        return `
            UPDATE Territory
            SET
                TerritoryName = @TerritoryName,
                IsActive = @IsActive,
                ModifiedOn = @ModifiedOn,
                StateId = @StateId
            WHERE TerritoryId = @TerritoryId
        `;
    },
    DELETE_TERRITORY: () => {
        return `
            DELETE FROM Territory
            WHERE TerritoryId = @TerritoryId
        `;
    },
    GET_TERRITORY_BY_ID: () => {
        return `
             SELECT
            t.TerritoryId,
            t.TerritoryName,
            t.StateId,
            s.StateName,
            s.CountryId,
            t.IsActive,
            t.CreatedOn,
            t.ModifiedOn
        FROM Territory t
        LEFT JOIN State s
         ON s.StateId = t.StateId
        WHERE t.TerritoryId = @TerritoryId
        `;
    }
}