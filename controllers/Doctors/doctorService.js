const DoctorDA = require('./DoctorDA')

const { generateUUID } = require('../../utils/commonUtils');

exports.createDoctor = async (reqData) => {
    try {
        const doctorId = generateUUID();
        const now = new Date();

        const newDoctor = {
            DoctorId: doctorId,
            DoctorName: reqData.doctorName,
            Qualification: reqData.qualification,
            Speciality: reqData.speciality,
            HospitalName: reqData.hospitalName,
            MobileNumber: reqData.mobileNumber || null,
            EmailId: reqData.emailId || null,
            CountryId: reqData.country || null,
            StateId: reqData.state || null,
            TerritoryId: reqData.territory || null,
            AreaId: reqData.area || null,
            IsActive: "Yes",
            CreatedOn: now,
            ModifiedOn: now,
        };

        await DoctorDA.createDoctor(newDoctor);

        return {
            success: true,
            message: "Doctor created successfully",
            DoctorId: doctorId,
        };
    } catch (err) {
        console.log("error creating doctor", err)
        throw err;
    }
}

exports.getDoctors = async () => {
    try {
        return await DoctorDA.getDoctors();
    } catch (err) {
        console.log("error getting doctors", err)
        throw err;
    }
}


exports.getDoctorById = async (doctorId) => {
    try {
        return await DoctorDA.getDoctorById(doctorId);
    } catch (err) {
        console.log("error getting doctor by ID", err)
        throw err;
    }
}

exports.updateDoctor = async (doctorId, updatedDoctor) => {
    try {
        return await DoctorDA.updateDoctor(doctorId, updatedDoctor);
    } catch (err) {
        console.log("error updating doctor", err)
        throw err;
    }
}

exports.deleteDoctor = async (doctorId) => {
    try {
        return await DoctorDA.deactivateDoctor(doctorId);
    } catch (err) {
        console.log("error deleting doctor", err)
        throw err;
    }
}       