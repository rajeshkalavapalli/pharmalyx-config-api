const DoctorDA = require('./DoctorDA')

const { generateUUID } = require('../../utils/commonUtils');

const CATEGORIES = ['A', 'B', 'C'];

const fail = (status, message) => {
    const error = new Error(message);
    error.status = status;
    return error;
};

// Empty strings would break the uniqueidentifier joins on Territory/Areas.
const blankToNull = (value) => (value === '' || value === undefined ? null : value);

const toCategory = (value) => {
    const category = blankToNull(value);

    if (category === null) return null;

    const upper = String(category).toUpperCase();

    if (!CATEGORIES.includes(upper)) {
        throw fail(400, 'Category must be A, B or C.');
    }

    return upper;
};

const toVisitsPerMonth = (value) => {
    const visits = blankToNull(value);

    if (visits === null) return null;

    const number = Number(visits);

    if (!Number.isInteger(number) || number < 0 || number > 31) {
        throw fail(400, 'Visits per month must be a whole number between 0 and 31.');
    }

    return number;
};

const toDate = (value, label) => {
    const date = blankToNull(value);

    if (date === null) return null;

    const text = String(date).slice(0, 10);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
        throw fail(400, `${label} must be a valid date.`);
    }

    return text;
};

const engagementFields = (data) => ({
    Category: toCategory(data.Category ?? data.category),
    VisitsPerMonth: toVisitsPerMonth(data.VisitsPerMonth ?? data.visitsPerMonth),
    DateOfBirth: toDate(data.DateOfBirth ?? data.dateOfBirth, 'Date of birth'),
    AnniversaryDate: toDate(data.AnniversaryDate ?? data.anniversaryDate, 'Anniversary'),
});

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
            ...engagementFields(reqData),
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
        // Only known columns reach the UPDATE statement.
        const DoctorUpdate = {
            DoctorName: updatedDoctor.DoctorName,
            Qualification: updatedDoctor.Qualification,
            Speciality: updatedDoctor.Speciality,
            HospitalName: updatedDoctor.HospitalName,
            MobileNumber: blankToNull(updatedDoctor.MobileNumber),
            EmailId: blankToNull(updatedDoctor.EmailId),
            CountryId: blankToNull(updatedDoctor.CountryId),
            StateId: blankToNull(updatedDoctor.StateId),
            TerritoryId: blankToNull(updatedDoctor.TerritoryId),
            AreaId: blankToNull(updatedDoctor.AreaId),
            ...engagementFields(updatedDoctor),
            IsActive: updatedDoctor.IsActive === 'No' ? 'No' : 'Yes',
            ModifiedOn: new Date()
        }
        return await DoctorDA.updateDoctor(doctorId, DoctorUpdate);
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