/**
 * messageCreate.js - Xử lý tin nhắn (Dành cho kênh Đăng Acc Tự Động)
 */
const settings = require('../models/Setting');
const productService = require('../services/productService');
const stockService = require('../services/stockService');
const embeds = require('../utils/embedBuilder');
const imageUploader = require('../utils/imageUploader');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

async function handle(message) {
    if (message.author.bot) return;

    if (message.content === '!setup_shop') {
        // Chỉ admin mới được chạy lệnh này
        if (!message.member.permissions.has('Administrator')) return;

        const embed = new EmbedBuilder()
            .setAuthor({ name: '🛒 HỆ THỐNG CỬA HÀNG TỰ ĐỘNG', iconURL: 'https://cdn-icons-png.flaticon.com/512/3081/3081986.png' })
            .setTitle('🌟 DANH MỤC SẢN PHẨM 🌟')
            .setDescription('Chào mừng bạn đến với hệ thống Cửa Hàng!\n\n💎 **CAM KẾT DỊCH VỤ:**\n> • ⚡ Hoạt động tự động 24/7\n> • 🚀 Giao dịch siêu tốc\n> • 🛡️ Kín đáo & Bảo mật tuyệt đối\n\n👇 *Vui lòng nhấn nút bên dưới để bắt đầu mua sắm!*')
        const btn = new ButtonBuilder()
            .setCustomId('open_shop_menu')
            .setLabel('🛒 Xem Danh Mục Sản Phẩm')
            .setStyle(ButtonStyle.Success);
            
        const row = new ActionRowBuilder().addComponents(btn);
        
        await message.channel.send({ embeds: [embed], components: [row] });
        return message.delete().catch(() => null); // Xóa lệnh !setup_shop đi cho gọn
    }

    // Tính năng auto-post (dựa trên MongoDB) đã ngừng sau khi chuyển sang MariaDB.
    return;

    // eslint-disable-next-line no-unreachable
    // Lấy ID kênh auto-post từ db
    const autoPostChannelId = await settings.get('ch_auto_post');
    if (!autoPostChannelId || message.channel.id !== autoPostChannelId) return;

    // Xử lý tin nhắn trong kênh auto-post
    const lines = message.content.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    if (lines.length < 5) {
        return message.reply('❌ **Lỗi:** Bạn cần nhập ít nhất 5 dòng (Tên, Giá, TK, MK, Kênh).').then(msg => setTimeout(() => msg.delete().catch(()=>null), 5000));
    }

    const title = lines[0];
    const priceStr = lines[1].replace(/,/g, '').replace(/\./g, '');
    const price = parseInt(priceStr, 10);
    if (isNaN(price)) {
        return message.reply(`❌ **Lỗi:** Dòng 2 (Giá tiền) phải là một con số, bạn nhập: \`${lines[1]}\``).then(msg => setTimeout(() => msg.delete().catch(()=>null), 5000));
    }

    const username = lines[2];
    const password = lines[3];
    
    // Parse tag kênh (vd: <#123456789>)
    const channelMatch = lines[4].match(/<#(\d+)>/);
    if (!channelMatch) {
        return message.reply(`❌ **Lỗi:** Dòng 5 (Kênh) phải là Tag Kênh (Vd: #acc-vip).`).then(msg => setTimeout(() => msg.delete().catch(()=>null), 5000));
    }
    const targetChannelId = channelMatch[1];
    const targetChannel = message.guild.channels.cache.get(targetChannelId);
    if (!targetChannel) {
        return message.reply(`❌ **Lỗi:** Không tìm thấy kênh <#${targetChannelId}>.`).then(msg => setTimeout(() => msg.delete().catch(()=>null), 5000));
    }

    // Xử lý ảnh đính kèm
    const attachment = message.attachments.first();
    let imageUrl = '';
    if (attachment) {
        try {
            imageUrl = await imageUploader.upload(message.client, attachment.url);
        } catch (err) {
            return message.reply(`❌ **Lỗi tải ảnh:** ${err.message}`).then(msg => setTimeout(() => msg.delete().catch(()=>null), 5000));
        }
    }

    const description = lines.slice(5).join('\n') || '';

    // Xóa tin nhắn gốc của Admin cho đỡ rác kênh
    message.delete().catch(() => null);

    try {
        // 1. Tạo Product
        const product = await productService.create({
            name: title,
            type: 'account',
            price,
            description,
            imageUrl,
            displayChannelId: targetChannel.id
        });

        // 2. Tạo Stock (1 chiếc)
        await stockService.addOne(product._id, username, password, imageUrl);

        // 3. Đăng lên kênh
        const embed = embeds.productEmbed(product, 1);
        const row = embeds.buyButton(product._id);

        const msg = await targetChannel.send({ embeds: [embed], components: [row] });

        // 4. Cập nhật messageId
        await productService.update(product._id, {
            channelId: targetChannel.id,
            messageId: msg.id
        });

        const successMsg = await message.channel.send(`✅ Đã đăng thành công **${title}** lên kênh <#${targetChannel.id}>!`);
        setTimeout(() => successMsg.delete().catch(() => null), 3000); // Xóa thông báo sau 3s

    } catch (err) {
        console.error('Lỗi khi auto-post:', err);
        message.channel.send(`❌ Lỗi đăng bài: ${err.message}`);
    }
}

module.exports = { handle };
