const DoctorBusinessService = require('./DoctorBusinessService');
const { handle, actingUser } = require('../../utils/http');

exports.getMonth = handle('load doctor business', (req) =>
    DoctorBusinessService.getMonth(actingUser(req), req.query));

exports.saveEntry = handle('save doctor business', (req) =>
    DoctorBusinessService.saveEntry(actingUser(req), req.body || {}));
