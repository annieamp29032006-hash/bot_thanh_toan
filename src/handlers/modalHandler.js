/**
 * modalHandler.js - Xử lý Modal submissions
 */
const orderService = require('../services/orderService');
const logService = require('../services/logService');
const embeds = require('../utils/embedBuilder');

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
}

module.exports = { handle };
