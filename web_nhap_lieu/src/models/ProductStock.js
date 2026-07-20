/**
 * ProductStock.js - Kho code / kho account cho từng sản phẩm
 */
const mongoose = require('mongoose');

const productStockSchema = new mongoose.Schema({
    productId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Product', 
        required: true, 
        index: true 
    },
    // Nạp kho theo dạng: username|password|email|mô tả riêng|chính sách bảo hành;
    content: { type: String, required: true },    // Code: "ABC-123" | Account: username
    password: { type: String, default: '' },       // Chỉ dùng cho account
    email: { type: String, default: '' },          // Email gắn kèm, giao cho khách
    note: { type: String, default: '' },           // Mô tả riêng - chỉ hiện lúc khách duyệt hàng
    warranty: { type: String, default: '' },       // Chính sách bảo hành, giao cho khách
    imageUrl: { type: String, default: '' },       // Ảnh riêng (account)
    status: {
        type: String,
        enum: ['available', 'locked', 'sold'],
        default: 'available',
        index: true
    },
    lockedForOrder: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null }, // Đơn hàng đang giữ QR
    soldTo: { type: String, default: '' },         // Discord User ID
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    soldAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
});

// Compound index cho atomic query chống bán trùng
productStockSchema.index({ productId: 1, status: 1 });

module.exports = mongoose.model('ProductStock', productStockSchema);
