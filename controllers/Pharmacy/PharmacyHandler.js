
 const PharmacyService = require('./PharmacyService');

 exports.CreatePharmacy = async (req, res)=>{
    try{
        const pharmacyPayload = req.body;
        
        const createdPharmacy = await PharmacyService.CreatePharmacy(pharmacyPayload);
        res.status(201).json(createdPharmacy);

    }catch(err){
        console.error("Error creating pharmacy:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
 }

 exports.GetPharmacies = async (req, res)=>{
    try{
        const pharmacies = await PharmacyService.GetPharmacies();
        res.status(200).json(pharmacies);

    }catch(err){
        console.error("Error getting pharmacies:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
 }

 exports.GetPharmacyById = async (req, res)=>{
    try{
        const pharmacyId = req.params.pharmacyId;
        const pharmacy = await PharmacyService.GetPharmacyById(pharmacyId);
        res.status(200).json(pharmacy);

    }catch(err){
        console.error("Error getting pharmacy by ID:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
 }

 exports.UpdatePharmacy = async (req, res)=>{
    try{
        const pharmacyId = req.params.pharmacyId;
        const pharmacyPayload = req.body;
        const updatedPharmacy = await PharmacyService.UpdatePharmacy(pharmacyId, pharmacyPayload);
        res.status(200).json(updatedPharmacy);

    }catch(err){
        console.error("Error updating pharmacy:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
 }

 exports.DeletePharmacy = async (req, res)=>{
    try{
        const pharmacyId = req.params.pharmacyId;
        const deletedPharmacy = await PharmacyService.DeletePharmacy(pharmacyId);
        res.status(200).json(deletedPharmacy);

    }catch(err){
        console.error("Error deleting pharmacy:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
 }