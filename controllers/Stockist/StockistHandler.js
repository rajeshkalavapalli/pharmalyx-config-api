const StockistService = require('./StockistService');

exports.createStockist =async (req, res) => {
    try{
        const  reqBody = req.body;
        const result = await StockistService.createStockist(reqBody);
        res.json(result);
    } catch(err) {
        res.status(500).json(err);  
    }
};

exports.getStockist = async (req, res) => {
    try {
        const result = await StockistService.getStockist();
        res.json(result);
    } catch(err) {
        res.status(500).json(err);
    }
};

exports.getStockistById = async (req, res) => {
    try {
        const result = await StockistService.getStockistById(req.params.stockistId);
        res.json(result);
    } catch(err) {
        res.status(500).json(err);
    }
};

exports.updateStockist = async (req, res) => {
    try {
        const result = await StockistService.updateStockist(req.params.stockistId, req.body);
        res.json(result);
    } catch(err) {
        res.status(500).json(err);
    }
};

exports.deleteStockist = async (req, res) => {
    try {
        const result = await StockistService.deleteStockist(req.params.stockistId);
        res.json(result);
    } catch(err) {
        res.status(500).json(err);
    }
};