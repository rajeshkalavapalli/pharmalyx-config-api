const StockistService = require('./StockistService');

exports.createStockist =async (req, res) => {
    try{
        const  reqBody = req.body;
        const result = await StockistService.createStockist(reqBody);
        res.json(result);
    } catch(err) {
        if (!err.status) console.error("Error trying to create the stockist:", err);
        res.status(err.status || 500).json({ message: err.status ? err.message : "Failed to create the stockist.", error: err.message });
    }
};

exports.getStockist = async (req, res) => {
    try {
        const result = await StockistService.getStockist();
        res.json(result);
    } catch(err) {
        if (!err.status) console.error("Error trying to load stockists:", err);
        res.status(err.status || 500).json({ message: err.status ? err.message : "Failed to load stockists.", error: err.message });
    }
};

exports.getStockistById = async (req, res) => {
    try {
        const result = await StockistService.getStockistById(req.params.stockistId);
        res.json(result);
    } catch(err) {
        if (!err.status) console.error("Error trying to load the stockist:", err);
        res.status(err.status || 500).json({ message: err.status ? err.message : "Failed to load the stockist.", error: err.message });
    }
};

exports.updateStockist = async (req, res) => {
    try {
        const result = await StockistService.updateStockist(req.params.stockistId, req.body);
        res.json(result);
    } catch(err) {
        if (!err.status) console.error("Error trying to update the stockist:", err);
        res.status(err.status || 500).json({ message: err.status ? err.message : "Failed to update the stockist.", error: err.message });
    }
};

exports.deleteStockist = async (req, res) => {
    try {
        const result = await StockistService.deleteStockist(req.params.stockistId);
        res.json(result);
    } catch(err) {
        if (!err.status) console.error("Error trying to delete the stockist:", err);
        res.status(err.status || 500).json({ message: err.status ? err.message : "Failed to delete the stockist.", error: err.message });
    }
};