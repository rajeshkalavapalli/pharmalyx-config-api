const countryDA = require('./countryDa');


exports.getCountries = async () => {

    try {

        const countries =
            await countryDA.getCountries();


        return countries;

    } catch (err) {
        console.log("Error getting countries:",err);
        throw err;

    }

};

exports.getStates = async (CountryId )=>{
    try{
        const state = await countryDA.getStates(CountryId)
        console.log("get response to state ",state)
        return state

    }catch(err){
        console.log("error getting states", err)
        throw err;
    }
}