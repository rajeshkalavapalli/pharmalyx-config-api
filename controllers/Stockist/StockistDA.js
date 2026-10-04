const { customQuery } = require('../../utils/dbFunctions');
const sql = require('./sql');

exports.createStockist = (Data) => {
    return customQuery(sql.Create_Stockist(),Data);
};

exports.getStockist = () => {
    return customQuery(sql.GET_STOCKIST());
};

exports.getStockistById = (Data) => {
    return customQuery(sql.GET_STOCKIST_BY_ID(), Data);
};

exports.updateStockist = (id, Data) => {
    return customQuery(sql.UPDATE_STOCKIST(), Data);
};

exports.deleteStockist = (Data) => {
    return customQuery(sql.DELETE_STOCKIST(), Data);
};