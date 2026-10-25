const express = require('express');

const router = express.Router();

const { requireAnyPermission, requirePermission } = require('../../utils/permissions');

// Master data (admins): anyone may not add, change or remove it.
const canView = requireAnyPermission('masters.view', 'assignments.view');
const canCreate = requirePermission('masters.create');
const canEdit = requirePermission('masters.edit');
const canDelete = requirePermission('masters.delete');

const PharmacyHandler = require('./PharmacyHandler');

router.post('/create-Pharmacy', canCreate, PharmacyHandler.CreatePharmacy)

router.get('/get-Pharmacies', canView, PharmacyHandler.GetPharmacies);
router.get('/get-Pharmacy-by-id/:pharmacyId', canView, PharmacyHandler.GetPharmacyById);
router.put('/update-Pharmacy/:pharmacyId', canEdit, PharmacyHandler.UpdatePharmacy);
router.delete('/delete-Pharmacy/:pharmacyId', canDelete, PharmacyHandler.DeletePharmacy);



module.exports = router;