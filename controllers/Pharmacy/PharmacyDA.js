const sql = require('./sql');

const { customQuery  } = require('../../utils/dbFunctions');

exports.CreatePharmacy = async (pharmacyData) => {
    console.log('Creating pharmacy with dataaaaaa:', pharmacyData);
    return await customQuery( sql.CREATE_PHARMACY(),pharmacyData);

};

exports.GetPharmacies = async () => {
    return await customQuery(sql.GET_PHARMACIES());
};

exports.GetPharmacyById = async (pharmacyId) => {
    return await customQuery(sql.GET_PHARMACY_BY_ID(), { pharmacyId });
};

exports.UpdatePharmacy = async (pharmacyId, pharmacyPayload) => {
    return await customQuery(sql.UPDATE_PHARMACY(), { pharmacyId, ...pharmacyPayload });
};

exports.DeletePharmacy = async (pharmacyId) => {
    return await customQuery(sql.DELETE_PHARMACY(), { pharmacyId });
};