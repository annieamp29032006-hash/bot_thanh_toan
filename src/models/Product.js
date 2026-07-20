/**
 * Product.js - Schema cho sản phẩm (Code Thường, VIP, Account)
 */
const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    name: { type: String, required: true },
    code: { type: String, unique: true, sparse: true }, // Mã sản phẩm ngắn gọn (VD: VALO-01)
    type: { 
        type: String, 
        enum: ['code', 'vip', 'account'], 
        required: true 
    },
    webCategory: { type: String, default: 'gcoin' }, // 'acc_pc', 'gcoin', 'steam', 'outfit'
    description: { type: String, default: '' },
    // Chính sách bảo hành chung của cả mặt hàng. Stock nào có bảo hành riêng thì
    // dùng của nó, không có mới rơi về cái này.
    warranty: { type: String, default: '' },
    // Mặt hàng đặc biệt: TOÀN BỘ stock của nó đi theo luồng xét duyệt - khách vẫn
    // quét QR trả tiền, nhưng phải chờ admin duyệt mới nhận được hàng.
    isSpecial: { type: Boolean, default: false },
    price: { type: Number, required: true, min: 0 },
    imageUrl: { type: String, default: '' },
    displayChannelId: { type: String, default: '' }, // Kênh mặc định để post sản phẩm này
    channelId: { type: String, default: '' },   // Kênh đang hiển thị embed
    messageId: { type: String, default: '' },    // Message embed đang hiển thị
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

// Virtual: Đếm tồn kho
productSchema.virtual('stockCount', {
    ref: 'ProductStock',
    localField: '_id',
    foreignField: 'productId',
    count: true,
    match: { status: 'available' }
});

productSchema.set('toJSON', { virtuals: true });
productSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Product', productSchema);
