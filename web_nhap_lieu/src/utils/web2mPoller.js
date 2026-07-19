/**
 * web2mPoller.js - Polling API Web2M mỗi 30 giây để tìm giao dịch mới
 */
const axios = require('axios');
const Payment = require('../models/Payment');
const paymentService = require('../services/paymentService');
const logService = require('../services/logService');
const config = require('../../config');

let pollerInterval = null;
let lastCheckedId = null; // ID giao dịch cuối cùng đã xử lý

/**
 * Khởi động poller
 */
function start() {
    if (!config.WEB2M_API_KEY) {
        console.warn('⚠️ Chưa cấu hình WEB2M_API_KEY. Payment poller không chạy.');
        return;
    }

    const intervalMs = config.PAYMENT_POLL_INTERVAL * 1000;
    console.log(`🔄 Web2M Poller đã khởi động (mỗi ${config.PAYMENT_POLL_INTERVAL}s).`);

    pollerInterval = setInterval(async () => {
        try {
            await checkTransactions();
        } catch (err) {
            console.error('[Web2M Poller] Lỗi:', err.message);
            await logService.error('web2m_poll', `Lỗi polling Web2M: ${err.message}`);
        }
    }, intervalMs);
}

/**
 * Dừng poller
 */
function stop() {
    if (pollerInterval) {
        clearInterval(pollerInterval);
        pollerInterval = null;
        console.log('⏹️ Web2M Poller đã dừng.');
    }
}

/**
 * Kiểm tra giao dịch mới từ Web2M
 */
async function checkTransactions() {
    try {
        // Lấy tất cả payment đang chờ
        const waitingPayments = await Payment.find({ status: 'waiting' });
        if (waitingPayments.length === 0) return;

        // Gọi API Web2M theo chuẩn mới (hỗ trợ nhiều bank)
        let url = '';
        if (config.WEB2M_API_NAME === 'historyapimomo') {
            url = `https://api.web2m.com/${config.WEB2M_API_NAME}/${config.WEB2M_API_KEY}`;
        } else {
            url = `https://api.web2m.com/${config.WEB2M_API_NAME}/${config.WEB2M_ACCOUNT_PASSWORD}/${config.BANK_ACCOUNT}/${config.WEB2M_API_KEY}`;
        }
        
        const response = await axios.get(url, { timeout: 10000 });

        // Momo trả về momoMsg, các bank khác trả về transactions
        let transactions = [];
        if (config.WEB2M_API_NAME === 'historyapimomo') {
            transactions = (response.data.momoMsg && response.data.momoMsg.tranList) ? response.data.momoMsg.tranList : [];
        } else {
            transactions = response.data.transactions || response.data.data || [];
        }

        if (!Array.isArray(transactions) || transactions.length === 0) return;

        // So khớp từng giao dịch
        for (const tx of transactions) {
            const txContent = (tx.description || tx.content || tx.addInfo || tx.comment || '').toUpperCase();
            const txAmount = parseInt(tx.amount || tx.value || tx.money || 0);
            const txId = tx.id || tx.transactionId || tx.tid || tx.tranId || '';

            // Bỏ qua giao dịch đã xử lý (check trong DB để an toàn tuyệt đối, kể cả khi bot restart)
            if (!txId) continue;
            const isProcessed = await Payment.exists({ bankTransactionId: String(txId) });
            if (isProcessed) continue;

            for (const payment of waitingPayments) {
                const isExactAmount = (txAmount === payment.amount);

                // Khách không cần nhập nội dung, chỉ cần chuyển ĐÚNG số tiền lẻ (theo txt)
                if (isExactAmount) {
                    console.log(`[Web2M] ✅ Tìm thấy giao dịch khớp: ${payment.reference} - ${txAmount}đ (Khớp: Số tiền lẻ duy nhất)`);

                    // Ghi log chuyển khoản thành công vào SYSTEM_LOG
                    await logService.bankTransfer(payment, tx);

                    // Xác nhận thanh toán và lưu mã giao dịch ngân hàng để chống trùng
                    payment.bankTransactionId = String(txId);
                    await paymentService.handlePaymentConfirmed(payment._id, tx);

                    break; // Mỗi tx chỉ match 1 payment
                }
            }
        }
    } catch (err) {
        if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
            console.warn('[Web2M] API không khả dụng, thử lại lần sau...');
        } else {
            throw err;
        }
    }
}

module.exports = { start, stop, checkTransactions };
