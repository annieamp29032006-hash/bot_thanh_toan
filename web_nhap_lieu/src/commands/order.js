/**
 * order.js - Lệnh /order find|deliver|cancel|refund|resend
 */
const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } = require('discord.js');
const orderService = require('../services/orderService');
const paymentService = require('../services/paymentService');
const logService = require('../services/logService');
const embeds = require('../utils/embedBuilder');

const command = new SlashCommandBuilder()
    .setName('order')
    .setDescription('Quản lý đơn hàng (Chỉ Admin)')
    .addSubcommand(sub => sub
        .setName('find')
        .setDescription('Tra cứu đơn hàng theo mã tham chiếu')
        .addStringOption(opt => opt.setName('ref').setDescription('Mã tham chiếu (VD: KZ-00000001)').setRequired(true))
    )
    .addSubcommand(sub => sub
        .setName('deliver')
        .setDescription('Giao hàng VIP (nhập code thủ công)')
        .addStringOption(opt => opt.setName('ref').setDescription('Mã tham chiếu đơn VIP').setRequired(true))
        .addStringOption(opt => opt.setName('content').setDescription('Nội dung giao (code, tài khoản...)').setRequired(true))
    )
    .addSubcommand(sub => sub
        .setName('cancel')
        .setDescription('Hủy đơn hàng')
        .addStringOption(opt => opt.setName('ref').setDescription('Mã tham chiếu').setRequired(true))
    )
    .addSubcommand(sub => sub
        .setName('refund')
        .setDescription('Hoàn tiền đơn hàng')
        .addStringOption(opt => opt.setName('ref').setDescription('Mã tham chiếu').setRequired(true))
    )
    .addSubcommand(sub => sub
        .setName('resend')
        .setDescription('Gửi lại DM sản phẩm cho khách')
        .addStringOption(opt => opt.setName('ref').setDescription('Mã tham chiếu').setRequired(true))
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);

async function execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ═══════════════════════════════════════
    // /order find
    // ═══════════════════════════════════════
    if (sub === 'find') {
        await interaction.deferReply({ ephemeral: true });
        const ref = interaction.options.getString('ref');
        const order = await orderService.findByReference(ref);

        if (!order) return interaction.editReply('❌ Không tìm thấy đơn hàng.');

        const statusEmoji = {
            pending: '⏳', paid: '💰', delivered: '✅',
            cancelled: '❌', out_of_stock: '⚠️', refunded: '🔄'
        };

        const embed = new EmbedBuilder()
            .setTitle(`📋 Đơn hàng: ${order.reference}`)
            .addFields(
                { name: '🛒 Sản phẩm', value: order.productName, inline: true },
                { name: '📦 Loại', value: order.productType, inline: true },
                { name: '📝 Số lượng', value: `${order.quantity}`, inline: true },
                { name: '💰 Tổng tiền', value: `${order.totalAmount.toLocaleString()} VNĐ`, inline: true },
                { name: '👤 Người mua', value: `<@${order.userId}>`, inline: true },
                { name: '📊 Trạng thái', value: `${statusEmoji[order.status] || '❓'} ${order.status}`, inline: true },
                { name: '📅 Tạo lúc', value: order.createdAt.toLocaleString('vi-VN'), inline: true },
                { name: '📨 DM', value: order.dmSent ? '✅ Đã gửi' : '❌ Chưa gửi', inline: true }
            )
            .setColor(order.status === 'delivered' ? '#2ECC71' : order.status === 'cancelled' ? '#E74C3C' : '#F1C40F')
            .setTimestamp();

        if (order.deliveredBy) {
            embed.addFields({ name: '👨‍💻 Admin giao', value: `<@${order.deliveredBy}>`, inline: true });
        }

        return interaction.editReply({ embeds: [embed] });
    }

    // ═══════════════════════════════════════
    // /order deliver (VIP)
    // ═══════════════════════════════════════
    if (sub === 'deliver') {
        await interaction.deferReply({ ephemeral: true });
        const ref = interaction.options.getString('ref');
        const content = interaction.options.getString('content');

        const result = await orderService.deliverVip(ref, content, interaction.user.id);
        if (!result.success) return interaction.editReply(`❌ ${result.message}`);

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
            await interaction.followUp({ content: '⚠️ Không thể gửi DM cho khách (có thể đang tắt DMs). Dùng `/order resend` sau.', ephemeral: true });
        }

        // Log
        const logEmbed = embeds.saleLogEmbed(order, order.userId, 'vip_sale');
        await logService.vipSale(order, logEmbed);

        return interaction.editReply(`✅ Đã giao hàng VIP cho đơn **${ref}**!`);
    }

    // ═══════════════════════════════════════
    // /order cancel
    // ═══════════════════════════════════════
    if (sub === 'cancel') {
        await interaction.deferReply({ ephemeral: true });
        const ref = interaction.options.getString('ref');
        const result = await orderService.cancelOrder(ref);
        if (!result.success) return interaction.editReply(`❌ ${result.message}`);
        return interaction.editReply(`✅ Đã hủy đơn **${ref}**.`);
    }

    // ═══════════════════════════════════════
    // /order refund
    // ═══════════════════════════════════════
    if (sub === 'refund') {
        await interaction.deferReply({ ephemeral: true });
        const ref = interaction.options.getString('ref');
        const result = await orderService.refundOrder(ref);
        if (!result.success) return interaction.editReply(`❌ ${result.message}`);
        return interaction.editReply(`✅ Đã đánh dấu hoàn tiền đơn **${ref}**. Hãy chuyển tiền lại cho khách thủ công.`);
    }

    // ═══════════════════════════════════════
    // /order resend
    // ═══════════════════════════════════════
    if (sub === 'resend') {
        await interaction.deferReply({ ephemeral: true });
        const ref = interaction.options.getString('ref');
        const result = await paymentService.resendDelivery(ref);
        if (!result.success) return interaction.editReply(`❌ ${result.message}`);
        return interaction.editReply(`✅ Đã gửi lại DM cho khách đơn **${ref}**.`);
    }
}

module.exports = { command, execute };
