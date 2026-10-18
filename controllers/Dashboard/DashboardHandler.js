const DashboardService = require('./DashboardService');

exports.getDashboard = async (req, res) => {
    try {
        const result = await DashboardService.getDashboard(req.get('x-user-id') || null);

        return res.status(200).json(result);
    } catch (error) {
        console.error('Error loading dashboard:', error);

        return res.status(error.status || 500).json({
            message: error.status ? error.message : 'Failed to load dashboard.',
            error: error.message,
        });
    }
};

const ModulesService = require('./ModulesService');
const { handle, actingUser } = require('../../utils/http');

// One sidebar module's numbers and bar charts (tab bar on the dashboard).
exports.getModule = handle('load the dashboard section', (req) => ModulesService.getModule(actingUser(req), req.params.section, req.query));
