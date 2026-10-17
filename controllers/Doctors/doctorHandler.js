const doctorService = require('./doctorService')
const { actingUser } = require('../../utils/http')

exports.createDoctor = async (req, res) => {
    try {
        const reqData = req.body;
        if (!reqData.doctorName || !reqData.qualification || !reqData.speciality || !reqData.hospitalName) {
            return res.status(400).json({
                message: "Doctor name, qualification, speciality and hospital name are required"
            });
        }

        const result = await doctorService.createDoctor(reqData, actingUser(req))

        res.status(201).json(result)
    } catch (err) {
        console.log("error creating doctor", err)
        res.status(err.status || 500).json({
            message: err.status ? err.message : "Failed to create doctor"
        });
    }
}

exports.getDoctors = async (req, res) => {
    try {
        const result = await doctorService.getDoctors(req.user?.userId)
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
        const result = await doctorService.getDoctorById(doctorId, req.user?.userId);
        res.status(200).json(result);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ message: err.message });
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
        const result = await doctorService.updateDoctor(doctorId, updatedDoctor, actingUser(req));
        res.status(200).json(result);
    } catch (err) {
        console.log("error updating doctor", err);
        res.status(err.status || 500).json({
            message: err.status ? err.message : "Failed to update doctor"
        });
    }
}

exports.deleteDoctor = async (req, res) => {
    try {
        const doctorId = req.params.doctorId;
        const result = await doctorService.deleteDoctor(doctorId, actingUser(req));
        res.status(200).json(result);
    } catch (err) {
        console.log("error deleting doctor", err);
        res.status(500).json({
            message: "Failed to delete doctor"
        });
    }
}    