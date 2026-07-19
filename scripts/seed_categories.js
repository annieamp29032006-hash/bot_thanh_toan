/**
 * seed_categories.js - Tạo 4 danh mục mặc định khớp với Product.webCategory
 * mà web nhập liệu đang dùng ('acc_pc', 'gcoin', 'steam', 'outfit').
 *
 * Chạy: node scripts/seed_categories.js
 * Chạy lại nhiều lần cũng an toàn - đã có thì bỏ qua, KHÔNG ghi đè ảnh bạn đã đặt.
 */
const mongoose = require('mongoose');
const config = require('../config');
const Category = require('../src/models/Category');

const DEFAULTS = [
    { key: 'acc_pc', name: 'Account PC', sortOrder: 1, description: 'Tài khoản game PC' },
    { key: 'gcoin', name: 'Gcoin', sortOrder: 2, description: 'Nạp Gcoin' },
    { key: 'steam', name: 'Steam Wallet', sortOrder: 3, description: 'Thẻ Steam Wallet' },
    { key: 'outfit', name: 'Outfit', sortOrder: 4, description: 'Trang phục, vật phẩm' }
];

(async () => {
    await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
    console.log('Đã kết nối MongoDB.\n');

    for (const d of DEFAULTS) {
        const existing = await Category.findOne({ key: d.key });
        if (existing) {
            console.log(`- ${d.key.padEnd(8)} đã có, bỏ qua (ảnh: ${existing.imageUrl || 'chưa đặt'})`);
            continue;
        }
        await Category.create({ ...d, imageUrl: '' });
        console.log(`+ ${d.key.padEnd(8)} đã tạo "${d.name}" (imageUrl để trống, bạn dán link sau)`);
    }

    console.log('\nDanh mục hiện có:');
    for (const c of await Category.find().sort({ sortOrder: 1 }).lean()) {
        console.log(`  ${c.key.padEnd(8)} | ${c.name.padEnd(16)} | ảnh: ${c.imageUrl || '(trống)'}`);
    }

    await mongoose.disconnect();
    process.exit(0);
})().catch(e => { console.error('Lỗi:', e.message); process.exit(1); });
