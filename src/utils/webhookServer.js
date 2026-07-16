/**
 * webhookServer.js - Nhận webhook từ Web2M (Web2M TỰ ĐẨY giao dịch sang khi có tiền).
 *
 * Đây là phương án CHÍNH (thay cho polling): gần như tức thì, không rate-limit.
 *
 * Web2M gửi POST tới URL này với:
 *   Header: Authorization: Bearer <WEB2M_WEBHOOK_TOKEN>
 *   Body:   { "status": true, "data": [ { id, type, transactionID, amount, description, date, bank }, ... ] }
 * Bot phải:
 *   - Xác thực Bearer token
 *   - Phản hồi HTTP 200 + { "status": true, "msg": "Ok" } trong vòng 5 giây
 *     (nếu không, Web2M sẽ gửi lại — đã có chống trùng nên gửi lại cũng an toàn)
 */
const express = require('express');
const config = require('../../config');
const matcher = require('../services/paymentMatcher');
const txParse = require('./txParse');

let server = null;

function ts() {
    return new Date().toLocaleTimeString('vi-VN', { hour12: false });
}

function start() {
    const app = express();
    app.use(express.json({ limit: '2mb' }));

    // Health check
    app.get(config.WEBHOOK_PATH, (req, res) => res.json({ status: true, msg: 'Webhook Kaiz Store đang hoạt động' }));

    app.post(config.WEBHOOK_PATH, async (req, res) => {
        // 1) Xác thực Bearer token
        const auth = req.headers['authorization'] || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

        // BẮT BUỘC token (đây là endpoint xác nhận thanh toán). Nếu chưa/ sai token -> từ chối,
        // nhưng IN RA token web2m gửi để bạn copy vào .env (web2m sẽ tự gửi lại sự kiện).
        if (!config.WEB2M_WEBHOOK_TOKEN) {
            console.warn(`   ⚠️ [Webhook ${ts()}] Chưa đặt WEB2M_WEBHOOK_TOKEN trong .env → từ chối (401).`);
            if (token) console.warn(`   👉 Token web2m vừa gửi — COPY chuỗi này vào WEB2M_WEBHOOK_TOKEN trong .env:\n${token}`);
            return res.status(401).json({ status: false, msg: 'Chưa cấu hình token' });
        }
        if (token !== config.WEB2M_WEBHOOK_TOKEN) {
            console.warn(`   ⚠️ [Webhook ${ts()}] Sai Bearer token → từ chối (401).`);
            return res.status(401).json({ status: false, msg: 'Token không hợp lệ' });
        }

        // 2) Lấy danh sách giao dịch
        const transactions = txParse.extractList(req.body);
        const amounts = transactions.map(txParse.amountOf);
        console.log(`\n📨 [Webhook ${ts()}] Nhận ${transactions.length} giao dịch từ Web2M. Số tiền: [${amounts.join(', ')}]`);

        // 3) Khớp + giao hàng (nhanh, chạy trước khi phản hồi; chống trùng lo phần gửi lại)
        try {
            const { matched } = await matcher.processTransactions(transactions, 'Webhook');
            console.log(`   [Webhook ${ts()}] Đã khớp & giao ${matched}/${transactions.length} giao dịch.`);
        } catch (err) {
            console.error(`   [Webhook ${ts()}] Lỗi xử lý:`, err.message);
        }

        // 4) Bắt buộc phản hồi status:true để Web2M không gửi lại
        return res.status(200).json({ status: true, msg: 'Ok' });
    });

    const port = config.WEBHOOK_PORT;
    server = app.listen(port, () => {
        console.log(`📡 Webhook server chạy tại http://0.0.0.0:${port}${config.WEBHOOK_PATH}`);
        if (!config.WEB2M_WEBHOOK_TOKEN) {
            console.warn('   ⚠️ Chưa đặt WEB2M_WEBHOOK_TOKEN trong .env → webhook sẽ từ chối mọi request tới khi có token.');
        }
    });
    server.on('error', (err) => console.error('❌ Webhook server lỗi:', err.message));
}

function stop() {
    if (server) { server.close(); server = null; }
}

module.exports = { start, stop };
