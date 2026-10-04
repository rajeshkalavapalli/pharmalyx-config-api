
module.exports = {
    Create_Stockist:()=>{
        return`
            insert into Stockist (
                StockistId,
                StockistName,
                OwnerName,
                ContactNumber,
                EmailId,
                DrugLicenceNumber,
                GSTIN,
                CountryId,
                StateId,
                TerritoryId ,
                AreaId,
                Address,
                IsActive,
                CreatedOn,
                ModifiedOn
            )
            values (
                @StockistId,
                @StockistName,
                @OwnerName,
                @ContactNumber,
                @EmailId,
                @DrugLicenceNumber,
                @GSTIN,
                @CountryId,
                @StateId,
                @TerritoryId,
                @AreaId,
                @Address,
                @IsActive,
                @CreatedOn,
                @ModifiedOn
            )
        `
    },
    GET_STOCKIST:()=>{
        return`
            select s.*, t.TerritoryName
            from Stockist s
            left join Territory t on t.TerritoryId = s.TerritoryId
        `
    },
    GET_STOCKIST_BY_ID:()=>{
        return`
            select *
            from Stockist
            where StockistId = @StockistId
        `
    },
    UPDATE_STOCKIST:()=>{
        return`
            update Stockist
            set 
                StockistName = @StockistName,
                OwnerName = @OwnerName,
                ContactNumber = @ContactNumber,
                EmailId = @EmailId,
                DrugLicenceNumber = @DrugLicenceNumber,
                GSTIN = @GSTIN,
                CountryId = @CountryId,
                StateId = @StateId,
                TerritoryId = @TerritoryId,
                AreaId = @AreaId,
                Address = @Address,
                IsActive = @IsActive,
                ModifiedOn = @ModifiedOn
            where StockistId = @StockistId
        `
    },
    DELETE_STOCKIST:()=>{
        return`
            delete from Stockist
            where StockistId = @StockistId
        `
    }

}