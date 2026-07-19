const express = require('express');
const bodyParser = require('body-parser');
const db = require('./database');
const { EmbedBuilder } = require('discord.js');

function setupPaymentWebhook(client) {
    const app = express();
    app.use(bodyParser.json());

    const PORT = process.env.PORT || 3000;

    // API nhận Webhook
    app.post('/webhook/payment', async (req, res) => {
        try {
            console.log('Nhận được webhook thanh toán:', req.body);
            const rawBodyStr = JSON.stringify(req.body);

            // QUÉT TOÀN THÂN TÌM MÃ THAM CHIẾU (CHỈ ĐỂ HIỂN THỊ LOG, KHÔNG BẮT BUỘC)
            const match = rawBodyStr.match(/(W2M-[A-Z0-9]+)/i); 
            let orderCode = match ? match[1].toUpperCase() : 'KHÔNG XÁC ĐỊNH';

            // 2. TÌM SỐ TIỀN (Dò các trường thông dụng)
            let transferAmount = 0;
            if (req.body.data && Array.isArray(req.body.data) && req.body.data.length > 0) {
                transferAmount = req.body.data[0].amount || req.body.data[0].value || 0;
            } else {
                transferAmount = req.body.transferAmount || req.body.amount || req.body.value || req.body.money || 0;
            }

            // GỬI THÔNG BÁO TỨC THÌ (BÁO TIỀN VÀO)
            try {
                const logChannel = client.channels.cache.find(c => c.name === 'lich-su-giao-dich');
                if (logChannel) {
                    await logChannel.send(`🔔 **Có chuyển khoản đến!** Số tiền: \`${transferAmount.toLocaleString()} VNĐ\` - Mã tham chiếu: \`${orderCode}\``);
                }
            } catch (err) {}

            console.log(`[Thanh Toán] Đã nhận ${transferAmount}đ`);

            // Gọi hàm duyệt đơn (CHỈ DỰA VÀO SỐ TIỀN)
            const result = await db.fulfillOrder(transferAmount);

                if (result.success) {
                    // Lấy mã đơn hàng xịn từ Database
                    orderCode = result.orderCode || orderCode;
                    console.log(`[Thanh Toán] Đã giao hàng thành công cho đơn ${orderCode}!`);
                    
                    const account = result.account;

                    // 1. XÓA BÀI ĐĂNG CỦA SẢN PHẨM Ở TRONG KÊNH SHOP
                    try {
                        // Chỉ xóa bài đăng nếu mua đơn lẻ, nếu mua sỉ thì bài đăng là template, không nên xóa
                        // Tạm thời mình cứ xóa nếu nó có messageId
                        if (account.discordChannelId && account.discordMessageId) {
                            const shopChannel = client.channels.cache.get(account.discordChannelId);
                            if (shopChannel) {
                                const msgToDelete = await shopChannel.messages.fetch(account.discordMessageId).catch(() => null);
                                if (msgToDelete) {
                                    await msgToDelete.delete();
                                    console.log(`[Hệ thống] Đã gỡ bỏ ảnh sản phẩm #${account.id} khỏi kệ hàng.`);
                                }
                            }
                        }
                    } catch (err) {
                        console.error('Không thể xóa bài đăng sản phẩm:', err);
                    }

                    // 2. ĐĂNG THÔNG BÁO VÀO KÊNH LOG
                    try {
                        const logChannel = client.channels.cache.find(c => c.name === 'lich-su-giao-dich');
                        const user = await client.users.fetch(result.discordUserId);
                        
                        if (logChannel) {
                            const userNameDisplay = user ? `@${user.username}` : 'Một khách hàng';
                            
                            if (account.isManual) {
                                const logEmbed = new EmbedBuilder()
                                    .setTitle('🚨 ĐƠN HÀNG THỦ CÔNG CẦN XỬ LÝ')
                                    .setDescription(`Khách hàng **${userNameDisplay}** (<@${result.discordUserId}>) vừa thanh toán \`${transferAmount.toLocaleString()} VNĐ\` cho mã đơn hàng **${orderCode}**.\n\nSản phẩm: **Mã số #${account.id}** (${account.description || 'Không có mô tả'})`)
                                    .setColor('#E74C3C')
                                    .setTimestamp();
                                
                                const deliverBtn = new ButtonBuilder()
                                    .setCustomId(`admin_deliver_${orderCode}_${result.discordUserId}`)
                                    .setLabel(`Giao Hàng Cho Khách Này`)
                                    .setEmoji('📦')
                                    .setStyle(ButtonStyle.Primary);
                                    
                                const row = new ActionRowBuilder().addComponents(deliverBtn);
                                await logChannel.send({ content: '@everyone', embeds: [logEmbed], components: [row] });
                            } else {
                                const logEmbed = new EmbedBuilder()
                                    .setTitle('🎉 GIAO DỊCH THÀNH CÔNG')
                                    .setDescription(`Chúc mừng **${userNameDisplay}** vừa thanh toán \`${transferAmount.toLocaleString()} VNĐ\` cho mã đơn hàng **${orderCode}** để sở hữu **Mã số #${account.id}**!\nCảm ơn quý khách đã tin tưởng và ủng hộ Shop.`)
                                    .setColor('#F1C40F')
                                    .setTimestamp();
                                
                                await logChannel.send({ embeds: [logEmbed] });
                            }
                        }
                    } catch (err) {
                        console.error('Không thể gửi tin nhắn vào kênh log:', err);
                    }

                    // 3. GỬI TIN NHẮN RIÊNG (DM) CHO KHÁCH HÀNG
                    try {
                        const user = await client.users.fetch(result.discordUserId);
                        if (user) {
                            let chitietMsg = "";
                            const isGrouped = result.accounts && result.accounts.length > 1;

                            if (account.isManual) {
                                chitietMsg = `Đây là mặt hàng đặc biệt / đặt trước. Vui lòng đợi Admin chuẩn bị hàng trong 5-15 phút. Bot sẽ thông báo ngay khi có hàng!`;
                            } else if (isGrouped) {
                                chitietMsg = `Bạn đã mua thành công **${result.accounts.length}** sản phẩm:\n\n`;
                                result.accounts.forEach((acc, index) => {
                                    chitietMsg += `**Món ${index + 1}:**\n`;
                                    if (acc.username || acc.chitiet) chitietMsg += `Tài khoản/Code: ${acc.username || acc.chitiet}\n`;
                                    if (acc.password) chitietMsg += `Mật khẩu: ${acc.password}\n`;
                                    chitietMsg += `\n`;
                                });
                            } else {
                                chitietMsg = `📦 **Thông tin sản phẩm:**\n\`\`\`\nTài khoản/Code: ${account.username || account.chitiet || 'Chưa rõ'}\nMật khẩu: ${account.password || 'Chưa rõ'}\n\`\`\``;
                            }

                            const embed = new EmbedBuilder()
                                .setTitle(account.isManual ? '⏳ ĐANG XỬ LÝ ĐƠN HÀNG' : '🎉 NHẬN HÀNG THÀNH CÔNG')
                                .setDescription(`Cảm ơn bạn đã thanh toán. Đơn hàng **${orderCode}** của bạn đã được ghi nhận!\n\n${chitietMsg}`)
                                .setColor(account.isManual ? '#E67E22' : '#00FF00');
                            
                            await user.send({ embeds: [embed] });
                        }
                    } catch (err) {
                        console.error('Không thể nhắn tin DM cho người dùng Discord:', err);
                    }
                } else {
                    console.log(`[Thanh Toán] Lỗi duyệt đơn số tiền ${transferAmount}đ:`, result.message);
                }
        } catch (err) {
            console.error('Lỗi xử lý webhook:', err);
        }

        // Luôn trả về 200 OK cho SePay để nó không gửi lại liên tục
        res.status(200).send({ success: true });
    });

    app.listen(PORT, () => {
        console.log(`✅ Webhook Server đang chạy tại cổng ${PORT} - Sẵn sàng nhận thanh toán.`);
    });
}

module.exports = {
    setupPaymentWebhook
};
