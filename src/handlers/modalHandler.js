/**
 * modalHandler.js - Xử lý Modal submissions
 */
const orderService = require('../services/orderService');
const logService = require('../services/logService');
const embeds = require('../utils/embedBuilder');

// Client dùng để DM khách. Nút duyệt có thể được bấm ở BOT PHỤ, nhưng hàng vẫn
// phải do bot chính gửi - khách mua với bot chính, nhận hàng từ bot lạ rất khó hiểu.
let _dmClient = null;
function setDmClient(client) { _dmClient = client; }
function dmClientOf(interaction) { return _dmClient || interaction.client; }

async function handle(interaction) {
    const id = interaction.customId;

    // ═══════════════════════════════════════
    // MODAL MUA HÀNG BẰNG SỐ LƯỢNG
    // ═══════════════════════════════════════
    if (id.startsWith('modal_buy_')) {
        const productId = id.replace('modal_buy_', '');
        const qtyStr = interaction.fields.getTextInputValue('quantity');
        const quantity = parseInt(qtyStr);

        if (isNaN(quantity) || quantity <= 0) {
            return interaction.update({ content: '❌ Số lượng không hợp lệ! Vui lòng nhập một số nguyên dương.', embeds: [], components: [] });
        }

        const buttonHandler = require('./buttonHandler');
        return buttonHandler.handleBuyConfirm(interaction, productId, quantity, interaction.token);
    }

    // ═══════════════════════════════════════
    // MODAL GIAO HÀNG VIP (Admin submit code)
    // ═══════════════════════════════════════
    if (id.startsWith('modal_deliver_')) {
        await interaction.deferReply({ ephemeral: true });
        const orderRef = id.replace('modal_deliver_', '');
        const content = interaction.fields.getTextInputValue('delivery_content');

        const result = await orderService.deliverVip(orderRef, content, interaction.user.id);
        if (!result.success) {
            return interaction.editReply(`❌ ${result.message}`);
        }

        const order = result.order;

        // DM khách
        try {
            const user = await interaction.client.users.fetch(order.userId);
            if (user) {
                const deliverEmbed = embeds.deliveryEmbed(order, []);
                await user.send({ embeds: [deliverEmbed] });
                order.dmSent = true;
                await order.save();
            }
        } catch (err) {
            console.error(`Không thể DM user ${order.userId}:`, err.message);
        }

        // Cập nhật embed log (xóa nút, đổi màu)
        try {
            const { EmbedBuilder } = require('discord.js');
            const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
            originalEmbed.setColor('#2ECC71');
            originalEmbed.setTitle('✅ ĐÃ GIAO HÀNG VIP');
            originalEmbed.addFields({ name: '👨‍💻 Người giao', value: `<@${interaction.user.id}>`, inline: true });
            await interaction.message.edit({ embeds: [originalEmbed], components: [] });
        } catch (err) { /* ignore */ }

        // Log
        const logEmbed = embeds.saleLogEmbed(order, order.userId, 'vip_sale');
        await logService.vipSale(order, logEmbed);

        return interaction.editReply(`✅ Đã giao hàng VIP cho đơn **${orderRef}**!`);
    }

    // ═══════════════════════════════════════
    // MODAL DUYỆT HÀNG ĐẶC BIỆT (Admin nhập nội dung giao)
    // ═══════════════════════════════════════
    if (id.startsWith('modal_approve_')) {
        await interaction.deferReply({ ephemeral: true });
        const orderRef = id.replace('modal_approve_', '');
        const content = (interaction.fields.getTextInputValue('approval_content') || '').trim();

        // Discord đã chặn ô rỗng, nhưng người ta gõ toàn dấu cách thì vẫn lọt.
        if (!content) {
            return interaction.editReply('❌ Nội dung gửi khách không được để trống.');
        }

        const result = await orderService.deliverApproved(orderRef, content, interaction.user.id);
        if (!result.success) {
            return interaction.editReply(`❌ ${result.message}`);
        }

        const order = result.order;

        // Gửi nội dung admin vừa nhập cho khách
        let dmOk = false;
        try {
            const user = await dmClientOf(interaction).users.fetch(order.userId);
            if (user) {
                await user.send({ embeds: [embeds.specialDeliveredEmbed(order)] });
                order.dmSent = true;
                await order.save();
                dmOk = true;
            }
        } catch (err) {
            console.error(`Không thể DM user ${order.userId}:`, err.message);
        }

        // Đánh dấu tin nhắn xét duyệt là đã xử lý, gỡ nút để khỏi bấm hai lần
        try {
            const { EmbedBuilder } = require('discord.js');
            const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
            originalEmbed.setColor('#2ECC71');
            originalEmbed.setTitle('✅ ĐÃ DUYỆT & GIAO HÀNG');
            originalEmbed.addFields({ name: '👨‍💻 Người duyệt', value: `<@${interaction.user.id}>`, inline: true });
            await interaction.message.edit({ embeds: [originalEmbed], components: [] });
        } catch (err) { /* ignore */ }

        const logEmbed = embeds.saleLogEmbed(order, order.userId, 'account_sale');
        await logService.accountSale(order, logEmbed);

        return interaction.editReply(
            dmOk
                ? `✅ Đã duyệt và gửi hàng cho đơn **${orderRef}**!`
                : `⚠️ Đã duyệt đơn **${orderRef}** nhưng KHÔNG gửi được DM (khách tắt nhận tin nhắn). Dùng \`/order resend\` sau.`
        );
    }
}

module.exports = { handle, setDmClient };
