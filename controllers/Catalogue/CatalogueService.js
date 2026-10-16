const CatalogueDA = require('./CatalogueDA');

const { generateUUID } = require('../../utils/commonUtils');
const { fail, isGuid, optionalText, requireActingUser } = require('../../utils/access');

const requiredName = (value, label) => {
    const name = String(value ?? '').trim();

    if (!name) throw fail(400, `${label} is required.`);
    if (name.length > 150) throw fail(400, `${label} cannot exceed 150 characters.`);

    return name;
};

const optionalMoney = (value, label) => {
    if (value === '' || value == null) return null;

    const amount = Number(value);

    if (!Number.isFinite(amount) || amount < 0 || amount > 99999999) {
        throw fail(400, `${label} must be a positive amount.`);
    }

    return Math.round(amount * 100) / 100;
};

const flag = (value, fallback) => (value == null ? fallback : value === true || value === 1 || value === 'true');

// =========================================================
// PRODUCTS
// =========================================================

exports.getProducts = async (actingUserId, query) => {
    requireActingUser(actingUserId);
    return { products: await CatalogueDA.getProducts(query.active === '1') };
};

exports.saveProduct = async (actingUserId, productId, payload) => {
    requireActingUser(actingUserId);

    if (productId && !isGuid(productId)) throw fail(400, 'Product is invalid.');

    const product = {
        ProductId: productId || generateUUID(),
        ProductName: requiredName(payload.ProductName, 'Product name'),
        Composition: optionalText(payload.Composition, 300, 'Composition'),
        PackSize: optionalText(payload.PackSize, 50, 'Pack size'),
        Therapy: optionalText(payload.Therapy, 100, 'Therapy area'),
        UnitPrice: optionalMoney(payload.UnitPrice, 'Unit price'),
        IsSample: flag(payload.IsSample, true),
        IsActive: flag(payload.IsActive, true),
        Now: new Date(),
    };

    if (await CatalogueDA.productNameTaken(product.ProductName, productId || null)) {
        throw fail(409, 'A product with this name already exists.');
    }

    await (productId ? CatalogueDA.updateProduct(product) : CatalogueDA.createProduct(product));

    return { message: productId ? 'Product updated.' : 'Product added.', ProductId: product.ProductId };
};

// =========================================================
// GIFTS
// =========================================================

exports.getGifts = async (actingUserId, query) => {
    requireActingUser(actingUserId);
    return { gifts: await CatalogueDA.getGifts(query.active === '1') };
};

exports.saveGift = async (actingUserId, giftId, payload) => {
    requireActingUser(actingUserId);

    if (giftId && !isGuid(giftId)) throw fail(400, 'Gift is invalid.');

    const gift = {
        GiftId: giftId || generateUUID(),
        GiftName: requiredName(payload.GiftName, 'Gift name'),
        Description: optionalText(payload.Description, 300, 'Description'),
        UnitValue: optionalMoney(payload.UnitValue, 'Unit value'),
        IsActive: flag(payload.IsActive, true),
        Now: new Date(),
    };

    if (await CatalogueDA.giftNameTaken(gift.GiftName, giftId || null)) {
        throw fail(409, 'A gift with this name already exists.');
    }

    await (giftId ? CatalogueDA.updateGift(gift) : CatalogueDA.createGift(gift));

    return { message: giftId ? 'Gift updated.' : 'Gift added.', GiftId: gift.GiftId };
};
