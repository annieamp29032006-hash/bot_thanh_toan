/**
 * setup_shop.js - Lệnh /setup_shop tạo tin nhắn Neo Menu tương tác
 */
const { SlashCommandBuilder, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const command = new SlashCommandBuilder()
    .setName('setup_shop')
    .setDescription('Tạo tin nhắn Menu Cửa Hàng tương tác (Duy nhất 1 kênh) - Chỉ Admin')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);

async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const embed = new EmbedBuilder()
            .setAuthor({ name: '🛒 HỆ THỐNG CỬA HÀNG TỰ ĐỘNG', iconURL: 'https://cdn-icons-png.flaticon.com/512/3081/3081986.png' })
            .setTitle('🌟 DANH MỤC SẢN PHẨM 🌟')
            .setDescription('Chào mừng bạn đến với hệ thống Cửa Hàng!\n\n💎 **CAM KẾT DỊCH VỤ:**\n> • ⚡ Hoạt động tự động 24/7\n> • 🚀 Giao dịch siêu tốc\n> • 🛡️ Kín đáo & Bảo mật tuyệt đối\n\n👇 *Vui lòng nhấn nút bên dưới để bắt đầu mua sắm!*')
            .setColor('#00D8FF')
            .setFooter({ text: 'Uy tín - Nhanh chóng - Tiện lợi' });

        const btn = new ButtonBuilder()
            .setCustomId('open_shop_menu')
            .setLabel('🛒 Xem Danh Mục Sản Phẩm')
            .setStyle(ButtonStyle.Success);
            
        const row = new ActionRowBuilder().addComponents(btn);
        
        await interaction.channel.send({ embeds: [embed], components: [row] });
        
        return interaction.editReply('✅ Đã tạo thành công Anchor Message cho Menu Cửa Hàng!');
    } catch (err) {
        return interaction.editReply(`❌ Lỗi: ${err.message}`);
    }
}

module.exports = { command, execute };
