/**
 * fix_orphan_products.js - Chuyển mặt hàng đang gắn ở danh mục CẤP 1 xuống cấp 2.
 *
 * Vì sao cần: mô hình mới bắt mặt hàng phải thuộc danh mục cấp 2. Mặt hàng tạo từ
 * trước còn gắn ở cấp 1 sẽ không bao giờ hiện ra trong menu bot, vì màn cấp 1 chỉ
 * dẫn xuống cấp 2 chứ không liệt kê sản phẩm.
 *
 * Cách xử lý: với mỗi danh mục cấp 1 đang có mặt hàng, tạo một danh mục cấp 2 tên
 * "Tất cả" (key = <cha>_all) rồi chuyển toàn bộ mặt hàng của cha xuống đó.
 *
 * Chạy lại nhiều lần cũng an toàn: đã chuyển hết thì không còn gì để làm.
 * Chạy: node scripts/fix_orphan_products.js
 */
const mongoose = require('mongoose');
const config = require('../config');
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');

(async () => {
    await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
    console.log('Đã kết nối MongoDB.\n');

    const roots = await Category.find({ parentKey: null }).lean();
    const rootKeys = new Set(roots.map(r => r.key));

    // Mặt hàng đang trỏ vào một danh mục cấp 1
    const orphans = await Product.find({ webCategory: { $in: [...rootKeys] } }).lean();

    if (!orphans.length) {
        console.log('Không có mặt hàng nào gắn ở cấp 1. Không cần sửa gì.');
        await mongoose.disconnect();
        return process.exit(0);
    }

    // Gom theo danh mục cha
    const byRoot = new Map();
    for (const p of orphans) {
        if (!byRoot.has(p.webCategory)) byRoot.set(p.webCategory, []);
        byRoot.get(p.webCategory).push(p);
    }

    console.log('SẼ THỰC HIỆN:');
    for (const [rootKey, prods] of byRoot) {
        const root = roots.find(r => r.key === rootKey);
        console.log(`\n  ${root.name} (${rootKey})`);
        console.log(`    + tạo danh mục cấp 2: "Tất cả" (${rootKey}_all)`);
        for (const p of prods) console.log(`      → chuyển: ${p.name.trim()}`);
    }

    console.log('\nĐang thực hiện...\n');

    for (const [rootKey, prods] of byRoot) {
        const root = roots.find(r => r.key === rootKey);
        const childKey = `${rootKey}_all`;

        let child = await Category.findOne({ key: childKey });
        if (!child) {
            child = await Category.create({
                key: childKey,
                name: 'Tất cả',
                parentKey: rootKey,
                description: `Mặt hàng của ${root.name}`,
                imageUrl: root.imageUrl || '',   // kế thừa ảnh của cha cho đỡ trống
                sortOrder: 0
            });
            console.log(`  ✓ Đã tạo "${root.name} › Tất cả"`);
        } else {
            console.log(`  · "${root.name} › Tất cả" đã có sẵn`);
        }

        const r = await Product.updateMany(
            { webCategory: rootKey },
            { $set: { webCategory: childKey } }
        );
        console.log(`  ✓ Đã chuyển ${r.modifiedCount} mặt hàng xuống`);
    }

    // Đối chiếu lại bằng chính hàm mà bot dùng
    const catalog = require('../src/services/catalogService');
    const rootsAfter = await catalog.getRootCategories();
    console.log('\n' + '='.repeat(52));
    console.log(`Bot giờ sẽ hiện ${rootsAfter.length} danh mục cấp 1:`);
    for (const r of rootsAfter) {
        const kids = await catalog.getChildCategories(r.key);
        console.log(`  ${r.name} — còn ${r.avail} sản phẩm`);
        for (const k of kids) {
            const ps = await catalog.getProducts(k.key);
            console.log(`    └─ ${k.name} (${k.avail}) — ${ps.length} mặt hàng`);
        }
    }
    console.log('='.repeat(52));

    await mongoose.disconnect();
    process.exit(0);
})().catch(e => { console.error('Lỗi:', e); process.exit(1); });
