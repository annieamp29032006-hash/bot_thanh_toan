/**
 * remove_all_category.js - Gỡ bỏ danh mục cấp 2 "Tất cả" (<cha>_all) do bước sửa
 * lỗi mồ côi trước đây tự tạo ra.
 *
 * Lý do gỡ: tầng đó chỉ tồn tại vì luật cũ bắt sản phẩm phải thuộc cấp 2. Luật đã
 * nới - cấp 1 nào chưa chia nhỏ thì bot vào thẳng sản phẩm - nên nó thành một bước
 * bấm thừa, không mang thông tin gì.
 *
 * Việc làm: chuyển sản phẩm từ <cha>_all về lại <cha>, rồi xoá danh mục <cha>_all.
 * Chạy lại nhiều lần cũng an toàn.
 *
 * Chạy: node scripts/remove_all_category.js
 */
const mongoose = require('mongoose');
const config = require('../config');
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');

(async () => {
    await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
    console.log('Đã kết nối MongoDB.\n');

    const alls = await Category.find({ key: /_all$/, parentKey: { $ne: null } }).lean();

    if (!alls.length) {
        console.log('Không có danh mục "Tất cả" nào. Không cần làm gì.');
        await mongoose.disconnect();
        return process.exit(0);
    }

    for (const c of alls) {
        const n = await Product.countDocuments({ webCategory: c.key });
        console.log(`  ${c.key} -> chuyển ${n} mặt hàng về "${c.parentKey}" rồi xoá`);

        const r = await Product.updateMany(
            { webCategory: c.key },
            { $set: { webCategory: c.parentKey } }
        );
        await Category.deleteOne({ key: c.key });
        console.log(`    ✓ đã chuyển ${r.modifiedCount}, đã xoá danh mục`);
    }

    // Đối chiếu bằng chính hàm bot dùng
    const catalog = require('../src/services/catalogService');
    const roots = await catalog.getRootCategories();
    console.log('\n' + '='.repeat(56));
    console.log(`Bot sẽ hiện ${roots.length} danh mục cấp 1:`);
    for (const r of roots) {
        const hasKids = await catalog.hasChildren(r.key);
        const ps = hasKids ? [] : await catalog.getProducts(r.key);
        console.log(`  ${r.name.padEnd(16)} còn ${String(r.avail).padStart(3)} sp` +
                    (hasKids ? '  -> bấm vào ra DANH MỤC CON' : `  -> bấm vào ra THẲNG ${ps.length} sản phẩm`));
    }
    console.log('='.repeat(56));

    await mongoose.disconnect();
    process.exit(0);
})().catch(e => { console.error('Lỗi:', e); process.exit(1); });
