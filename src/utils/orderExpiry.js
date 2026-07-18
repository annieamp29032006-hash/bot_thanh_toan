/**
 * orderExpiry.js - Tự hủy đơn quá hạn thanh toán và nhả hàng về kho.
 *
 * Xác nhận thanh toán do Webhook lo (xem webhookServer.js) - Web2M tự đẩy giao dịch sang.
 * Module này KHÔNG gọi API Web2M, chỉ quét bot_orders theo chu kỳ: đơn nào còn 'pending'
 * mà quá expires_at thì chuyển 'expired' và mở khóa list_items về lại kho.
 *
 * Bắt buộc phải chạy: tạo đơn có khóa hàng (status 2), không có bước nhả này thì
 * mọi đơn khách bỏ dở sẽ giữ hàng vĩnh viễn.
 */
const config = require('../../config');
const orderService = require('../services/mariaOrderService');

let timer = null;

function ts() {
    return new Date().toLocaleTimeString('vi-VN', { hour12: false });
}

async function tick() {
    try {
        const expired = await orderService.expireOrders();
        if (expired > 0) console.log(`   [${ts()}] Đã hủy ${expired} đơn hết hạn & nhả hàng về kho.`);
    } catch (err) {
        console.error(`   [${ts()}] Lỗi expireOrders:`, err.message);
    }
}

function start() {
    const intervalMs = (config.PAYMENT_POLL_INTERVAL || 30) * 1000;
    timer = setInterval(tick, intervalMs);
    console.log(`🧹 Dọn đơn hết hạn đã khởi động (mỗi ${config.PAYMENT_POLL_INTERVAL}s).`);
}

function stop() {
    if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { start, stop, tick };
