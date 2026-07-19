/**
 * paymentMatcher.js - Khớp giao dịch ngân hàng với đơn đang chờ rồi giao hàng (nền MongoDB).
 *
 * Khớp bằng SỐ TIỀN LẺ ĐỘC NHẤT: mỗi đơn được gán một số tiền riêng (giá + 1..999)
 * nên khách không cần ghi nội dung chuyển khoản.
 *
 * Chống trùng: mã giao dịch ngân hàng được ghi vào Payment.bankTransactionId, gặp lại
 * cùng mã thì bỏ qua. Webhook Web2M có thể gửi lại cùng một sự kiện nhiều lần.
 */
const Payment = require('../models/Payment');
const paymentService = require('./paymentService');
const tx = require('../utils/txParse');

async function processTransactions(transactions, label = 'Webhook') {
    if (!Array.isArray(transactions) || transactions.length === 0) {
        return { matched: 0, checked: 0 };
    }

    let matched = 0;
    for (const t of transactions) {
        // Chỉ xét TIỀN VÀO (API không ghi rõ loại thì vẫn xét để không sót)
        const type = tx.typeOf(t);
        if (type && type !== 'IN') continue;

        const amount = tx.amountOf(t);
        if (!amount) continue;

        const txId = String(tx.idOf(t) || `amt_${amount}`);

        // Đã xử lý giao dịch này rồi -> bỏ qua (webhook gửi lại)
        const done = await Payment.findOne({ bankTransactionId: txId }).lean();
        if (done) continue;

        // Tìm đơn đang chờ có số tiền khớp tuyệt đối
        const payment = await Payment.findOne({ amount, status: 'waiting' });
        if (!payment) continue;

        await paymentService.handlePaymentConfirmed(payment._id, {
            bankTransactionId: txId,
            raw: t
        });
        matched++;
        console.log(`   🎯 [${label}] KHỚP ${amount}đ (GD ${txId}) → đã xử lý giao hàng.`);
    }

    return { matched, checked: transactions.length };
}

module.exports = { processTransactions };
