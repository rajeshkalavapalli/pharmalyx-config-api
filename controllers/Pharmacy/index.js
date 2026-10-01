const express = require('express');

const router = express.Router();

const PharmacyHandler = require('./PharmacyHandler');

router.post('/create-Pharmacy', PharmacyHandler.CreatePharmacy)

router.get('/get-Pharmacies', PharmacyHandler.GetPharmacies);
router.get('/get-Pharmacy-by-id/:pharmacyId', PharmacyHandler.GetPharmacyById);
router.put('/update-Pharmacy/:pharmacyId', PharmacyHandler.UpdatePharmacy);
router.delete('/delete-Pharmacy/:pharmacyId', PharmacyHandler.DeletePharmacy);



module.exports = router;