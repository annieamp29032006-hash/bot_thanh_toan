/**
 * vcbPoller.js - Poll Web2M (gói Vietcombank) để tự động xác nhận chuyển khoản.
 *
 * Khớp giao dịch bằng SỐ TIỀN LẺ ĐỘC NHẤT (khách không cần ghi nội dung).
 * Mỗi vòng còn tự hủy các đơn quá hạn để nhả hàng về kho.
 *
 * Cấu hình .env cho VCB:
 *   WEB2M_API_NAME=historyapivcbv3   (tên API gói VCB của bạn trên web2m)
 *   WEB2M_API_KEY=...                (token/apikey)
 *   WEB2M_ACCOUNT_PASSWORD=...       (mật khẩu tài khoản web2m nếu gói yêu cầu)
 *   BANK_ACCOUNT=...                 (số tài khoản VCB nhận tiền)
 */
const axios = require('axios');
const config = require('../../config');
const orderService = require('../services/mariaOrderService');
const paymentService = require('../services/mariaPaymentService');

let pollerInterval = null;

function buildUrl() {
    // Momo dùng cấu trúc khác; các bank (VCB/MB...) dùng chung dạng dưới
    if (config.WEB2M_API_NAME === 'historyapimomo') {
        return `https://api.web2m.com/${config.WEB2M_API_NAME}/${config.WEB2M_API_KEY}`;
    }
    return `https://api.web2m.com/${config.WEB2M_API_NAME}/${config.WEB2M_ACCOUNT_PASSWORD}/${config.BANK_ACCOUNT}/${config.WEB2M_API_KEY}`;
}

function extractTransactions(data) {
    if (config.WEB2M_API_NAME === 'historyapimomo') {
        return (data.momoMsg && data.momoMsg.tranList) ? data.momoMsg.tranList : [];
    }
    return data.transactions || data.data || [];
}

let _lastApiError = '';
/**
 * Web2M trả { status: false, msg: "..." } khi token/tài khoản sai.
 * Trả về true nếu response hợp lệ (status !== false).
 */
function checkApiStatus(data) {
    if (data && data.status === false) {
        const msg = data.msg || data.message || 'Không rõ lý do';
        // Chỉ log khi lỗi đổi (tránh spam mỗi 30s)
        if (msg !== _lastApiError) {
            console.error(`❌ [Web2M] API từ chối: "${msg}" — kiểm tra WEB2M_API_KEY / WEB2M_ACCOUNT_PASSWORD / BANK_ACCOUNT trong .env`);
            _lastApiError = msg;
        }
        return false;
    }
    if (_lastApiError) {
        console.log('✅ [Web2M] API đã hoạt động lại.');
        _lastApiError = '';
    }
    return true;
}

function txAmountOf(tx) {
    const raw = tx.amount ?? tx.value ?? tx.money ?? tx.creditAmount ?? tx.amountIn ??
                tx.credit ?? tx.so_tien ?? tx.soTien ?? 0;
    // amount có thể là chuỗi "50,000" hoặc "50000.00" -> chỉ giữ chữ số
    return parseInt(String(raw).replace(/[^\d]/g, ''), 10) || 0;
}
function txIdOf(tx) {
    return tx.id ?? tx.transactionID ?? tx.transactionId ?? tx.tid ?? tx.tranId ??
           tx.refNo ?? tx.ma_gd ?? tx.traceId ?? tx.reference ?? '';
}

async function checkTransactions() {
    const pending = await orderService.getPendingOrders();
    if (pending.length === 0) return;

    if (!config.WEB2M_API_KEY || !config.BANK_ACCOUNT) return; // chưa cấu hình VCB

    let transactions = [];
    try {
        const res = await axios.get(buildUrl(), { timeout: 10000 });
        if (!checkApiStatus(res.data)) return; // token/tài khoản sai -> đã log rõ
        transactions = extractTransactions(res.data);
    } catch (err) {
        if (['ECONNREFUSED', 'ETIMEDOUT', 'ECONNABORTED'].includes(err.code)) {
            console.warn('[Web2M Poller] API tạm không phản hồi, thử lại sau...');
            return;
        }
        throw err;
    }

    if (!Array.isArray(transactions) || transactions.length === 0) return;

    for (const tx of transactions) {
        const amount = txAmountOf(tx);
        if (!amount) continue; // không đọc được số tiền -> bỏ qua
        // Mã GD dùng để chống trùng; nếu API không trả mã, dùng khóa dự phòng theo số tiền
        const txId = String(txIdOf(tx) || `amt_${amount}`);

        // Chống xử lý trùng giao dịch (kể cả khi bot restart)
        if (await orderService.isBankTxProcessed(txId)) continue;

        // Tìm đơn pending có số tiền khớp tuyệt đối
        const order = pending.find(o => Number(o.amount) === amount && o.status === 'pending');
        if (!order) continue;

        console.log(`[VCB] ✅ Khớp giao dịch ${order.reference} - ${amount}đ (tx ${txId})`);

        const result = await orderService.confirmPayment(order.id, txId);
        if (result && result.success) {
            const dmSent = await paymentService.deliver(result.order, result.items);
            if (!dmSent) {
                console.warn(`[VCB] Đã thu tiền ${order.reference} nhưng chưa DM được khách (khách tắt DM?).`);
            }
        }
        // đánh dấu order này đã rời pending trong vòng hiện tại
        order.status = 'done';
    }
}

async function tick() {
    // 1) Hủy đơn hết hạn, nhả hàng
    try {
        await orderService.expireOrders();
    } catch (err) {
        console.error('[VCB Poller] Lỗi expireOrders:', err.message);
    }
    // 2) Dò giao dịch mới
    try {
        await checkTransactions();
    } catch (err) {
        console.error('[VCB Poller] Lỗi checkTransactions:', err.message);
    }
}

function start() {
    const intervalMs = (config.PAYMENT_POLL_INTERVAL || 30) * 1000;
    if (!config.WEB2M_API_KEY) {
        console.warn('⚠️ Chưa cấu hình WEB2M_API_KEY (VCB). Poller vẫn chạy để hủy đơn hết hạn, nhưng CHƯA tự duyệt thanh toán.');
    } else {
        console.log(`🔄 VCB Poller đã khởi động (mỗi ${config.PAYMENT_POLL_INTERVAL}s).`);
    }
    pollerInterval = setInterval(tick, intervalMs);
}

function stop() {
    if (pollerInterval) { clearInterval(pollerInterval); pollerInterval = null; }
}

module.exports = { start, stop, tick, checkTransactions };
