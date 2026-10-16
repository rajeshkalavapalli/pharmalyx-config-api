const CatalogueService = require('./CatalogueService');
const { handle, actingUser } = require('../../utils/http');

exports.getProducts = handle('load products', (req) =>
    CatalogueService.getProducts(actingUser(req), req.query));

exports.createProduct = handle('save product', (req) =>
    CatalogueService.saveProduct(actingUser(req), null, req.body || {}));

exports.updateProduct = handle('save product', (req) =>
    CatalogueService.saveProduct(actingUser(req), req.params.productId, req.body || {}));

exports.getGifts = handle('load gifts', (req) =>
    CatalogueService.getGifts(actingUser(req), req.query));

exports.createGift = handle('save gift', (req) =>
    CatalogueService.saveGift(actingUser(req), null, req.body || {}));

exports.updateGift = handle('save gift', (req) =>
    CatalogueService.saveGift(actingUser(req), req.params.giftId, req.body || {}));
