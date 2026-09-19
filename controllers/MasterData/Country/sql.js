
module.exports = {
    GET_COUNTRIES : ()=>{
        return (
            `
            SELECT 
                CountryId,
                CountryName,
                CountryCode,
                PhoneCode,
                IsActive
            FROM  country
            WHERE IsActive = 1
            ORDER BY CountryName ASC

            `
        )
    },

    GET_STATES:()=>{
        return(
            `
                SELECT 
                    StateId,
                    StateName,
                    StateCode,
                    CountryId,
                    IsActive

                    FROM State
                    WHERE CountryId = @CountryId
                    AND IsActive = 1
                    ORDER BY StateName ASC
            `
        )
    }
}