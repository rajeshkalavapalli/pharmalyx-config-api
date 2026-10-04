const StockistDA = require('./StockistDA');
const {generateUUID} = require('../../utils/commonUtils');

exports.createStockist = (data) => {
    const Data = { 
        StockistId: generateUUID(),
        ...data ,
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

exports.updateStockist = (id, data) => {
    const Data = {
        ...data,
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