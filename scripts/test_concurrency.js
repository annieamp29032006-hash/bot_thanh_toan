/**
 * test_concurrency.js - Chứng minh không bán trùng khi nhiều khách bấm mua cùng lúc.
 *
 * Kịch bản: 1 sản phẩm có ĐÚNG 5 acc trong kho, 12 khách đồng thời mỗi người mua 1.
 * Kỳ vọng: đúng 5 đơn thành công, 7 đơn bị từ chối "hết hàng", và KHÔNG acc nào bị
 * hai đơn khác nhau giữ.
 *
 * Chạy: node scripts/test_concurrency.js
 * Tự dọn sạch dữ liệu test khi xong.
 */
const mongoose = require('mongoose');
const config = require('../config');
const Product = require('../src/models/Product');
const ProductStock = require('../src/models/ProductStock');
const Order = require('../src/models/Order');
const Payment = require('../src/models/Payment');
const orderService = require('../src/services/orderService');

const STOCK = 5;
const BUYERS = 12;
const TAG = 'ZZTEST-CONCURRENCY';

async function cleanup(productId) {
    if (productId) {
        const orders = await Order.find({ productId }).select('_id').lean();
        const ids = orders.map(o => o._id);
        await Payment.deleteMany({ orderId: { $in: ids } });
        await Order.deleteMany({ productId });
        await ProductStock.deleteMany({ productId });
        await Product.deleteOne({ _id: productId });
    }
}

(async () => {
    await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
    console.log('Đã kết nối MongoDB.\n');

    // Dọn tàn dư lần chạy trước (nếu có)
    const old = await Product.findOne({ name: TAG });
    if (old) await cleanup(old._id);

    const product = await Product.create({
        name: TAG, type: 'account', webCategory: 'acc_pc',
        price: 10000, description: 'san pham test', isActive: true
    });
    await ProductStock.insertMany(
        Array.from({ length: STOCK }, (_, i) => ({
            productId: product._id, content: `acc_test_${i}`, password: `pw${i}`, status: 'available'
        }))
    );
    console.log(`Sản phẩm test: ${STOCK} acc trong kho, ${BUYERS} khách mua đồng thời...\n`);

    // Bắn đồng thời
    const results = await Promise.all(
        Array.from({ length: BUYERS }, (_, i) =>
            orderService.createOrder(`testuser_${i}`, `Tester${i}`, String(product._id), 1, `tok_${i}`)
                .then(r => ({ i, ok: r.success, msg: r.message, ref: r.order?.reference }))
                .catch(e => ({ i, ok: false, msg: 'EXCEPTION: ' + e.message }))
        )
    );

    const ok = results.filter(r => r.ok);
    const fail = results.filter(r => !r.ok);
    console.log(`Đơn thành công : ${ok.length}`);
    console.log(`Đơn bị từ chối : ${fail.length}`);
    if (fail.length) console.log(`Lý do mẫu      : "${fail[0].msg}"`);

    // Kiểm tra kho: không acc nào bị 2 đơn giữ
    const locked = await ProductStock.find({ productId: product._id, status: 'locked' }).lean();
    const owners = locked.map(s => String(s.lockedForOrder));
    const dup = owners.length !== new Set(owners).size;
    const avail = await ProductStock.countDocuments({ productId: product._id, status: 'available' });

    console.log(`\nKho sau khi chạy: ${locked.length} bị khoá, ${avail} còn trống (tổng ${STOCK})`);

    const pass =
        ok.length === STOCK &&
        fail.length === BUYERS - STOCK &&
        locked.length === STOCK &&
        avail === 0 &&
        !dup;

    console.log('\n' + '='.repeat(52));
    if (pass) {
        console.log('KẾT QUẢ: ĐẠT — không bán trùng, không bán quá kho.');
    } else {
        console.log('KẾT QUẢ: HỎNG!');
        if (ok.length !== STOCK) console.log(`  - Số đơn thành công là ${ok.length}, đáng lẽ ${STOCK}`);
        if (dup) console.log('  - CÓ ACC BỊ HAI ĐƠN CÙNG GIỮ (bán trùng!)');
        if (avail !== 0) console.log(`  - Còn ${avail} acc chưa khoá dù vẫn có khách bị từ chối`);
    }
    console.log('='.repeat(52));

    await cleanup(product._id);
    console.log('\nĐã dọn sạch dữ liệu test.');
    await mongoose.disconnect();
    process.exit(pass ? 0 : 1);
})().catch(e => { console.error('Lỗi:', e); process.exit(1); });
