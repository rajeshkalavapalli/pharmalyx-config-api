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
