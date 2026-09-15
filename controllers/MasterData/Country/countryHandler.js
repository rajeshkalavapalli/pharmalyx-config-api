const countryService = require('./countryService')

exports.getCountries = async (req, res) =>{
    try{
        const country = await countryService.getCountries();
        res.status(200).json({
            message:"country fetched",
            country
        })
    }catch(err){
        console.log("error getting the country", err)
    }

}   

exports.getStates = async (req,res)=>{
    try{
        const { CountryId } = req.params;

        const states = await countryService.getStates(CountryId);
        console.log("statessss", states)
        res.status(200).json({
            states:states
        })

    }catch(err){
        console.log("error getting states", err)
    }

}