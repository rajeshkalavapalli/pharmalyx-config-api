module.exports = {
    CREATE_AREA:()=>{
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
            AreaId,
            TerritoryId,
            AreaName,
            AreaCode,
            IsActive,
            CreatedOn,
            ModifiedOn
            FROM Areas 
            
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
          AND AreaName = @AreaName
    `;
}

}