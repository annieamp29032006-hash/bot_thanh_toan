/**
 * mariaOrderService.js - Đơn hàng + thanh toán trên MariaDB (bảng bot_orders).
 * Sản phẩm đọc từ catalogService (list_items). Chống bán trùng bằng lock atomic.
 */
const db = require('../utils/mariadb');
const catalog = require('./catalogService');
const config = require('../../config');

const MAX_PENDING_PER_USER = 2;

// ═══════════════════════════════════════════════════
// Sinh mã tham chiếu duy nhất: <PREFIX>-XXXXXXX
// ═══════════════════════════════════════════════════
function randomChars(n) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let s = '';
    for (let i = 0; i < n; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
    return s;
}

async function generateReference() {
    for (let i = 0; i < 50; i++) {
        const ref = `${config.REF_PREFIX}-${randomChars(7)}`;
        const rows = await db.query('SELECT 1 FROM bot_orders WHERE reference = ? LIMIT 1', [ref]);
        if (rows.length === 0) return ref;
    }
    return `${config.REF_PREFIX}-${Date.now()}`;
}

/**
 * Tìm số tiền lẻ độc nhất (base + 1..999) chưa bị đơn pending nào khác dùng.
 */
async function findUniqueAmount(baseAmount) {
    for (let i = 0; i < 80; i++) {
        const suffix = Math.floor(Math.random() * 999) + 1;
        const amount = baseAmount + suffix;
        const rows = await db.query(
            "SELECT 1 FROM bot_orders WHERE amount = ? AND status = 'pending' LIMIT 1",
            [amount]
        );
        if (rows.length === 0) return amount;
    }
    return baseAmount; // fallback hiếm gặp
}

function buildQrUrl(amount) {
    return `https://img.vietqr.io/image/${config.BANK_ID}-${config.BANK_ACCOUNT}-compact2.png` +
        `?amount=${amount}&accountName=${encodeURIComponent(config.BANK_NAME || '')}`;
}

// ═══════════════════════════════════════════════════
// TẠO ĐƠN
// ═══════════════════════════════════════════════════
async function createOrder(userId, username, repId, quantity = 1, channelId = null, interactionToken = null) {
    quantity = Math.max(1, parseInt(quantity) || 1);

    // Chặn spam: tối đa 2 đơn pending
    const pending = await db.query(
        "SELECT COUNT(*) AS c FROM bot_orders WHERE discord_user_id = ? AND status = 'pending'",
        [userId]
    );
    if (Number(pending[0].c) >= MAX_PENDING_PER_USER) {
        return { success: false, message: 'Bạn đang có 2 đơn chưa thanh toán. Hãy thanh toán hoặc bấm "Hủy giao dịch" trước khi mua tiếp!' };
    }

    // Chưa cấu hình ngân hàng VCB
    if (!config.BANK_ACCOUNT) {
        return { success: false, message: 'Cửa hàng chưa cấu hình tài khoản ngân hàng. Vui lòng liên hệ admin!' };
    }

    // Resolve variant
    const v = await catalog.getVariantByRep(repId);
    if (!v) return { success: false, message: 'Sản phẩm không tồn tại hoặc đã ngừng bán.' };
    if (v.qty < quantity) {
        return { success: false, message: `Kho chỉ còn ${v.qty} sản phẩm. Vui lòng chọn số lượng nhỏ hơn.` };
    }

    // Khoá N acc (atomic)
    const lock = await catalog.lockVariantStock(v.groupId, v.name, v.price, quantity);
    if (!lock.success) return { success: false, message: lock.message };

    try {
        const baseAmount = v.price * quantity;
        const amount = await findUniqueAmount(baseAmount);
        const reference = await generateReference();
        const expiresAt = new Date(Date.now() + config.PAYMENT_TIMEOUT * 60 * 1000);

        await db.query(
            `INSERT INTO bot_orders
             (reference, discord_user_id, discord_username, channel_id, interaction_token, category_id, group_id, item_id, item_ids,
              product_name, quantity, base_amount, amount, status, created_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), ?)`,
            [
                reference, userId, username, channelId ? String(channelId) : null, interactionToken, null, v.groupId,
                lock.lockedIds[0], JSON.stringify(lock.lockedIds),
                v.name, quantity, baseAmount, amount, expiresAt
            ]
        );

        const order = {
            reference, product_name: v.name, quantity, amount, base_amount: baseAmount,
            item_ids: lock.lockedIds, group_id: v.groupId
        };
        return { success: true, order, qrUrl: buildQrUrl(amount) };
    } catch (err) {
        // Lỗi khi ghi đơn -> nhả hàng đã khoá
        await catalog.releaseStock(lock.lockedIds);
        throw err;
    }
}

