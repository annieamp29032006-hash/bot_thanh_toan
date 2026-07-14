/**
 * setup.js - Lệnh /setup cấu hình kênh và hệ thống
 */
const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const settings = require('../models/Setting');

const command = new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Cấu hình hệ thống Shop Bot (Chỉ Admin)')
    .addSubcommand(sub => sub
        .setName('channels')
        .setDescription('Cấu hình các kênh log và image storage')
        .addChannelOption(opt => opt.setName('system_log').setDescription('Kênh system-log').addChannelTypes(ChannelType.GuildText).setRequired(false))
        .addChannelOption(opt => opt.setName('log_code').setDescription('Kênh log-code').addChannelTypes(ChannelType.GuildText).setRequired(false))
        .addChannelOption(opt => opt.setName('log_vip').setDescription('Kênh log-vip').addChannelTypes(ChannelType.GuildText).setRequired(false))
        .addChannelOption(opt => opt.setName('log_account').setDescription('Kênh log-account').addChannelTypes(ChannelType.GuildText).setRequired(false))
        .addChannelOption(opt => opt.setName('image_storage').setDescription('Kênh image-storage').addChannelTypes(ChannelType.GuildText).setRequired(false))
    )
    .addSubcommand(sub => sub
        .setName('full')
        .setDescription('Tự động tạo toàn bộ Server (Cửa Hàng, Bảng Doanh Thu, Log Admin)')
    )
    .addSubcommand(sub => sub
        .setName('auto_post')
        .setDescription('Tạo kênh tự động đăng Account nhanh')
    )
    .addSubcommand(sub => sub
        .setName('info')
        .setDescription('Xem cấu hình hiện tại')
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);

