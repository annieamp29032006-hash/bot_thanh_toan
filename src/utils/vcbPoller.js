/**
 * vcbPoller.js - Poll Web2M để tự động xác nhận chuyển khoản (phương án DỰ PHÒNG).
 *
 * Ưu tiên dùng Webhook (Web2M tự đẩy sang, xem webhookServer.js). Poller này chạy
 * song song như lưới an toàn: hỏi định kỳ + tự hủy đơn hết hạn nhả hàng về kho.
 *
 * Khớp giao dịch bằng SỐ TIỀN LẺ ĐỘC NHẤT (khách không cần ghi nội dung).
 */
const axios = require('axios');
const config = require('../../config');
const orderService = require('../services/mariaOrderService');
const matcher = require('../services/paymentMatcher');
const txParse = require('./txParse');

let pollerInterval = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let _lastApiError = '';

function ts() {
    return new Date().toLocaleTimeString('vi-VN', { hour12: false });
}

function buildUrl() {
    if (config.WEB2M_API_NAME === 'historyapimomo') {
        return `https://api.web2m.com/${config.WEB2M_API_NAME}/${config.WEB2M_API_KEY}`;
    }
    return `https://api.web2m.com/${config.WEB2M_API_NAME}/${config.WEB2M_ACCOUNT_PASSWORD}/${config.BANK_ACCOUNT}/${config.WEB2M_API_KEY}`;
}

/**
 * Web2M hay lỗi vặt "Có lỗi xảy ra! Vui lòng thử lại" — gọi lại 2-3 lần thường là được.
 * Thử tối đa `maxTries` lần TRONG CÙNG 1 chu kỳ. Trả về mảng giao dịch, hoặc null nếu thất bại.
 */
async function fetchTransactions(maxTries = 4, delayMs = 1500) {
    for (let attempt = 1; attempt <= maxTries; attempt++) {
        try {
            const res = await axios.get(buildUrl(), { timeout: 10000 });
            if (res.data && res.data.status === false) {
                const msg = res.data.msg || res.data.message || 'Không rõ lý do';
                console.log(`   ⏳ [${ts()}] Lần ${attempt}/${maxTries}: Web2M lỗi "${msg}"${attempt < maxTries ? ' → thử lại...' : ''}`);
                if (attempt < maxTries) { await sleep(delayMs); continue; }
                console.error(`   ❌ [${ts()}] Web2M TỪ CHỐI sau ${maxTries} lần thử: "${msg}" (bỏ qua, chu kỳ sau thử tiếp)`);
                _lastApiError = msg;
                return null;
            }
            if (_lastApiError) { console.log(`   ✅ [${ts()}] Web2M đã hoạt động lại!`); _lastApiError = ''; }
            if (attempt > 1) console.log(`   ✅ [${ts()}] Web2M OK sau ${attempt} lần thử.`);
            return txParse.extractList(res.data);
        } catch (err) {
            if (['ECONNREFUSED', 'ETIMEDOUT', 'ECONNABORTED'].includes(err.code)) {
                console.warn(`   ⏳ [${ts()}] Lần ${attempt}/${maxTries}: API không phản hồi (${err.code})${attempt < maxTries ? ' → thử lại...' : ''}`);
                if (attempt < maxTries) { await sleep(delayMs); continue; }
                return null;
            }
            throw err;
        }
    }
    return null;
}

async function checkTransactions() {
    const pending = await orderService.getPendingOrders();
    if (pending.length === 0) {
        console.log(`   [${ts()}] Không có đơn nào đang chờ thanh toán → bỏ qua gọi API.`);
        return;
    }
    console.log(`   [${ts()}] Đơn đang chờ: ${pending.length} | số tiền chờ khớp: [${pending.map(o => Number(o.amount)).join(', ')}]`);

    if (!config.WEB2M_API_KEY || !config.BANK_ACCOUNT) {
        console.log('   ⚠️ Chưa cấu hình WEB2M_API_KEY hoặc BANK_ACCOUNT → không gọi API.');
        return;
    }

    const transactions = await fetchTransactions(4, 1500);
    if (transactions === null) return; // thử hết vẫn lỗi -> chu kỳ sau

    if (!Array.isArray(transactions) || transactions.length === 0) {
        console.log(`   [${ts()}] ✅ Gọi API OK nhưng lịch sử giao dịch trống (0 giao dịch).`);
        return;
    }

    const amounts = transactions.map(txParse.amountOf);
    console.log(`   [${ts()}] ✅ Gọi API OK — lấy về ${transactions.length} giao dịch. Số tiền: [${amounts.join(', ')}]`);

    const { matched } = await matcher.processTransactions(transactions, 'Poller');
    if (matched === 0) {
        console.log(`   [${ts()}] ℹ️ Không có giao dịch nào khớp số tiền đơn đang chờ. (Tiền vào chưa khớp / khách chưa chuyển / sai số tiền)`);
    }
}

async function tick() {
    console.log(`\n🔄 [${ts()}] ===== Chu kỳ kiểm tra thanh toán (mỗi ${config.PAYMENT_POLL_INTERVAL}s) =====`);
    try {
        const expired = await orderService.expireOrders();
        if (expired > 0) console.log(`   [${ts()}] Đã hủy ${expired} đơn hết hạn & nhả hàng về kho.`);
    } catch (err) {
        console.error(`   [${ts()}] Lỗi expireOrders:`, err.message);
    }
    try {
        await checkTransactions();
    } catch (err) {
        console.error(`   [${ts()}] Lỗi checkTransactions:`, err.message);
    }
}

function start() {
    const intervalMs = (config.PAYMENT_POLL_INTERVAL || 30) * 1000;
    if (!config.WEB2M_API_KEY) {
        console.warn('⚠️ Chưa cấu hình WEB2M_API_KEY. Poller vẫn chạy để hủy đơn hết hạn, nhưng CHƯA tự duyệt thanh toán.');
    } else {
        console.log(`🔄 Poller dự phòng đã khởi động (mỗi ${config.PAYMENT_POLL_INTERVAL}s).`);
    }
    pollerInterval = setInterval(tick, intervalMs);
}

function stop() {
    if (pollerInterval) { clearInterval(pollerInterval); pollerInterval = null; }
}

module.exports = { start, stop, tick, checkTransactions, fetchTransactions };
