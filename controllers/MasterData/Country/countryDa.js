
const { customQuery } = require('../../../utils/dbFunctions')
const sql = require('./sql')

exports.getCountries = async()=>{
    const Allcountries = await customQuery(sql.GET_COUNTRIES())
    return Allcountries
};


exports.getStates = async(CountryId)=>{
    const states = await customQuery(sql.GET_STATES(),{
        CountryId:CountryId
    })
    return states

}