// ═══════════════════════════════════════════════════
// HỦY ĐƠN
// ═══════════════════════════════════════════════════
async function cancelOrder(reference, userId = null) {
    const rows = await db.query('SELECT * FROM bot_orders WHERE reference = ?', [reference]);
    if (rows.length === 0) return { success: false, message: 'Không tìm thấy đơn hàng.' };
    const order = rows[0];

    if (userId && order.discord_user_id !== userId) {
        return { success: false, message: 'Đây không phải đơn hàng của bạn.' };
    }
    if (order.status !== 'pending') {
        return { success: false, message: `Đơn đã ở trạng thái "${order.status}", không thể hủy.` };
    }

    const ids = safeParseIds(order.item_ids);
    await catalog.releaseStock(ids);
    await db.query(
        "UPDATE bot_orders SET status = 'cancelled', updated_at = NOW() WHERE id = ?",
        [order.id]
    );
    return { success: true, order };
}

// ═══════════════════════════════════════════════════
// XÁC NHẬN THANH TOÁN (gọi bởi poller) -> giao hàng
// Trả về { success, order, items } để paymentService gửi DM.
// ═══════════════════════════════════════════════════
async function confirmPayment(orderId, bankTransactionId) {
    // Atomic: chỉ 1 tiến trình chuyển được pending -> paid
    const upd = await db.query(
        "UPDATE bot_orders SET status = 'paid', bank_transaction_id = ?, updated_at = NOW() WHERE id = ? AND status = 'pending'",
        [String(bankTransactionId || ''), orderId]
    );
    if (upd.affectedRows !== 1) return null; // đã xử lý ở nơi khác

    const rows = await db.query('SELECT * FROM bot_orders WHERE id = ?', [orderId]);
    const order = rows[0];
    const ids = safeParseIds(order.item_ids);

    // Đánh dấu đã bán trong list_items
    await catalog.markSold(ids, order.discord_username, order.reference, order.amount);

    // Lấy user/pass để giao
    const items = await catalog.getItemsByIds(ids);

    // Lưu nội dung đã giao + trạng thái delivered
    const deliveredContent = items.map((it, i) =>
        `${i + 1}. ${it.username}${it.password ? ' | ' + it.password : ''}`).join('\n');
    await db.query(
        "UPDATE bot_orders SET status = 'delivered', delivered_content = ?, updated_at = NOW() WHERE id = ?",
        [deliveredContent, orderId]
    );

    return { success: true, order, items };
}

// ═══════════════════════════════════════════════════
// HỦY ĐƠN HẾT HẠN (gọi định kỳ)
// ═══════════════════════════════════════════════════
async function expireOrders() {
    const rows = await db.query(
        "SELECT * FROM bot_orders WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= NOW()"
    );
    for (const order of rows) {
        const ids = safeParseIds(order.item_ids);
        await catalog.releaseStock(ids);
        await db.query(
            "UPDATE bot_orders SET status = 'expired', updated_at = NOW() WHERE id = ?",
            [order.id]
        );
        console.log(`[Order] Hết hạn & nhả hàng: ${order.reference}`);
    }
    return rows.length;
}

// Lưu id tin nhắn QR để khi thanh toán xong còn biết đường reply vào đúng chỗ
async function attachMessageId(reference, messageId) {
    await db.query(
        'UPDATE bot_orders SET message_id = ? WHERE reference = ?',
        [String(messageId), reference]
    );
}

// ═══════════════════════════════════════════════════
// Lấy đơn theo reference / danh sách pending
// ═══════════════════════════════════════════════════
async function getPendingOrders() {
    return db.query("SELECT * FROM bot_orders WHERE status = 'pending'");
}

async function findByReference(reference) {
    const rows = await db.query('SELECT * FROM bot_orders WHERE reference = ?', [reference]);
    return rows[0] || null;
}

async function isBankTxProcessed(bankTransactionId) {
    const rows = await db.query(
        'SELECT 1 FROM bot_orders WHERE bank_transaction_id = ? LIMIT 1',
        [String(bankTransactionId)]
    );
    return rows.length > 0;
}

function safeParseIds(raw) {
    if (!raw) return [];
    try {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch { return []; }
}

module.exports = {
    createOrder,
    attachMessageId,
    cancelOrder,
    confirmPayment,
    expireOrders,
    getPendingOrders,
    findByReference,
    isBankTxProcessed,
    buildQrUrl
};
