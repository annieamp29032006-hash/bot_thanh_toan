/**
 * mariaPaymentService.js - Giao hàng qua DM sau khi thanh toán được xác nhận,
 * kèm báo "đã thanh toán" về đúng kênh đã gửi QR.
 */
const { EmbedBuilder } = require('discord.js');

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
 * Báo thanh toán thành công về đúng kênh đã gửi QR (reply vào tin nhắn QR nếu còn).
 *
 * CỐ Ý không kèm user/pass hay code ở đây - kênh có thể là kênh chung, thông tin
 * sản phẩm chỉ đi qua DM. Ở đây chỉ xác nhận tiền đã vào.
 *
 * Trả về true nếu đã gửi được.
 */
async function notifyChannel(order, dmSent) {
    if (!_client || !order.channel_id) return false;

    try {
        const channel = await _client.channels.fetch(order.channel_id);
        if (!channel || !channel.isTextBased()) return false;
        // Đơn đặt ngay trong DM thì deliver() đã gửi vào đó rồi, không lặp lại
        if (channel.isDMBased()) return false;

        const embed = new EmbedBuilder()
            .setTitle('✅ THANH TOÁN THÀNH CÔNG')
            .setDescription(
                `<@${order.discord_user_id}> đã thanh toán thành công!\n\n` +
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

        const payload = { embeds: [embed] };
        // Reply vào tin nhắn QR cho dễ theo dõi; tin nhắn bị xoá thì gửi thường
        if (order.message_id) {
            payload.reply = { messageReference: String(order.message_id), failIfNotExists: false };
        }

        await channel.send(payload);
        return true;
    } catch (err) {
        console.error(`[Notify] Không báo được vào kênh ${order.channel_id}:`, err.message);
        return false;
    }
}

module.exports = { setClient, deliver, notifyChannel };
