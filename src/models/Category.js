/**
 * Category.js - Danh mục sản phẩm, dạng cây 2 cấp.
 *
 *   Cấp 1 (parentKey = null)  ->  Cấp 2 (parentKey = key của cấp 1)  ->  Product
 *
 * Product.webCategory LUÔN trỏ vào key của danh mục CẤP 2. Cấp 1 chỉ để gom nhóm,
 * không gắn sản phẩm trực tiếp - nếu cho phép gắn cả hai cấp thì màn hình mua hàng
 * phải xử lý hai kiểu hiển thị lẫn lộn, rất dễ sinh lỗi.
 */
const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    // null = danh mục gốc (cấp 1). Có giá trị = danh mục con (cấp 2).
    parentKey: { type: String, default: null, index: true },
    /**
     * Cách bày hàng của danh mục này (chỉ có ý nghĩa với danh mục CẤP 2):
     *   'quantity' - bán theo số lượng: gộp mỗi mặt hàng một dòng, khách nhập số lượng.
     *   'specific' - bán đích danh: tách từng cái trong kho thành một dòng riêng kèm
     *                ảnh của chính nó, khách chọn đúng cái muốn mua.
     *
     * Đặt ở danh mục thay vì ở từng sản phẩm: cả một gian hàng thường bán cùng một
     * kiểu, cấu hình một lần đỡ phải nhớ đặt lại cho mỗi mặt hàng mới.
     */
    sellMode: { type: String, enum: ['quantity', 'specific'], default: 'quantity' },
    description: { type: String, default: '' },
    imageUrl: { type: String, default: '' },   // CHỈ lưu link, không lưu file
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

categorySchema.virtual('level').get(function () {
    return this.parentKey ? 2 : 1;
});

categorySchema.set('toJSON', { virtuals: true });
categorySchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Category', categorySchema);
