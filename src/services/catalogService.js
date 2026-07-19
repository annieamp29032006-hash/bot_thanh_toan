/**
 * catalogService.js - Đọc danh mục & sản phẩm cho menu mua hàng (nền MongoDB).
 *
 * Cây dữ liệu:
 *   Category cấp 1  ->  Category cấp 2  ->  Product  ->  ProductStock
 *
 * Product.webCategory trỏ vào key của danh mục CẤP 2.
 * Tồn kho cộng dồn ngược lên: cấp 2 = tổng sản phẩm của nó, cấp 1 = tổng các cấp 2.
 *
 * Ảnh: CHỈ lưu link (thường là link CDN Discord). Có thì trả, không thì trả rỗng.
 */
const Category = require('../models/Category');
const Product = require('../models/Product');
const ProductStock = require('../models/ProductStock');

/** Map(productId -> số hàng còn bán được) */
async function countAvailableByProduct(productIds) {
    if (!productIds.length) return new Map();
    const rows = await ProductStock.aggregate([
        { $match: { productId: { $in: productIds }, status: 'available' } },
        { $group: { _id: '$productId', n: { $sum: 1 } } }
    ]);
    return new Map(rows.map(r => [String(r._id), r.n]));
}

/** Map(categoryKey cấp 2 -> tổng hàng còn) */
async function availByChildKey() {
    const products = await Product.find({ isActive: true }).select('_id webCategory').lean();
    const availMap = await countAvailableByProduct(products.map(p => p._id));
    const perKey = new Map();
    for (const p of products) {
        const n = availMap.get(String(p._id)) || 0;
        if (!n) continue;
        perKey.set(p.webCategory, (perKey.get(p.webCategory) || 0) + n);
    }
    return perKey;
}

/**
 * Danh mục CẤP 1 còn hàng (màn đầu tiên).
 * Danh mục rỗng bị ẩn - cho khách bấm vào chỉ để thấy "hết hàng" thì vô nghĩa.
 */
async function getRootCategories() {
    const [roots, children] = await Promise.all([
        Category.find({ isActive: true, parentKey: null }).sort({ sortOrder: 1, name: 1 }).lean(),
        Category.find({ isActive: true, parentKey: { $ne: null } }).lean()
    ]);
    if (!roots.length) return [];

    const perChild = await availByChildKey();

    // Cộng tồn kho của các danh mục con lên danh mục cha
    const perRoot = new Map();
    for (const c of children) {
        const n = perChild.get(c.key) || 0;
        if (!n) continue;
        perRoot.set(c.parentKey, (perRoot.get(c.parentKey) || 0) + n);
    }

    return roots
        .map(r => ({ key: r.key, name: r.name, imageUrl: r.imageUrl || '', avail: perRoot.get(r.key) || 0 }))
        .filter(r => r.avail > 0);
}

/** Danh mục CẤP 2 còn hàng trong một danh mục cha (màn thứ hai) */
async function getChildCategories(parentKey) {
    const children = await Category.find({ isActive: true, parentKey })
        .sort({ sortOrder: 1, name: 1 }).lean();
    if (!children.length) return [];

    const perChild = await availByChildKey();

    return children
        .map(c => ({
            key: c.key, name: c.name, parentKey: c.parentKey,
            imageUrl: c.imageUrl || '', avail: perChild.get(c.key) || 0
        }))
        .filter(c => c.avail > 0);
}

/** Sản phẩm còn hàng trong một danh mục cấp 2 (màn thứ ba) */
async function getProducts(childKey) {
    const products = await Product.find({ isActive: true, webCategory: childKey })
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

/** Một sản phẩm cụ thể + tồn kho hiện tại (màn chi tiết) */
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

/** Lấy một danh mục bất kỳ theo key (dùng cho tiêu đề và nút quay lại) */
async function getCategory(key) {
    const c = await Category.findOne({ key }).lean();
    if (!c) return null;
    return {
        key: c.key, name: c.name, parentKey: c.parentKey,
        imageUrl: c.imageUrl || '', description: c.description || ''
    };
}

async function countAvailable(productId) {
    return ProductStock.countDocuments({ productId, status: 'available' });
}

module.exports = {
    getRootCategories,
    getChildCategories,
    getCategory,
    getProducts,
    getProduct,
    countAvailable
};