async function execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'channels') {
        await interaction.deferReply({ ephemeral: true });

        const channelMap = {
            'system_log': 'ch_system_log',
            'log_code': 'ch_log_code',
            'log_vip': 'ch_log_vip',
            'log_account': 'ch_log_account',
            'image_storage': 'ch_image_storage'
        };

        let updated = [];
        for (const [optName, dbKey] of Object.entries(channelMap)) {
            const channel = interaction.options.getChannel(optName);
            if (channel) {
                await settings.set(dbKey, channel.id);
                updated.push(`✅ ${optName}: <#${channel.id}>`);
            }
        }

        if (updated.length === 0) {
            return interaction.editReply('⚠️ Bạn chưa chọn kênh nào để cấu hình.');
        }

        return interaction.editReply(`**Đã cập nhật cấu hình:**\n${updated.join('\n')}`);
    }

    // ═══════════════════════════════════════
    // /setup full
    // ═══════════════════════════════════════
    if (sub === 'full') {
        await interaction.deferReply({ ephemeral: true });
        
        try {
            const guild = interaction.guild;
            
            // Tạo Category Log
            const logCategory = await guild.channels.create({
                name: '⚙️ LOGS GIAO DỊCH',
                type: ChannelType.GuildCategory
            });

            // Tạo các kênh log
            const systemLog = await guild.channels.create({ name: '⚙-system-log', type: ChannelType.GuildText, parent: logCategory.id });
            const logCode = await guild.channels.create({ name: '📜-log-code', type: ChannelType.GuildText, parent: logCategory.id });
            const logVip = await guild.channels.create({ name: '⭐-log-vip', type: ChannelType.GuildText, parent: logCategory.id });
            const logAccount = await guild.channels.create({ name: '🎮-log-account', type: ChannelType.GuildText, parent: logCategory.id });

            // Tạo Category Hệ Thống
            const sysCategory = await guild.channels.create({
                name: '🔧 HỆ THỐNG SHOP',
                type: ChannelType.GuildCategory
            });

            const imageStorage = await guild.channels.create({ name: '🖼-image-storage', type: ChannelType.GuildText, parent: sysCategory.id });

            // Tạo Category Cửa hàng
            const shopCategory = await guild.channels.create({
                name: '🏪 CỬA HÀNG',
                type: ChannelType.GuildCategory
            });

            // Tạo 1 Kênh bán hàng duy nhất theo yêu cầu
            await guild.channels.create({ name: '🛒-cua-hang-tu-dong', type: ChannelType.GuildText, parent: shopCategory.id });

            // Tạo Category Bảng Vàng Doanh Thu
            const statsCategory = await guild.channels.create({
                name: '📊 BẢNG VÀNG DOANH THU',
                type: ChannelType.GuildCategory
            });

            const stats24h = await guild.channels.create({ name: '📈-doanh-thu-24h', type: ChannelType.GuildText, parent: statsCategory.id });
            const stats30d = await guild.channels.create({ name: '📉-doanh-thu-30-ngay', type: ChannelType.GuildText, parent: statsCategory.id });

            // Gửi tin nhắn giữ chỗ để Bot Edit sau này
            const msg24h = await stats24h.send('🔄 Bảng thống kê đang được khởi tạo...');
            const msg30d = await stats30d.send('🔄 Bảng thống kê đang được khởi tạo...');

            // Tạo Kênh Đăng Acc Nhanh trong HỆ THỐNG SHOP
            const autoPostChannel = await guild.channels.create({ name: '🔧-dang-acc-nhanh', type: ChannelType.GuildText, parent: sysCategory.id });

            // Lưu cấu hình vào DB
            await settings.set('ch_system_log', systemLog.id);
            await settings.set('ch_log_code', logCode.id);
            await settings.set('ch_log_vip', logVip.id);
            await settings.set('ch_log_account', logAccount.id);
            await settings.set('ch_image_storage', imageStorage.id);
            await settings.set('ch_auto_post', autoPostChannel.id);
            await settings.set('ch_stats_24h', stats24h.id);
            await settings.set('msg_stats_24h', msg24h.id);
            await settings.set('ch_stats_30d', stats30d.id);
            await settings.set('msg_stats_30d', msg30d.id);

            return interaction.editReply(
                `✅ **Đã xây dựng toàn bộ Server thành công!**\n\n` +
                `**1. Bảng Doanh Thu:** <#${stats24h.id}>, <#${stats30d.id}>\n` +
                `**2. Quản Lý Admin:** <#${autoPostChannel.id}>, <#${systemLog.id}>\n` +
                `**3. Cửa Hàng:** Sẵn sàng giao dịch!\n\n` +
                `*Lưu ý: Bảng doanh thu sẽ tự động nhảy số liệu sau 5-10 phút nữa.*`
            );
        } catch (error) {
            console.error('Lỗi khi auto setup kênh:', error);
            return interaction.editReply(`❌ Không thể tự động tạo kênh. Bot có đủ quyền Quản lý kênh (Manage Channels) không? Lỗi: ${error.message}`);
        }
    }

    // ═══════════════════════════════════════
    // /setup auto_post
    // ═══════════════════════════════════════
    if (sub === 'auto_post') {
        await interaction.deferReply({ ephemeral: true });
        
        try {
            const guild = interaction.guild;
            let sysCategory = guild.channels.cache.find(c => c.name === '🔧 HỆ THỐNG SHOP' && c.type === ChannelType.GuildCategory);
            
            if (!sysCategory) {
                sysCategory = await guild.channels.create({
                    name: '🔧 HỆ THỐNG SHOP',
                    type: ChannelType.GuildCategory
                });
            }

            const autoPostChannel = await guild.channels.create({ 
                name: '🔧-dang-acc-nhanh', 
                type: ChannelType.GuildText, 
                parent: sysCategory.id 
            });

            await settings.set('ch_auto_post', autoPostChannel.id);

            return interaction.editReply(
                `✅ **Đã tạo thành công kênh Đăng Nhanh!**\n` +
                `👉 <#${autoPostChannel.id}>\n\n` +
                `Bạn hãy vào kênh đó và gửi tin nhắn theo format:\n` +
                `\`\`\`\nTên Acc\nGiá tiền\nTài khoản\nMật khẩu\n#Tag_Kênh_Bán\n\`\`\`\n` +
                `*(Nhớ đính kèm 1 tấm ảnh vào tin nhắn luôn nhé!)*`
            );
        } catch (error) {
            console.error('Lỗi khi setup kênh auto_post:', error);
            return interaction.editReply(`❌ Không thể tạo kênh: ${error.message}`);
        }
    }

    if (sub === 'info') {
        await interaction.deferReply({ ephemeral: true });

        const keys = ['ch_system_log', 'ch_log_code', 'ch_log_vip', 'ch_log_account', 'ch_image_storage', 'ch_auto_post'];
        const lines = [];
        for (const key of keys) {
            const val = await settings.get(key);
            lines.push(`**${key}:** ${val ? `<#${val}>` : '❌ Chưa cấu hình'}`);
        }

        return interaction.editReply(`**⚙️ Cấu hình hiện tại:**\n${lines.join('\n')}`);
    }
}

module.exports = { command, execute };
