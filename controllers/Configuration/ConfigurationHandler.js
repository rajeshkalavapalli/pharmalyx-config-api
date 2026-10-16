const ConfigurationService = require('./ConfigurationService');

exports.getSummary = async (req, res) => {
    try {
        const summary = await ConfigurationService.getSummary();

        return res.status(200).json({ summary });
    } catch (error) {
        console.error('Error loading configuration summary:', error);

        return res.status(500).json({
            message: 'Failed to load configuration summary.',
            error: error.message,
        });
    }
};
