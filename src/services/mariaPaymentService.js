/**
 * mariaPaymentService.js - Giao hàng qua DM sau khi thanh toán được xác nhận.
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

module.exports = { setClient, deliver };
