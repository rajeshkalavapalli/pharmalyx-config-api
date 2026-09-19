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
            div.IsActive ,
            div.CreatedOn, 
            div.ModifiedOn

            FROM dbo.Division AS div
        `
    }


}