/**
 * Category.js - Danh mục sản phẩm.
 *
 * Trước đây danh mục chỉ là chuỗi cứng trong Product.webCategory ('acc_pc', 'gcoin',
 * 'steam', 'outfit') nên không có chỗ gắn ảnh. Tách thành collection riêng để mỗi
 * danh mục có ảnh và tên hiển thị của nó.
 *
 * `key` giữ đúng giá trị mà Product.webCategory đang dùng -> dữ liệu cũ vẫn khớp,
 * không phải sửa Product.
 */
const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true, index: true }, // khớp Product.webCategory
    name: { type: String, required: true },        // tên hiển thị cho khách
    description: { type: String, default: '' },
    imageUrl: { type: String, default: '' },       // CHỈ lưu link ảnh, không lưu file
    sortOrder: { type: Number, default: 0 },       // thứ tự hiện trong menu
    isActive: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Category', categorySchema);
