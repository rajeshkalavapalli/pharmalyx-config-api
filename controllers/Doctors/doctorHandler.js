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
