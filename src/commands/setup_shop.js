/**
 * setup_shop.js - Lệnh /setup_shop tạo tin nhắn Neo Menu tương tác
 */
const { SlashCommandBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const embeds = require('../utils/embedBuilder');

const command = new SlashCommandBuilder()
    .setName('setup_shop')
    .setDescription('Tạo tin nhắn Menu Cửa Hàng tương tác (Duy nhất 1 kênh) - Chỉ Admin')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);

async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    try {
        const embed = embeds.shopWelcomeEmbed();

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
