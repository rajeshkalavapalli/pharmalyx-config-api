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
            t.TerritoryName
            FROM Areas a
            LEFT JOIN Territory t
                ON t.TerritoryId = a.TerritoryId
            
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
}

}