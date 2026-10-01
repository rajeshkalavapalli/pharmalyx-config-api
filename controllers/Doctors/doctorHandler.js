const doctorService = require('./doctorService')

exports.createDoctor = async (req, res) => {
    try {
        const reqData = req.body;
        console.log("doctor data from frontend", reqData)

        if (!reqData.doctorName || !reqData.qualification || !reqData.speciality || !reqData.hospitalName) {
            return res.status(400).json({
                message: "Doctor name, qualification, speciality and hospital name are required"
            });
        }

        const result = await doctorService.createDoctor(reqData)

        res.status(201).json(result)
    } catch (err) {
        console.log("error creating doctor", err)
        res.status(500).json({
            message: "Failed to create doctor"
        });
    }
}

exports.getDoctors = async (req, res) => {
    try {
        const result = await doctorService.getDoctors()
        res.status(200).json({
            doctors: result
        })
    } catch (err) {
        console.log("error getting doctors", err)
        res.status(500).json({
            message: "Failed to get doctors"
        });
    }
}

exports.getDoctorById = async (req, res) => {
    try {
        const doctorId = req.params.doctorId;
        const result = await doctorService.getDoctorById(doctorId);
        res.status(200).json(result);
    } catch (err) {
        console.log("error getting doctor by ID", err);
        res.status(500).json({
            message: "Failed to get doctor by ID"
        });
    }
}

exports.updateDoctor = async (req, res) => {
    try {
        const doctorId = req.params.doctorId;
        const updatedDoctor = req.body;
        const result = await doctorService.updateDoctor(doctorId, updatedDoctor);
        res.status(200).json(result);
    } catch (err) {
        console.log("error updating doctor", err);
        res.status(500).json({
            message: "Failed to update doctor"
        });
    }
}

exports.deleteDoctor = async (req, res) => {
    try {
        const doctorId = req.params.doctorId;
        const result = await doctorService.deleteDoctor(doctorId);
        res.status(200).json(result);
    } catch (err) {
        console.log("error deleting doctor", err);
        res.status(500).json({
            message: "Failed to delete doctor"
        });
    }
}    