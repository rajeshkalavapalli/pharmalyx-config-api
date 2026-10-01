const PharmacyDA = require('./PharmacyDA');
const {generateUUID} = require('../../utils/commonUtils');

exports.CreatePharmacy = async (pharmacyPayload) => {
    try {
        const PharmacyId = generateUUID();
        const pharmacyData = {
            ...pharmacyPayload,
            PharmacyId: PharmacyId,
            CreatedOn: new Date(),
            ModifiedOn: null,
        };
        const createdPharmacy = await PharmacyDA.CreatePharmacy(pharmacyData);
        return createdPharmacy;
    } catch (err) {
        console.error("Error creating pharmacy in service:", err);
        throw err;
    }
};

exports.GetPharmacies = async () => {
    try {
        const pharmacies = await PharmacyDA.GetPharmacies();
        return pharmacies;
    } catch (err) {
        console.error("Error getting pharmacies in service:", err);
        throw err;
    }
};

exports.GetPharmacyById = async (pharmacyId) => {
    try {
        const pharmacy = await PharmacyDA.GetPharmacyById(pharmacyId);
        return pharmacy;
    } catch (err) {
        console.error("Error getting pharmacy by ID in service:", err);
        throw err;
    }
};

exports.UpdatePharmacy = async (pharmacyId, pharmacyPayload) => {
    try {
        const updatedPharmacy = await PharmacyDA.UpdatePharmacy(pharmacyId, pharmacyPayload);
        return updatedPharmacy;
    } catch (err) {
        console.error("Error updating pharmacy in service:", err);
        throw err;
    }
};

exports.DeletePharmacy = async (pharmacyId) => {
    try {
        const deletedPharmacy = await PharmacyDA.DeletePharmacy(pharmacyId);
        return deletedPharmacy;
    } catch (err) {
        console.error("Error deleting pharmacy in service:", err);
        throw err;
    }
};