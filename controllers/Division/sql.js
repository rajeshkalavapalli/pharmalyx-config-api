module.exports = {

    CREATE_DIVISION: () => {
        return `
            INSERT INTO division (
            DivisionId,
            DivisionName,
            IsActive,
            CreatedOn,
            ModifiedOn,
            Description
            )
            Values(
            @DivisionId,
            @DivisionName,
            @IsActive,
            GETDATE(),
            GETDATE(),
            @Description
            
            )
        `
    },

    GET_DIVISIONS: ()=>{
        return `
            SELECT 
            div.DivisionName,
            div.DivisionId,
            div.Description,
            div.IsActive ,
            div.CreatedOn, 
            div.ModifiedOn

            FROM dbo.Division AS div
        `
    },
    
    GET_DIVISION_BY_ID: ()=>{
        return `
            SELECT 
            div.DivisionName,
            div.DivisionId,
            div.IsActive ,
            div.CreatedOn, 
            div.ModifiedOn

            FROM dbo.Division AS div
            WHERE div.DivisionId = @DivisionId
        `
    },

    UPDATE_DIVISION: ()=>{
        return `
            UPDATE dbo.Division
            SET 
            DivisionName = @DivisionName,
            IsActive = @IsActive,
            ModifiedOn = GETDATE(),
            Description = @Description
            WHERE DivisionId = @DivisionId
        `
    },

    DELETE_DIVISION: ()=>{
        return `
            DELETE FROM dbo.Division
            WHERE DivisionId = @DivisionId
        `
    }


}