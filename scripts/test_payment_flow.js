/**
 * test_payment_flow.js - Kiểm tra luồng thanh toán đầu-cuối trên MongoDB.
 *
 * Đi đúng đường mà webhook Web2M đi: tạo sản phẩm + kho -> đặt đơn (khoá hàng)
 * -> đẩy một "giao dịch ngân hàng" khớp số tiền vào paymentMatcher -> kiểm tra
 * đơn chuyển sang delivered và hàng chuyển sang sold.
 *
 * Cũng kiểm tra chống trùng: đẩy lại đúng giao dịch đó lần hai, phải bị bỏ qua.
 *
 * Chạy: node scripts/test_payment_flow.js   (tự dọn dữ liệu test khi xong)
 */
const mongoose = require('mongoose');
const config = require('../config');
const Product = require('../src/models/Product');
const ProductStock = require('../src/models/ProductStock');
const Order = require('../src/models/Order');
const Payment = require('../src/models/Payment');
const orderService = require('../src/services/orderService');
const matcher = require('../src/services/paymentMatcher');
const paymentService = require('../src/services/paymentService');

const TAG = 'ZZTEST-PAYFLOW';
let ok = true;
function check(label, cond, detail = '') {
    console.log(`${cond ? '  ✓' : '  ✗'} ${label}${detail ? ' — ' + detail : ''}`);
    if (!cond) ok = false;
}

async function cleanup(productId) {
    if (!productId) return;
    const orders = await Order.find({ productId }).select('_id').lean();
    await Payment.deleteMany({ orderId: { $in: orders.map(o => o._id) } });
    await Order.deleteMany({ productId });
    await ProductStock.deleteMany({ productId });
    await Product.deleteOne({ _id: productId });
}

(async () => {
    await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
    console.log('Đã kết nối MongoDB.\n');

    // Bot chưa chạy nên không có Discord client -> deliver sẽ báo lỗi gửi DM.
    // Đó là điều bình thường trong test; ta chỉ quan tâm dữ liệu có đúng không.
    paymentService.setClient(null);

    const old = await Product.findOne({ name: TAG });
    if (old) await cleanup(old._id);

    const product = await Product.create({
        name: TAG, type: 'account', webCategory: 'acc_pc',
        price: 50000, description: 'test', isActive: true
    });
    await ProductStock.insertMany([
        { productId: product._id, content: 'user_test', password: 'pass_test', status: 'available' }
    ]);

    console.log('1) Đặt đơn');
    const res = await orderService.createOrder('tester_1', 'Tester', String(product._id), 1, 'tok_test');
    check('tạo đơn thành công', res.success, res.message || '');
    if (!res.success) { await cleanup(product._id); process.exit(1); }

    const amount = res.order.totalAmount;
    check('số tiền có phần lẻ độc nhất', amount > 50000 && amount < 51000, `${amount}đ`);
    check('kho đã bị khoá', await ProductStock.countDocuments({ productId: product._id, status: 'locked' }) === 1);
    check('còn hàng trống = 0', await ProductStock.countDocuments({ productId: product._id, status: 'available' }) === 0);

    console.log('\n2) Ngân hàng báo có tiền về (đúng số tiền đơn)');
    const fakeTx = { id: 'TXTEST_' + Date.now(), amount, description: 'CK', type: 'IN' };
    const r1 = await matcher.processTransactions([fakeTx], 'Test');
    check('khớp được 1 giao dịch', r1.matched === 1, `matched=${r1.matched}`);

    const orderAfter = await Order.findById(res.order._id).lean();
    const payAfter = await Payment.findById(res.payment._id).lean();
    check('đơn chuyển sang delivered', orderAfter.status === 'delivered', `status=${orderAfter.status}`);
    check('payment chuyển sang confirmed', payAfter.status === 'confirmed', `status=${payAfter.status}`);
    check('lưu mã giao dịch ngân hàng', payAfter.bankTransactionId === fakeTx.id);
    check('hàng chuyển sang sold', await ProductStock.countDocuments({ productId: product._id, status: 'sold' }) === 1);

    console.log('\n3) Webhook gửi lại đúng giao dịch đó (chống trùng)');
    const r2 = await matcher.processTransactions([fakeTx], 'Test');
    check('lần hai bị bỏ qua', r2.matched === 0, `matched=${r2.matched}`);
    check('không sinh thêm đơn', await Order.countDocuments({ productId: product._id }) === 1);

    console.log('\n4) Giao dịch lạ không khớp đơn nào');
    const r3 = await matcher.processTransactions([{ id: 'TXLA_' + Date.now(), amount: 12345, type: 'IN' }], 'Test');
    check('không khớp bừa', r3.matched === 0);

    console.log('\n' + '='.repeat(52));
    console.log(ok ? 'KẾT QUẢ: ĐẠT — luồng thanh toán hoạt động như cũ.' : 'KẾT QUẢ: HỎNG');
    console.log('='.repeat(52));

    await cleanup(product._id);
    console.log('\nĐã dọn sạch dữ liệu test.');
    await mongoose.disconnect();
    process.exit(ok ? 0 : 1);
})().catch(e => { console.error('Lỗi:', e); process.exit(1); });
