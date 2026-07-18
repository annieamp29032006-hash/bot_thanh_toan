/**
 * mariaPaymentService.js - Giao hàng qua DM sau khi thanh toán được xác nhận,
 * kèm báo "đã thanh toán" về đúng kênh đã gửi QR.
 */
const { EmbedBuilder, Routes } = require('discord.js');
const config = require('../../config');

let _client = null;
function setClient(client) { _client = client; }

/**
 * Giao hàng tự động: DM khách nội dung (user/pass hoặc code).
 * Trả về true nếu DM thành công.
 */
async function deliver(order, items) {
    if (!_client) return false;

    const lines = items.map((it, i) => {
        if (it.password && it.username && it.username.toUpperCase() !== 'CODE') {
            // Tài khoản: user | pass
            return `**${i + 1}.** Tài khoản: \`${it.username}\` | Mật khẩu: \`${it.password}\``;
        }
        // Code: hiển thị phần code (thường nằm ở password, hoặc username)
        const code = it.password || it.username;
        return `**${i + 1}.** \`${code}\``;
    }).join('\n');

    const embed = new EmbedBuilder()
        .setTitle('🎉 GIAO HÀNG THÀNH CÔNG')
        .setDescription(
            `Cảm ơn bạn đã ủng hộ Kaiz Store!\n\n` +
            `🏷️ **Mã đơn:** \`${order.reference}\`\n` +
            `🛒 **Sản phẩm:** \`${order.product_name}\` (x${order.quantity})\n` +
            `💰 **Đã thanh toán:** \`${Number(order.amount).toLocaleString('vi-VN')} VNĐ\`\n\n` +
            `📦 **THÔNG TIN SẢN PHẨM CỦA BẠN:**\n${lines}\n\n` +
            `*Vui lòng lưu lại thông tin này cẩn thận.*`
        )
        .setColor('#00ff88')
        .setFooter({ text: '© 2026 Kaiz Store | Hệ thống tự động' })
        .setTimestamp();

    try {
        const user = await _client.users.fetch(order.discord_user_id);
        await user.send({ embeds: [embed] });
        return true;
    } catch (err) {
        console.error(`[Delivery] Không DM được user ${order.discord_user_id}:`, err.message);
        return false;
    }
}

/**
 * Báo thanh toán thành công cho riêng người mua, bằng cách SỬA chính tin nhắn QR
 * ephemeral thành thông báo thành công.
 *
 * Vì sao phải sửa tin cũ chứ không gửi tin mới: Discord chỉ cho tin ephemeral tồn tại
 * như phản hồi của một interaction - channel.send() luôn công khai. Sửa tin QR vừa giữ
 * được tính riêng tư, vừa dọn luôn mã QR đã dùng xong.
 *
 * GIỚI HẠN: interaction token chỉ sống 15 phút. Trùng với PAYMENT_TIMEOUT nên hầu hết
 * đơn kịp, nhưng đơn thanh toán ở phút chót có thể lỡ - khi đó chỉ ghi log, KHÔNG gửi
 * bù ra kênh chung vì sẽ lộ đơn của khách cho người khác thấy. Khách vẫn nhận hàng
 * qua DM bình thường.
 *
 * CỐ Ý không kèm user/pass hay code ở đây - thông tin sản phẩm chỉ đi qua DM.
 *
 * Trả về true nếu sửa được.
 */
async function notifyBuyer(order, dmSent) {
    if (!_client || !order.interaction_token) return false;

    try {
        const embed = new EmbedBuilder()
            .setTitle('✅ THANH TOÁN THÀNH CÔNG')
            .setDescription(
                `Cảm ơn bạn đã ủng hộ Kaiz Store!\n\n` +
                `🏷️ **Mã đơn:** \`${order.reference}\`\n` +
                `🛒 **Sản phẩm:** \`${order.product_name}\` (x${order.quantity})\n` +
                `💰 **Số tiền:** \`${Number(order.amount).toLocaleString('vi-VN')} VNĐ\`\n\n` +
                (dmSent
                    ? `📬 Thông tin sản phẩm đã được gửi vào **tin nhắn riêng (DM)** của bạn.`
                    : `⚠️ **Chưa gửi được DM cho bạn** (có thể bạn đang tắt nhận tin nhắn từ người lạ).\n` +
                      `> Hãy bật DM rồi liên hệ admin để nhận hàng — đơn đã được ghi nhận, không mất tiền.`)
            )
            .setColor(dmSent ? '#00ff88' : '#ffcc00')
            .setFooter({ text: '© 2026 Kaiz Store | Hệ thống tự động' })
            .setTimestamp();

        // Sửa phản hồi gốc của interaction (chính là tin nhắn QR), bỏ nút "Hủy giao dịch"
        await _client.rest.patch(
            Routes.webhookMessage(config.CLIENT_ID, order.interaction_token, '@original'),
            { body: { embeds: [embed.toJSON()], components: [] } }
        );
        return true;
    } catch (err) {
        console.error(`[Notify] Không sửa được tin QR của đơn ${order.reference}:`, err.message);
        return false;
    }
}

module.exports = { setClient, deliver, notifyBuyer };
