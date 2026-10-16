const sql = require('./sql');
const { customQuery } = require('../../utils/dbFunctions');

exports.getProducts = (activeOnly) => customQuery(sql.GET_PRODUCTS(), { ActiveOnly: activeOnly ? 1 : 0 });

exports.productNameTaken = async (ProductName, ProductId = null) =>
    (await customQuery(sql.FIND_PRODUCT_BY_NAME(), { ProductName, ProductId })).length > 0;

exports.createProduct = (inputs) => customQuery(sql.CREATE_PRODUCT(), inputs);

exports.updateProduct = (inputs) => customQuery(sql.UPDATE_PRODUCT(), inputs);

exports.getGifts = (activeOnly) => customQuery(sql.GET_GIFTS(), { ActiveOnly: activeOnly ? 1 : 0 });

exports.giftNameTaken = async (GiftName, GiftId = null) =>
    (await customQuery(sql.FIND_GIFT_BY_NAME(), { GiftName, GiftId })).length > 0;

exports.createGift = (inputs) => customQuery(sql.CREATE_GIFT(), inputs);

exports.updateGift = (inputs) => customQuery(sql.UPDATE_GIFT(), inputs);
