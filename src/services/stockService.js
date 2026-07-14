/**
 * stockService.js - Quản lý kho code / account
 * Chống bán trùng bằng atomic MongoDB operations
 */
const mongoose = require('mongoose');
const ProductStock = require('../models/ProductStock');
const logService = require('./logService');

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
    const locked = [];

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        for (let i = 0; i < quantity; i++) {
            const stock = await ProductStock.findOneAndUpdate(
                { productId, status: 'available' },
                { 
                    $set: { 
                        status: 'locked', 
                        lockedForOrder: orderId
                    } 
                },
                { new: true, session }
            );

            if (!stock) {
                // Không đủ hàng available
                await session.abortTransaction();
                session.endSession();

                // Rollback các stock đã lock
                if (locked.length > 0) {
                    await ProductStock.updateMany(
                        { _id: { $in: locked.map(s => s._id) } },
                        { $set: { status: 'available', lockedForOrder: null } }
                    );
                }

                return { success: false, locked: [], message: `Có người đang giao dịch mặt hàng này hoặc kho không đủ (chỉ còn trống ${locked.length}/${quantity} chiếc). Vui lòng chờ 5 phút!` };
            }

            locked.push(stock);
        }

        await session.commitTransaction();
        session.endSession();
        return { success: true, locked };
    } catch (err) {
        await session.abortTransaction();
        session.endSession();

        // Rollback
        if (locked.length > 0) {
            await ProductStock.updateMany(
                { _id: { $in: locked.map(s => s._id) } },
                { $set: { status: 'available', lockedForOrder: null } }
            );
        }

        throw err;
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
