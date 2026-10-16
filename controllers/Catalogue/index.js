const express = require('express');

const router = express.Router();

const Catalogue = require('./CatalogueHandler');

router.get('/catalogue/products', Catalogue.getProducts);
router.post('/catalogue/products', Catalogue.createProduct);
router.put('/catalogue/products/:productId', Catalogue.updateProduct);

router.get('/catalogue/gifts', Catalogue.getGifts);
router.post('/catalogue/gifts', Catalogue.createGift);
router.put('/catalogue/gifts/:giftId', Catalogue.updateGift);

module.exports = router;
