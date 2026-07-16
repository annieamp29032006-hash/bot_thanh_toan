/**
 * paymentMatcher.js - Khớp giao dịch ngân hàng với đơn đang chờ rồi giao hàng.
 * Dùng chung cho cả Poller (hỏi định kỳ) và Webhook (Web2M tự đẩy sang).
 *
 * Khớp bằng SỐ TIỀN (số tiền lẻ độc nhất của đơn). Chỉ xét tiền VÀO (IN).
 * Chống trùng bằng mã giao dịch (isBankTxProcessed) + confirmPayment atomic.
 */
const tx = require('../utils/txParse');
const orderService = require('./mariaOrderService');
const paymentService = require('./mariaPaymentService');

/**
 * @param {Array} transactions  danh sách giao dịch (đã extract)
 * @param {string} label        nhãn nguồn để log ("Poller" | "Webhook")
 * @returns {{matched:number, checked:number}}
 */
async function processTransactions(transactions, label = '') {
    if (!Array.isArray(transactions) || transactions.length === 0) {
        return { matched: 0, checked: 0 };
    }

    const pending = await orderService.getPendingOrders();
    if (pending.length === 0) return { matched: 0, checked: transactions.length };

    let matched = 0;
    for (const t of transactions) {
        // Chỉ xét TIỀN VÀO (nếu API không ghi rõ loại thì vẫn xét để không sót)
        const type = tx.typeOf(t);
        if (type && type !== 'IN') continue;

        const amount = tx.amountOf(t);
        if (!amount) continue;

        const txId = String(tx.idOf(t) || `amt_${amount}`);
        if (await orderService.isBankTxProcessed(txId)) continue;

        // Tìm đơn pending có số tiền khớp tuyệt đối
        const order = pending.find(o => Number(o.amount) === amount && o.status === 'pending');
        if (!order) continue;

        const result = await orderService.confirmPayment(order.id, txId);
        if (result && result.success) {
            const dmSent = await paymentService.deliver(result.order, result.items);
            console.log(`   🎯 [${label}] KHỚP đơn ${order.reference} = ${amount}đ (GD ${txId}) → giao hàng | DM khách: ${dmSent ? 'THÀNH CÔNG' : 'THẤT BẠI (khách tắt DM?)'}`);
            matched++;
            order.status = 'done'; // tránh khớp lại trong cùng lượt
        }
    }
    return { matched, checked: transactions.length };
}

module.exports = { processTransactions };
