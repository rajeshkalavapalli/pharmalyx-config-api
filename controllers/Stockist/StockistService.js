const StockistDA = require('./StockistDA');
const {generateUUID} = require('../../utils/commonUtils');
const { checkOutlet } = require('../../utils/placeOfTerritory');

exports.createStockist = async (data) => {
    const Data = {
        StockistId: generateUUID(),
        ...(await checkOutlet(data || {}, 'StockistName', 'Name')),
        CreatedOn: new Date(),
        ModifiedOn: new Date(),
    };
    return StockistDA.createStockist(Data);
};

exports.getStockist = () => {
    return StockistDA.getStockist();
};

exports.getStockistById = (id) => {
    const Data = {
        StockistId: id,
    };
    return StockistDA.getStockistById(Data);
};

exports.updateStockist = async (id, data) => {
    const Data = {
        ...(await checkOutlet(data || {}, 'StockistName', 'Name')),
        StockistId: id,
        ModifiedOn: new Date(),
    };
    return StockistDA.updateStockist(id, Data);
};

exports.deleteStockist = (id) => {
    const Data = {
        StockistId: id,
    };
    return StockistDA.deleteStockist(Data);
};