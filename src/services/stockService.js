/**
 * stockService.js - Quản lý kho code / account
 * Chống bán trùng bằng atomic MongoDB operations
 */
const mongoose = require('mongoose');
const ProductStock = require('../models/ProductStock');
const logService = require('./logService');

/**
 * Ném ra khi kho không đủ hàng. Phải là lỗi riêng để phân biệt với lỗi tạm thời
 * của MongoDB (WriteConflict) - loại kia được withTransaction thử lại, loại này thì không.
 */
class OutOfStockError extends Error {
    constructor() { super('OUT_OF_STOCK'); this.name = 'OutOfStockError'; }
}

/**
 * Thêm 1 code/account vào kho
 */
async function addOne(productId, content, password = '', imageUrl = '') {
    return ProductStock.create({ productId, content, password, imageUrl });
}

/**
 * Import nhiều code/account (bulk)
 */
async function bulkImport(productId, items) {
    const docs = items.map(item => ({
        productId,
        content: item.content || item.code || item.username || '',
        password: item.password || '',
        imageUrl: item.imageUrl || '',
        status: 'available'
    }));
    const result = await ProductStock.insertMany(docs);
    await logService.system('import', `Import ${result.length} items vào kho sản phẩm ${productId}`, { productId, count: result.length });
    return result;
}

/**
 * Đếm tồn kho available
 */
async function countAvailable(productId) {
    return ProductStock.countDocuments({ productId, status: 'available' });
}

/**
 * Lấy tất cả stock của sản phẩm (cho admin xem)
 */
async function getAll(productId, statusFilter = null) {
    const query = { productId };
    if (statusFilter) query.status = statusFilter;
    return ProductStock.find(query).sort({ createdAt: -1 });
}

/**
 * ═══════════════════════════════════════════════════
 * ATOMIC: Khóa (Lock) N code/account từ kho (CHỐNG BÁN TRÙNG)
 * ═══════════════════════════════════════════════════
 */
async function lockStock(productId, quantity, orderId) {
    const session = await mongoose.startSession();
    let locked = [];
    let shortage = null; // số lượng thực sự khoá được khi kho không đủ

    try {
        // withTransaction TỰ THỬ LẠI khi gặp TransientTransactionError (WriteConflict).
        // Hai khách bấm mua cùng lúc chắc chắn đụng nhau ở đây; không retry thì một
        // người nhận lỗi vô cớ và hàng nằm ế dù vẫn còn.
        await session.withTransaction(async () => {
            locked = []; // reset vì callback có thể chạy lại

            for (let i = 0; i < quantity; i++) {
                const stock = await ProductStock.findOneAndUpdate(
                    { productId, status: 'available' },
                    { $set: { status: 'locked', lockedForOrder: orderId } },
                    { returnDocument: 'after', session }
                );

                if (!stock) {
                    // Kho không đủ -> abort. KHÔNG tự tay mở khoá: abortTransaction đã
                    // hoàn tác mọi thay đổi trong session này. Mở khoá thủ công ở ngoài
                    // session có thể nhả nhầm acc mà đơn khác vừa khoá hợp lệ -> bán trùng.
                    shortage = i;
                    throw new OutOfStockError();
                }
                locked.push(stock);
            }
        });

        return { success: true, locked };
    } catch (err) {
        if (err instanceof OutOfStockError) {
            return {
                success: false,
                locked: [],
                message: `Có người đang giao dịch mặt hàng này hoặc kho không đủ (chỉ còn trống ${shortage}/${quantity} chiếc). Vui lòng thử lại sau ít phút!`
            };
        }
        throw err;
    } finally {
        await session.endSession();
    }
}

/**
 * ATOMIC: Khóa (Lock) 1 stock cụ thể (dành cho Bán đích danh)
 */
async function lockSpecificStock(stockId, orderId) {
    const stock = await ProductStock.findOneAndUpdate(
        { _id: stockId, status: 'available' },
        { 
            $set: { 
                status: 'locked', 
                lockedForOrder: orderId
            } 
        },
        { new: true }
    );
    if (!stock) {
        return { success: false, message: 'Tài khoản này đã bị người khác mua hoặc đang giao dịch.' };
    }
    return { success: true, locked: [stock] };
}

/**
 * Chuyển trạng thái từ khóa (locked) sang đã bán (sold) sau khi thanh toán thành công
 */
async function confirmSold(orderId, userId) {
    const result = await ProductStock.updateMany(
        { lockedForOrder: orderId, status: 'locked' },
        { 
            $set: { 
                status: 'sold', 
                soldTo: userId, 
                orderId: orderId, 
                soldAt: new Date() 
            } 
        }
    );
    
    // Lấy lại danh sách đã bán để trả về
    return ProductStock.find({ orderId: orderId, status: 'sold' });
}

/**
 * Rollback stock (khi hủy đơn)
 */
async function releaseStock(stockIds, orderId = null) {
    const query = orderId ? { lockedForOrder: orderId } : { _id: { $in: stockIds } };
    return ProductStock.updateMany(
        query,
        { $set: { status: 'available', lockedForOrder: null, soldTo: '', orderId: null, soldAt: null } }
    );
}

module.exports = {
    addOne,
    bulkImport,
    countAvailable,
    getAll,
    lockStock,
    lockSpecificStock,
    confirmSold,
    releaseStock
};
