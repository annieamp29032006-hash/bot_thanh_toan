/**
 * productService.js - CRUD sản phẩm
 */
const Product = require('../models/Product');
const ProductStock = require('../models/ProductStock');
const logService = require('./logService');

/**
 * Tạo sản phẩm mới
 */
async function create(data) {
    const product = await Product.create(data);
    await logService.system('add', `Thêm sản phẩm: ${product.name} (${product.type}) - ${product.price.toLocaleString()} VNĐ`, { productId: product._id });
    return product;
}

/**
 * Sửa sản phẩm
 */
async function update(productId, data) {
    const product = await Product.findByIdAndUpdate(productId, data, { new: true });
    if (!product) throw new Error('Không tìm thấy sản phẩm.');
    await logService.system('edit', `Sửa sản phẩm: ${product.name}`, { productId: product._id, changes: data });
    return product;
}

/**
 * Xóa sản phẩm (và toàn bộ stock)
 */
async function remove(productId) {
    const product = await Product.findByIdAndDelete(productId);
    if (!product) throw new Error('Không tìm thấy sản phẩm.');
    await ProductStock.deleteMany({ productId: product._id });
    await logService.system('delete', `Xóa sản phẩm: ${product.name}`, { productId: product._id });
    return product;
}

/**
 * Lấy sản phẩm theo ID
 */
async function getById(productId) {
    return Product.findById(productId);
}

/**
 * Lấy sản phẩm theo ID hoặc Code (SKU)
 */
async function findByIdOrCode(idOrCode) {
    if (idOrCode.length === 24) {
        const product = await Product.findById(idOrCode);
        if (product) return product;
    }
    return Product.findOne({ code: idOrCode });
}

/**
 * Lấy tất cả sản phẩm đang active
 */
async function getAll(filter = {}) {
    return Product.find({ isActive: true, ...filter }).sort({ createdAt: -1 });
}

/**
 * Lấy sản phẩm kèm tồn kho
 */
async function getWithStock(productId) {
    const product = await Product.findById(productId);
    if (!product) return null;
    const stockCount = await ProductStock.countDocuments({ productId, status: 'available' });
    return { ...product.toObject(), stockCount };
}

/**
 * Lấy danh sách tồn kho đang rảnh (dùng cho Pagination)
 */
async function getAvailableStock(productId, page = 1, limit = 3) {
    const skip = (page - 1) * limit;
    const items = await ProductStock.find({ productId, status: 'available' })
                                    .sort({ createdAt: 1 }) // Có thể sort theo createdAt để hiển thị cái nào nạp trước lên trước
                                    .skip(skip)
                                    .limit(limit);
    const totalStock = await ProductStock.countDocuments({ productId, status: 'available' });
    return { items, totalStock, totalPages: Math.ceil(totalStock / limit) };
}

/**
 * Lấy tất cả sản phẩm kèm tồn kho
 */
async function getAllWithStock(filter = {}) {
    const products = await Product.find({ isActive: true, ...filter }).sort({ createdAt: -1 });
    const results = [];
    for (const p of products) {
        const stockCount = await ProductStock.countDocuments({ productId: p._id, status: 'available' });
        results.push({ ...p.toObject(), stockCount });
    }
    return results;
}

module.exports = {
    create,
    update,
    remove,
    getById,
    findByIdOrCode,
    getAll,
    getWithStock,
    getAllWithStock,
    getAvailableStock
};
