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
 * TẤT CẢ danh mục CẤP 1 đang bật (màn đầu tiên) - kể cả đang hết hàng.
 * Khách cần thấy gian hàng có những mục gì; mục hết hàng bấm vào sẽ báo hết hàng.
 *
 * Sản phẩm có thể nằm ở cấp 2, HOẶC nằm thẳng ở cấp 1 khi danh mục đó chưa chia
 * nhỏ - nên tồn kho cộng cả hai nguồn.
 */
async function getRootCategories() {
    const [roots, children] = await Promise.all([
        Category.find({ isActive: true, parentKey: null }).sort({ sortOrder: 1, name: 1 }).lean(),
        Category.find({ isActive: true, parentKey: { $ne: null } }).lean()
    ]);
    if (!roots.length) return [];

    const perKey = await availByChildKey();

    // Tồn kho của cấp 1 = hàng gắn thẳng vào nó + hàng của các cấp 2 bên trong
    const perRoot = new Map();
    for (const r of roots) perRoot.set(r.key, perKey.get(r.key) || 0);
    for (const c of children) {
        const n = perKey.get(c.key) || 0;
        if (!n) continue;
        perRoot.set(c.parentKey, (perRoot.get(c.parentKey) || 0) + n);
    }

    return roots.map(r => ({
        key: r.key, name: r.name, imageUrl: r.imageUrl || '', avail: perRoot.get(r.key) || 0
    }));
}

/** Danh mục cấp 1 này có danh mục con nào đang bật không */
async function hasChildren(parentKey) {
    return (await Category.countDocuments({ isActive: true, parentKey })) > 0;
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

/**
 * Danh sách mặt hàng bày ra trong một danh mục (màn thứ ba).
 *
 * Cách bày do CHÍNH DANH MỤC quyết định (Category.sellMode), không phải loại sản phẩm:
 *   - 'quantity': gộp mỗi mặt hàng thành MỘT dòng, khách nhập số lượng.
 *   - 'specific': TÁCH từng cái trong kho thành dòng riêng kèm ảnh của nó. Gộp lại
 *     thành "còn 3" là sai bản chất - khách không biết mình đang mua cái nào.
 */
async function getProducts(childKey) {
    const cat = await Category.findOne({ key: childKey }).lean();
    const specific = cat?.sellMode === 'specific';

    const products = await Product.find({ isActive: true, webCategory: childKey })
        .sort({ price: 1, name: 1 }).lean();
    if (!products.length) return [];

    const availMap = await countAvailableByProduct(products.map(p => p._id));
    const out = [];

    for (const p of products) {
        const avail = availMap.get(String(p._id)) || 0;
        if (!avail) continue;

        if (!specific) {
            out.push({
                kind: 'product',
                id: String(p._id),
                name: p.name,
                type: p.type,
                price: p.price,
                description: p.description || '',
                imageUrl: p.imageUrl || '',
                avail
            });
            continue;
        }

        // Bán đích danh: mỗi cái trong kho thành một dòng riêng
        const stocks = await ProductStock.find({ productId: p._id, status: 'available' })
            .sort({ createdAt: 1 }).lean();

        stocks.forEach((s, i) => {
            out.push({
                kind: 'stock',
                id: String(s._id),
                productId: String(p._id),
                name: stocks.length > 1 ? `${p.name} #${i + 1}` : p.name,
                type: p.type,
                price: p.price,
                description: p.description || '',
                imageUrl: s.imageUrl || p.imageUrl || '',
                avail: 1
            });
        });
    }

    return out;
}

/** Một tài khoản cụ thể trong kho (màn chi tiết của hàng đích danh) */
async function getStockItem(stockId) {
    let s;
    try {
        s = await ProductStock.findOne({ _id: stockId }).lean();
    } catch {
        return null; // id không hợp lệ
    }
    if (!s) return null;

    const p = await Product.findById(s.productId).lean();
    if (!p || !p.isActive) return null;

    return {
        stockId: String(s._id),
        productId: String(p._id),
        name: p.name,
        type: p.type,
        price: p.price,
        description: p.description || '',
        imageUrl: s.imageUrl || p.imageUrl || '',
        webCategory: p.webCategory,
        available: s.status === 'available'
    };
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

    // Hàng bán đích danh (account) mang ảnh riêng trên từng cái trong kho. Sản phẩm
    // chưa đặt ảnh thì lấy ảnh của cái sắp giao để khách vẫn thấy đúng món mình mua.
    let imageUrl = p.imageUrl || '';
    if (!imageUrl && avail > 0) {
        const first = await ProductStock.findOne({ productId: p._id, status: 'available' })
            .select('imageUrl').lean();
        imageUrl = first?.imageUrl || '';
    }

    return {
        id: String(p._id),
        name: p.name,
        type: p.type,
        price: p.price,
        description: p.description || '',
        imageUrl,
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
        sellMode: c.sellMode || 'quantity',
        imageUrl: c.imageUrl || '', description: c.description || ''
    };
}

async function countAvailable(productId) {
    return ProductStock.countDocuments({ productId, status: 'available' });
}

module.exports = {
    getRootCategories,
    getChildCategories,
    hasChildren,
    getCategory,
    getProducts,
    getProduct,
    getStockItem,
    countAvailable
};
