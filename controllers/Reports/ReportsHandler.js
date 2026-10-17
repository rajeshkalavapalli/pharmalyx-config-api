const ReportsService = require('./ReportsService');
const { handle, actingUser } = require('../../utils/http');

exports.getOptions = handle('load report filters', (req) => ReportsService.getOptions(actingUser(req)));

exports.getCallReport = handle('load the call report', (req) => ReportsService.getCallReport(actingUser(req), req.query));

exports.getCoverageReport = handle('load the coverage report', (req) => ReportsService.getCoverageReport(actingUser(req), req.query));

exports.getMissedReport = handle('load the missed visits report', (req) => ReportsService.getMissedReport(actingUser(req), req.query));

exports.getPobReport = handle('load the POB report', (req) => ReportsService.getPobReport(actingUser(req), req.query));

exports.getSalesReport = handle('load the sales report', (req) => ReportsService.getSalesReport(actingUser(req), req.query));

exports.getKpiReport = handle('load the KPI report', (req) => ReportsService.getKpiReport(actingUser(req), req.query));

exports.getMisReport = handle('load the MIS report', (req) => ReportsService.getMisReport(actingUser(req), req.query));

exports.getGraphReport = handle('load the graphical report', (req) => ReportsService.getGraphReport(actingUser(req), req.query));
