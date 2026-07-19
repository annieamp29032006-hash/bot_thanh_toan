/**
 * catalogService.js - Đọc danh mục & sản phẩm cho menu mua hàng (nền MongoDB).
 *
 * Cấu trúc: Category (danh mục, có ảnh) -> Product (mặt hàng, có giá + ảnh)
 *           -> ProductStock (từng acc/code cụ thể trong kho).
 *
 * Product.webCategory giữ `key` của Category, đúng như web nhập liệu đang dùng.
 *
 * Ảnh: CHỈ lưu link (thường là link CDN Discord do web nhập liệu đẩy lên).
 * Không ghép domain, không đụng file - có link thì trả link, không thì trả rỗng.
 */
const Category = require('../models/Category');
const Product = require('../models/Product');
const ProductStock = require('../models/ProductStock');

/** Đếm hàng còn bán được cho từng productId, trả về Map(productId -> số lượng) */
async function countAvailableByProduct(productIds) {
    if (!productIds.length) return new Map();
    const rows = await ProductStock.aggregate([
        { $match: { productId: { $in: productIds }, status: 'available' } },
        { $group: { _id: '$productId', n: { $sum: 1 } } }
    ]);
    return new Map(rows.map(r => [String(r._id), r.n]));
}

/**
 * Danh mục còn hàng để hiện ở menu cấp 1.
 * Danh mục rỗng bị ẩn - cho khách bấm vào chỉ để thấy "hết hàng" thì vô nghĩa.
 */
async function getCategories() {
    const cats = await Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean();
    if (!cats.length) return [];

    const products = await Product.find({ isActive: true }).select('_id webCategory').lean();
    const availMap = await countAvailableByProduct(products.map(p => p._id));

    // Cộng tồn kho của mọi sản phẩm trong từng danh mục
    const perCat = new Map();
    for (const p of products) {
        const n = availMap.get(String(p._id)) || 0;
        if (!n) continue;
        perCat.set(p.webCategory, (perCat.get(p.webCategory) || 0) + n);
    }

    return cats
        .map(c => ({ key: c.key, name: c.name, imageUrl: c.imageUrl || '', avail: perCat.get(c.key) || 0 }))
        .filter(c => c.avail > 0);
}

/** Sản phẩm còn hàng trong một danh mục (menu cấp 2) */
async function getProducts(categoryKey) {
    const products = await Product.find({ isActive: true, webCategory: categoryKey })
        .sort({ price: 1, name: 1 }).lean();
    if (!products.length) return [];

    const availMap = await countAvailableByProduct(products.map(p => p._id));

    return products
        .map(p => ({
            id: String(p._id),
            name: p.name,
            type: p.type,
            price: p.price,
            description: p.description || '',
            imageUrl: p.imageUrl || '',
            avail: availMap.get(String(p._id)) || 0
        }))
        .filter(p => p.avail > 0);
}

/** Một sản phẩm cụ thể + tồn kho hiện tại */
async function getProduct(productId) {
    let p;
    try {
        p = await Product.findById(productId).lean();
    } catch {
        return null; // id không phải ObjectId hợp lệ
    }
    if (!p || !p.isActive) return null;
    const avail = await ProductStock.countDocuments({ productId: p._id, status: 'available' });
    return {
        id: String(p._id),
        name: p.name,
        type: p.type,
        price: p.price,
        description: p.description || '',
        imageUrl: p.imageUrl || '',
        webCategory: p.webCategory,
        avail
    };
}

async function countAvailable(productId) {
    return ProductStock.countDocuments({ productId, status: 'available' });
}

/** Tên hiển thị của danh mục (dùng cho tiêu đề màn hình) */
async function getCategory(key) {
    const c = await Category.findOne({ key, isActive: true }).lean();
    return c ? { key: c.key, name: c.name, imageUrl: c.imageUrl || '', description: c.description || '' } : null;
}

module.exports = {
    getCategories,
    getCategory,
    getProducts,
    getProduct,
    countAvailable
};
