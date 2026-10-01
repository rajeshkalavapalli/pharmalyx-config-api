module.exports = {
    CREATE_AREA:(newArea)=>{
        return`
            INSERT INTO Areas(
                AreaId,
                TerritoryId,
                AreaName,
                AreaCode,
                IsActive,
                CreatedOn,
                ModifiedOn
            ) VALUES (
                @AreaId,
                @TerritoryId,
                @AreaName,      
                @AreaCode,
                @IsActive,
                @CreatedOn,
                @ModifiedOn
            )
        `
    },

    GET_AREA_CODE:()=>{
        return`
            SELECT 
            a.AreaId,
            a.TerritoryId,
            a.AreaName,
            a.AreaCode,
            a.IsActive,
            a.CreatedOn,
            a.ModifiedOn,
            t.TerritoryName,
            t.StateId,
            s.CountryId
            FROM Areas a
            LEFT JOIN Territory t
                ON t.TerritoryId = a.TerritoryId
            LEFT JOIN State s
                ON s.StateId = t.StateId
            
        `
    },

    GET_NEXT_AREA_SEQUENCE: () => {
    return `
        SELECT
            ISNULL(MAX(
                TRY_CAST(
                    RIGHT(AreaCode, 3)
                    AS INT
                )
            ), 0) + 1 AS NextSequence
        FROM Areas
        WHERE TerritoryId = @TerritoryId
    `;
},
CHECK_AREA_EXISTS: () => {
    return `
        SELECT
            AreaId,
            TerritoryId,
            AreaName,
            AreaCode,
            IsActive
        FROM Areas
        WHERE TerritoryId = @TerritoryId
                    AND LOWER(LTRIM(RTRIM(AreaName))) = LOWER(LTRIM(RTRIM(@AreaName)))
    `;
},

    GET_AREAS_BY_TERRITORY: () => {
        return `
             SELECT 
            a.AreaId,
            a.TerritoryId,
            a.AreaName,
            a.AreaCode,
            a.IsActive,
            a.CreatedOn,
            a.ModifiedOn,
            t.TerritoryName
        FROM Areas a
        LEFT JOIN Territory t
            ON t.TerritoryId = a.TerritoryId
        WHERE a.TerritoryId = @TerritoryId
        `;
    },
    UPDATE_AREA: () => {
        return `
            UPDATE Areas
            SET
                TerritoryId = @TerritoryId,
                AreaName = @AreaName,
                AreaCode = @AreaCode,
                IsActive = @IsActive,
                ModifiedOn = @ModifiedOn
            WHERE AreaId = @AreaId
        `;
    },

    DELETE_AREA: () => {
        return `
            DELETE FROM Areas
            WHERE AreaId = @AreaId
        `;
    },

    GET_AREAS_BY_ID: () => {
        return `
            SELECT 
                a.AreaId,
                a.TerritoryId,
                a.AreaName,
                a.AreaCode,
                a.IsActive,
                a.CreatedOn,
                a.ModifiedOn,
                t.TerritoryName
            FROM Areas a
            LEFT JOIN Territory t
                ON t.TerritoryId = a.TerritoryId
            WHERE a.AreaId = @AreaId
        `;
    },
}