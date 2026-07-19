const { 
    Client, GatewayIntentBits, ActionRowBuilder, 
    EmbedBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    PermissionsBitField, StringSelectMenuBuilder
} = require('discord.js');
const mysql = require('mysql2/promise');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const dbConfig = { host: 'localhost', user: 'root', password: '123456', database: 'bot_thanh_toan' };

const pendingOrders = new Map();
const processedTxIds = new Set();
const userCooldowns = new Map();


async function replyEphemeral(interaction, content) {
    try {
        await interaction.reply({ content: content, ephemeral: true });
        setTimeout(() => {
            interaction.deleteReply().catch(() => {});
        }, 5000);
    } catch (e) {}
}

function generateUniqueAmount(baseTotal) {
    let attempts = 0;
    while (attempts < 1000) {
        let randomSuffix = Math.floor(Math.random() * 999) + 1;
        let finalAmount = baseTotal + randomSuffix;
        if (!pendingOrders.has(finalAmount)) {
            return finalAmount;
        }
        attempts++;
    }
    throw new Error("Hệ thống nghẽn, không thể tạo mã thanh toán.");
}

function buildButtonRows(items, prefix) {
    let rows = [];
    let currentRow = new ActionRowBuilder();
    
    items.slice(0, 25).forEach((item, index) => {
        if (index > 0 && index % 5 === 0) {
            rows.push(currentRow);
            currentRow = new ActionRowBuilder();
        }
        let btnLabel = item.name.length > 80 ? item.name.substring(0, 80) : item.name;
        currentRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`${prefix}_${item.type}_${item.id}`)
                .setLabel(btnLabel)
                .setStyle(ButtonStyle.Primary)
        );
    });
    
    if (currentRow.components.length > 0) rows.push(currentRow);
    return rows;
}



// ------------------------------------------------
// HÀM XỬ LÝ GIAO DỊCH THÀNH CÔNG (DÙNG CHUNG)
// ------------------------------------------------
async function processOrder(amountReceived, txId, connection) {
    if (!pendingOrders.has(amountReceived)) return false;
    
    processedTxIds.add(txId);
    const order = pendingOrders.get(amountReceived);
    pendingOrders.delete(amountReceived); 
    userCooldowns.set(order.userId, Date.now() + 30 * 1000);

    try {
        const user = await client.users.fetch(order.userId);
        
        await connection.execute(`
            INSERT INTO bot_transactions (order_code, user_id, discord_tag, product_type, qty, amount) 
            VALUES (?, ?, ?, ?, ?, ?)
        `, [order.orderCode, user.id, user.tag, order.type, order.qty, amountReceived]);
    
        const tableName = 'list_items';
        
        let rows = [];
        if (order.specificCode) {
            const [specRows] = await connection.execute(`SELECT * FROM ${tableName} WHERE code = ? AND status = 0`, [order.specificCode]);
            rows = specRows;
        } else if (order.repCode) {
            const [repRows] = await connection.execute(`SELECT image, description, price FROM ${tableName} WHERE code = ? LIMIT 1`, [order.repCode]);
            const rep = repRows[0] || { image: '', description: '', price: 0 };
            const [batchRows] = await connection.execute(`SELECT * FROM ${tableName} WHERE group_id = ? AND status = 0 AND image = ? AND description = ? AND price = ? LIMIT ?`, [order.groupId, rep.image || '', rep.description || '', rep.price, order.qty]);
            rows = batchRows;
        } else {
            const [randRows] = await connection.execute(`SELECT * FROM ${tableName} WHERE group_id = ? AND status = 0 ORDER BY RAND() LIMIT ?`, [order.groupId, order.qty]);
            rows = randRows;
        }
        
        if (rows.length < order.qty) {
            if (user) await user.send(`⚠️ **LỖI KHO HÀNG (Mã Đơn: ${order.orderCode})**\nBạn đã thanh toán thành công **${amountReceived.toLocaleString('vi-VN')} VNĐ**, nhưng kho hàng vừa hết sản phẩm. Vui lòng gửi Mã Đơn cho Admin để nhận Hoàn Tiền!`);
            throw new Error("Hết hàng trong lúc thanh toán");
        }
        
        const codes = rows.map(r => r.code);
        const placeholders = codes.map(() => '?').join(',');
        
        await connection.query(
            `UPDATE ${tableName} SET status = 1, buyer_name = ?, buyer_code = ?, updated_at = NOW() WHERE code IN (${placeholders})`,
            [user.tag, order.orderCode, ...codes]
        );
        
        const dmEmbed = new EmbedBuilder()
            .setAuthor({ name: '🎉 GIAO DỊCH THÀNH CÔNG', iconURL: 'https://cdn-icons-png.flaticon.com/512/190/190411.png' })
            .setTitle(`Mã Hóa Đơn: ${order.orderCode}`)
            .setColor('#00FF00')
            .setDescription(`💰 Số tiền thanh toán: **${amountReceived.toLocaleString('vi-VN')} VNĐ**\n📦 Số lượng: **${order.qty}**\n\n👇 **Hệ thống đang xuất kho và gửi từng sản phẩm cho bạn bên dưới...**`)
            .setFooter({ text: 'Hệ thống Cửa Hàng Tự Động' })
            .setTimestamp();
            
        if (user) await user.send({ embeds: [dmEmbed] });
        
        if (order.type.startsWith('account')) {
            for (let i = 0; i < rows.length; i++) {
                const product = rows[i];
                const emailStr = product.extra_data ? `\n> 📧 Email Gắn Kèm: \`${product.extra_data}\`` : '';
                const accEmbed = new EmbedBuilder()
                    .setColor('#2B2D31')
                    .setDescription(`**📦 Sản phẩm #${i + 1} / ${order.qty}** (Mã: ${product.code})\n> 👤 Tài khoản: \`${product.username}\`\n> 🔑 Mật khẩu: \`${product.password}\`${emailStr}`);
                
                if (user) await user.send({ embeds: [accEmbed] });
                if ((i + 1) % 5 === 0) await new Promise(r => setTimeout(r, 1000)); // Delay tránh spam Discord Rate Limit
            }
            if (user) await user.send(`⚠️ *Quá trình giao hàng hoàn tất. Quý khách vui lòng lưu thông tin và đổi mật khẩu ngay lập tức để bảo vệ tài khoản!*`);
        } else {
            for (let i = 0; i < rows.length; i++) {
                const product = rows[i];
                if (user) await user.send(`**📦 Mã Code #${i + 1} / ${order.qty}** (Mã Đơn: \`${product.code}\`)\n\`\`\`\n${product.password}\n\`\`\``);
                if ((i + 1) % 5 === 0) await new Promise(r => setTimeout(r, 1000));
            }
        }
        console.log(`[Thành Công] Mã: ${order.orderCode} | Khách: ${user.tag} | Tiền: ${amountReceived}`);
        
        // GỬI THÔNG BÁO THÀNH CÔNG LÊN TIN NHẮN ẨN
        if (order.interaction) {
            try {
                const successEmbed = new EmbedBuilder()
                    .setAuthor({ name: '🎉 GIAO DỊCH THÀNH CÔNG', iconURL: 'https://cdn-icons-png.flaticon.com/512/190/190411.png' })
                    .setDescription(`Cảm ơn <@${user.id}> đã mua sắm!\n\n> 📦 Sản phẩm đã được gửi vào **Tin Nhắn Riêng (DM)** của bạn.\n> *(Vui lòng kiểm tra cả mục Tin nhắn chờ nếu không thấy).*`)
                    .setColor('#00FF00');
                
                const continueRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`back_shop_menu`).setLabel('🛒 Tiếp Tục Mua Sắm').setStyle(ButtonStyle.Primary)
                );
                    
                await order.interaction.editReply({ content: '✅ **GIAO DỊCH HOÀN TẤT**', embeds: [successEmbed], components: [continueRow] });
            } catch(e) {
                console.error("Không thể edit interaction:", e);
            }
        }
        
        const logChannelId = process.env.CH_LOG_ACCOUNT || process.env.CH_SYSTEM_LOG;
        if (logChannelId) {
            try {
                const logChannel = await client.channels.fetch(logChannelId);
                if (logChannel) {
                    const logEmbed = new EmbedBuilder()
                        .setAuthor({ name: '🎉 ĐƠN HÀNG MỚI', iconURL: 'https://cdn-icons-png.flaticon.com/512/190/190411.png' })
                        .addFields(
                            { name: '🔖 Mã Đơn', value: `**${order.orderCode}**`, inline: true },
                            { name: '📦 Gói Sản Phẩm', value: `**${order.type.toUpperCase()}**`, inline: true },
                            { name: '🔢 Số Lượng', value: `**${order.qty}**`, inline: true },
                            { name: '💰 Thanh Toán', value: `**${amountReceived.toLocaleString('vi-VN')} VNĐ**`, inline: false },
                            { name: '👤 Khách Mua', value: `\`${user.tag}\``, inline: false }
                        )
                        .setColor('#FFD700')
                        .setTimestamp();
                    await logChannel.send({ embeds: [logEmbed] });
                }
            } catch (logErr) {}
        }


        return true;
    } catch (dbErr) {
        console.error("[Database Error in processOrder]:", dbErr);
        return false;
    }
}


client.once('ready', () => {
    console.log(`✅ [Shop Bot V12] Live Dashboard & FakeBill Đã Kích Hoạt: ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.toLowerCase() === '!setup_shop') {
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
        
        await message.channel.send({ embeds: [embed], components: [row] });
        try { await message.delete(); } catch(e){}
    }
    

    
    // Lệnh Fake Bill Test
    else if (message.content.toLowerCase().startsWith('!fakebill')) {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return message.reply('❌ Bạn không có quyền chạy lệnh test này.');
        }
        
        const args = message.content.split(' ');
        if (args.length < 2) return message.reply('❌ Sử dụng: `!fakebill <số tiền>`');
        
        let rawAmount = args[1].replace(/[,.]/g, ''); // Xóa dấu chấm hoặc phẩy
        const fakeAmount = Number(rawAmount);
        if (isNaN(fakeAmount)) return message.reply('❌ Số tiền không hợp lệ.');
        
        const connection = await mysql.createConnection(dbConfig);
        const txId = 'FAKE-' + Date.now();
        
        await message.reply(`🔄 Đang giả lập nạp số tiền **${fakeAmount.toLocaleString('vi-VN')} VNĐ**...`);
        
        const success = await processOrder(fakeAmount, txId, connection);
        if (success) {
            await message.channel.send(`✅ Giả lập hóa đơn thành công! Đã giao hàng và cập nhật Dashboard.`);
        } else {
            await message.channel.send(`❌ Không tìm thấy đơn hàng nào đang đợi thanh toán số tiền **${fakeAmount}**. (Quét mã QR để sinh số tiền lẻ nhé!)`);
        }
        
        await connection.end();
    }
});

client.on('interactionCreate', async interaction => {
    const connection = await mysql.createConnection(dbConfig);
    
    try {
        if (interaction.isButton() && (interaction.customId === 'open_shop_menu' || interaction.customId === 'back_shop_menu')) {
            const categories = [
                { id: 'acc_pc', name: '🎮 ACCOUNT PC', type: 'custom' },
                { id: 'gcoin', name: '💎 CODE GCOIN', type: 'custom' },
                { id: 'steam', name: '💳 CODE STEAM WALLET', type: 'custom' },
                { id: 'outfit', name: '👕 CODE TRANG PHỤC', type: 'custom' }
            ];

            const rows = buildButtonRows(categories, 'catbtn');
            
            if (interaction.customId === 'open_shop_menu') {
                await interaction.reply({ content: '🚀 **MỜI BẠN CHỌN DANH MỤC CẦN MUA:**', embeds: [], components: rows, flags: 64 });
            } else {
                await interaction.update({ content: '🚀 **MỜI BẠN CHỌN DANH MỤC CẦN MUA:**', embeds: [], components: rows });
            }
        }
        
        else if (interaction.isButton() && interaction.customId.startsWith('catbtn_')) {
            const parts = interaction.customId.split('_');
            const type = parts[1];
            const catId = parts[2];

            // Xử lý tạm thời cho 4 Menu Hardcode chưa có Data
            if (type === 'custom') {
                await connection.end();
                const backRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('back_shop_menu')
                        .setLabel('⬅️ Trở Về')
                        .setStyle(ButtonStyle.Secondary)
                );
                
                const customCatId = parts.slice(2).join('_');
                
                let groupsData = {};
                if (fs.existsSync('groups.json')) {
                    groupsData = JSON.parse(fs.readFileSync('groups.json', 'utf8'));
                }
                
                const subGroups = groupsData[customCatId] || [];
                
                if (subGroups.length === 0) {
                    return interaction.update({ content: `🛠️ **Mục này đang được Admin thiết lập Data. Vui lòng quay lại sau!**`, embeds: [], components: [backRow] });
                }
                
                const rows = buildButtonRows(subGroups, 'grpbtn');
                rows.push(backRow);
                
                let title = 'MỜI BẠN CHỌN LOẠI SẢN PHẨM CẦN MUA:';
                if (customCatId === 'acc_pc') title = '🎮 MỜI BẠN CHỌN LOẠI ACCOUNT PC CẦN MUA:';
                if (customCatId === 'gcoin') title = '💎 MỜI BẠN CHỌN MỆNH GIÁ GCOIN:';
                if (customCatId === 'steam') title = '💳 MỜI BẠN CHỌN MỆNH GIÁ STEAM WALLET:';
                if (customCatId === 'outfit') title = '👕 MỜI BẠN CHỌN SET TRANG PHỤC:';
                
                return interaction.update({ content: `**${title}**`, embeds: [], components: rows });
            }
            
            let query = '';
            if (type === 'account') query = 'SELECT id, name, slug, "account" AS type FROM groups WHERE category_id = ?';
            else if (type === 'account_v2') query = 'SELECT id, name, slug, "account_v2" AS type FROM group_v2_s WHERE category_id = ?';
            else if (type === 'item') query = 'SELECT id, name, slug, "item" AS type FROM item_groups WHERE category_id = ?';
            
            const [groups] = await connection.execute(query, [catId]);
            if (groups.length === 0) return interaction.update({ content: '⚠️ Hệ thống tạm hết hàng mục này.', components: [], embeds: [] });

            const rows = buildButtonRows(groups, 'grpbtn');
            const backRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`back_shop_menu`).setLabel('↩️ Quay lại').setStyle(ButtonStyle.Secondary)
            );
            rows.push(backRow);

            await interaction.update({ content: '🎮 **MỜI BẠN CHỌN GÓI SẢN PHẨM:**', embeds: [], components: rows });
        }
        
        else if (interaction.isButton() && (interaction.customId.startsWith('grpbtn_') || interaction.customId.startsWith('pagebtn_'))) {
            const parts = interaction.customId.split('_');
            const type = parts[1];
            const groupId = parts[2];
            const page = interaction.customId.startsWith('pagebtn_') ? parseInt(parts[3]) : 1;
            const tableName = 'list_items';
            
            // Xử lý hiển thị Bán Lô (Batch) cho tất cả ngoại trừ Acc Treo Bán (ID: 103)
            const isBatch = type === 'item' || (type.startsWith('account') && groupId !== '103');
            
            if (isBatch) {
                const itemsPerPage = 1;
                const offset = (page - 1) * itemsPerPage;
                const [batchAll] = await connection.execute(`
                    SELECT image, description, price, list_image, COUNT(*) as stock, MAX(code) as rep_code 
                    FROM ${tableName} 
                    WHERE group_id = ? AND status = 0 
                    GROUP BY image, description, price, list_image
                `, [groupId]);
                
                const totalBatches = batchAll.length;
                if (totalBatches === 0) {
                    return interaction.update({ content: '⚠️ Gói này hiện đang hết hàng. Vui lòng quay lại sau!', components: [], embeds: [] });
                }
                
                const totalPages = Math.ceil(totalBatches / itemsPerPage);
                const currentBatches = batchAll.slice(offset, offset + itemsPerPage);
                
                const embeds = [];
                const buttonsRow1 = new ActionRowBuilder();
                
                currentBatches.forEach((batch, idx) => {
                    const num = idx + 1 + offset;
                    const basePrice = Number(batch.price);
                    let imageUrl = batch.image;
                    if (batch.list_image) {
                        try {
                            const images = JSON.parse(batch.list_image);
                            if (Array.isArray(images) && images.length > 0) imageUrl = images[0];
                        } catch(e){}
                    }
                    
                    let displayDesc = batch.description || 'Không có mô tả';
                    if (displayDesc !== 'Không có mô tả') {
                        let parts = [];
                        if (displayDesc.includes('\n')) parts = displayDesc.split('\n');
                        else if (displayDesc.includes('\\n')) parts = displayDesc.split('\\n');
                        else if (displayDesc.includes(',')) parts = displayDesc.split(',');
                        else parts = [displayDesc];
                        displayDesc = '\n> 🔹 ' + parts.map(s => s.trim()).filter(s => s).join('\n> 🔹 ');
                    }
                    
                    const embed = new EmbedBuilder()
                        .setAuthor({ name: `🛍️ THÔNG TIN LÔ HÀNG #${num}`, iconURL: 'https://cdn-icons-png.flaticon.com/512/3592/3592882.png' })
                        .setDescription(`**Mô tả:** ${displayDesc}\n\nBấm nút **[Tạo Đơn Hàng]** bên dưới để nhập số lượng cần mua lô này.`)
                        .addFields(
                            { name: '📦 Kho Hàng', value: `**${batch.stock}** sản phẩm`, inline: true },
                            { name: '💰 Đơn Giá', value: `**${basePrice.toLocaleString('vi-VN')} VNĐ**`, inline: true }
                        )
                        .setColor('#FFD700');
                        
                    if (imageUrl && imageUrl.startsWith('http')) {
                        embed.setImage(imageUrl);
                    }
                    embeds.push(embed);
                    
                    const btn = new ButtonBuilder()
                        .setCustomId(`buygroup_${type}_${groupId}_${batch.rep_code}`)
                        .setLabel(`🛒 Tạo Đơn Hàng (Lô #${num})`)
                        .setStyle(ButtonStyle.Success);
                    buttonsRow1.addComponents(btn);
                });
                
                const navRow = new ActionRowBuilder();
                if (page > 1) {
                    navRow.addComponents(new ButtonBuilder().setCustomId(`pagebtn_${type}_${groupId}_${page - 1}`).setLabel('⬅️ Trang Trước').setStyle(ButtonStyle.Primary));
                }
                if (page < totalPages) {
                    navRow.addComponents(new ButtonBuilder().setCustomId(`pagebtn_${type}_${groupId}_${page + 1}`).setLabel('Trang Sau ➡️').setStyle(ButtonStyle.Primary));
                }
                navRow.addComponents(new ButtonBuilder().setCustomId('back_shop_menu').setLabel('↩️ Trở Về Menu').setStyle(ButtonStyle.Secondary));
                
                return interaction.update({ content: `🛒 **ĐANG CÓ SẴN ${totalBatches} LÔ HÀNG KHÁC NHAU!** (Trang ${page}/${totalPages})`, embeds: embeds, components: [buttonsRow1, navRow] });
            }
            
            // Dành cho type account (chọn đích danh bằng Pagination 3 ảnh)
            const itemsPerPage = 3;
            const offset = (page - 1) * itemsPerPage;
            
            const [countRows] = await connection.execute(`SELECT COUNT(*) as total FROM ${tableName} WHERE group_id = ? AND status = 0`, [groupId]);
            const totalStock = countRows[0].total;
            
            if (totalStock === 0) {
                return interaction.update({ content: '⚠️ Gói này hiện đang hết hàng. Vui lòng quay lại sau!', components: [], embeds: [] });
            }
            
            const totalPages = Math.ceil(totalStock / itemsPerPage);
            
            const [items] = await connection.execute(`SELECT code, price, description, image FROM ${tableName} WHERE group_id = ? AND status = 0 ORDER BY id DESC LIMIT ? OFFSET ?`, [groupId, itemsPerPage, offset]);
            
            if (items.length === 0) {
                return interaction.update({ content: '⚠️ Không có dữ liệu ở trang này!', components: [], embeds: [] });
            }
            
            const embeds = [];
            const buttonsRow1 = new ActionRowBuilder();
            const buttonsRow2 = new ActionRowBuilder();
            
            items.forEach((item, idx) => {
                const num = idx + 1 + offset;
                let displayDesc = item.description || 'Không có mô tả';
                if (displayDesc !== 'Không có mô tả') {
                    let parts = [];
                    if (displayDesc.includes('\n')) parts = displayDesc.split('\n');
                    else if (displayDesc.includes('\\n')) parts = displayDesc.split('\\n');
                    else if (displayDesc.includes(',')) parts = displayDesc.split(',');
                    else parts = [displayDesc];
                    displayDesc = '\n> 🔹 ' + parts.map(s => s.trim()).filter(s => s).join('\n> 🔹 ');
                }
                
                const itemEmbed = new EmbedBuilder()
                    .setTitle(`Sản phẩm #${num} - MÃ SỐ: ${item.code}`)
                    .setDescription(`**Mô tả:** ${displayDesc}\n\n**Giá bán:** ${Number(item.price).toLocaleString('vi-VN')} VNĐ`)
                    .setColor('#FFD700');
                    
                if (item.image && item.image.startsWith('http')) {
                    itemEmbed.setImage(item.image);
                }
                embeds.push(itemEmbed);
                
                const btn = new ButtonBuilder()
                    .setCustomId(`buyitem_${type}_${groupId}_${item.code}`)
                    .setLabel(`🛒 Mua Số ${num}`)
                    .setStyle(ButtonStyle.Success);
                    
                if (idx < 5) buttonsRow1.addComponents(btn);
                else buttonsRow2.addComponents(btn);
            });
            
            const navRow = new ActionRowBuilder();
            if (page > 1) {
                navRow.addComponents(new ButtonBuilder().setCustomId(`pagebtn_${type}_${groupId}_${page - 1}`).setLabel('⬅️ Trang Trước').setStyle(ButtonStyle.Primary));
            }
            if (page < totalPages) {
                navRow.addComponents(new ButtonBuilder().setCustomId(`pagebtn_${type}_${groupId}_${page + 1}`).setLabel('Trang Sau ➡️').setStyle(ButtonStyle.Primary));
            }
            navRow.addComponents(new ButtonBuilder().setCustomId('back_shop_menu').setLabel('↩️ Trở Về Menu').setStyle(ButtonStyle.Secondary));
            
            const components = [];
            if (buttonsRow1.components.length > 0) components.push(buttonsRow1);
            if (buttonsRow2.components.length > 0) components.push(buttonsRow2);
            components.push(navRow);
            
            await interaction.update({ 
                content: `🛒 **ĐANG CÓ ${totalStock} SẢN PHẨM TRONG KHO!** (Trang ${page}/${totalPages})\n> Dưới đây là danh sách sản phẩm. Hãy bấm nút Mua tương ứng với số thứ tự của sản phẩm bạn ưng ý!`, 
                embeds: embeds, 
                components: components 
            });
        }
        
        else if (interaction.isButton() && interaction.customId.startsWith('buyitem_')) {
            const userId = interaction.user.id;
            if (userCooldowns.has(userId) && Date.now() < userCooldowns.get(userId)) {
                const remaining = Math.ceil((userCooldowns.get(userId) - Date.now()) / 60000);
                return replyEphemeral(interaction, `⏳ **CHỜ ĐÃ!** Bạn vừa tạo 1 đơn hàng gần đây. Vui lòng thử lại sau **${remaining} phút** nữa nhé!`);
            }
            const parts = interaction.customId.split('_');
            const type = parts[1];
            const groupId = parts[2];
            const selectedCode = parts.slice(3).join('_');
            
            const tableName = 'list_items';
            const [itemRows] = await connection.execute(`SELECT * FROM ${tableName} WHERE code = ? AND status = 0`, [selectedCode]);
            
            if (itemRows.length === 0) {
                return replyEphemeral(interaction, '❌ Sản phẩm này đã bị mua hoặc không còn tồn tại.');
            }
            
            const basePrice = Number(itemRows[0].price);
            const qty = 1;
            const finalAmount = generateUniqueAmount(basePrice); 
            const orderCode = 'KZ-' + Math.random().toString(36).substring(2, 9).toUpperCase().padEnd(7, '0').substring(0, 7);
            
            pendingOrders.set(finalAmount, { 
                userId: interaction.user.id, 
                channelId: interaction.message.channel.id,
                messageId: interaction.message.id,
                interaction: interaction,
                type, groupId, qty, basePrice, finalAmount, orderCode, createdAt: Date.now(),
                specificCode: selectedCode // Đánh dấu đơn hàng này mua đích danh 1 mã
            });
            
            userCooldowns.set(userId, Date.now() + 5 * 60 * 1000);
            
            const bankId = process.env.BANK_ID || '970422';
            const bankAcc = process.env.BANK_ACCOUNT || '123456789';
            const bankName = process.env.BANK_NAME ? encodeURIComponent(process.env.BANK_NAME) : '';
            const qrUrl = `https://img.vietqr.io/image/${bankId}-${bankAcc}-compact2.png?amount=${finalAmount}&accountName=${bankName}`;

            const paymentEmbed = new EmbedBuilder()
                .setAuthor({ name: '💳 HÓA ĐƠN THANH TOÁN', iconURL: 'https://cdn-icons-png.flaticon.com/512/2830/2830284.png' })
                .setDescription(`Bạn đang mua sản phẩm: **Mã ${selectedCode}**\n\nVui lòng mở App Ngân Hàng và **Quét Mã QR** bên dưới để thanh toán.\n*(Nếu QR bị lỗi không hiện, hãy bấm vào nút [Mở ảnh QR Code](${qrUrl}) để quét)*\n\n⚠️ **CHÚ Ý QUAN TRỌNG:**\nBắt buộc phải chuyển **ĐÚNG SỐ TIỀN LẺ** ở bên dưới để hệ thống nhận diện đơn hàng của bạn. (Không cần ghi nội dung chuyển khoản)`)
                .addFields(
                    { name: '🔖 Mã Đơn Hàng', value: `**${orderCode}**`, inline: false },
                    { name: '🏦 Ngân Hàng', value: `**${process.env.BANK_NAME || 'MB Bank'}**`, inline: true },
                    { name: '💳 Số Tài Khoản', value: `**${bankAcc}**`, inline: true },
                    { name: '💵 TỔNG TIỀN (BẮT BUỘC)', value: `**${finalAmount.toLocaleString('vi-VN')} VNĐ**`, inline: false }
                )
                .setColor('#FF007F')
                .setImage(qrUrl)
                .setThumbnail('https://cdn-icons-png.flaticon.com/512/714/714390.png')
                .setFooter({ text: '⏳ Hóa đơn này sẽ tự hủy nếu không thanh toán trong 5 phút' })
                .setTimestamp();
                
            const cancelRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`cancel_order_${finalAmount}`).setLabel('❌ HỦY ĐƠN HÀNG').setStyle(ButtonStyle.Danger)
            );

            await interaction.update({ content: null, embeds: [paymentEmbed], components: [cancelRow] });
        }
        
        else if (interaction.isButton() && interaction.customId.startsWith('buygroup_')) {
            const userId = interaction.user.id;
            if (userCooldowns.has(userId) && Date.now() < userCooldowns.get(userId)) {
                const remaining = Math.ceil((userCooldowns.get(userId) - Date.now()) / 60000);
                return replyEphemeral(interaction, `⏳ **CHỜ ĐÃ!** Bạn vừa tạo 1 đơn hàng gần đây. Vui lòng thử lại sau **${remaining} phút** nữa nhé!`);
            }
            const parts = interaction.customId.split('_');
            const type = parts[1];
            const groupId = parts[2];
            const repCode = parts.slice(3).join('_');
            
            const modal = new ModalBuilder()
                .setCustomId(`modal_qty_${type}_${groupId}_${repCode}`)
                .setTitle(`🛍️ Số lượng cần mua`);

            const qtyInput = new TextInputBuilder()
                .setCustomId('qty_input')
                .setLabel('Vui lòng nhập số lượng:')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('Nhập số lượng (Ví dụ: 1)')
                .setRequired(true)
                .setValue('1');

            modal.addComponents(new ActionRowBuilder().addComponents(qtyInput));
            await interaction.showModal(modal);
        }
        
        else if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_qty_')) {
            const userId = interaction.user.id;
            if (userCooldowns.has(userId) && Date.now() < userCooldowns.get(userId)) {
                const remaining = Math.ceil((userCooldowns.get(userId) - Date.now()) / 60000);
                return replyEphemeral(interaction, `⏳ **CHỜ ĐÃ!** Bạn vừa tạo 1 đơn hàng gần đây. Vui lòng thử lại sau **${remaining} phút** nữa nhé!`);
            }
            const parts = interaction.customId.split('_');
            const type = parts[2];
            const groupId = parts[3];
            const repCode = parts.slice(4).join('_');
            const qtyStr = interaction.fields.getTextInputValue('qty_input');
            const qty = parseInt(qtyStr);
            
            if (isNaN(qty) || qty <= 0) return replyEphemeral(interaction, '❌ Số lượng không hợp lệ.');
            
            const tableName = 'list_items';
            const [repRows] = await connection.execute(`SELECT image, description, price FROM ${tableName} WHERE code = ? LIMIT 1`, [repCode]);
            if (repRows.length === 0) return replyEphemeral(interaction, '❌ Lô hàng này không còn tồn tại.');
            const rep = repRows[0];
            
            const [countRows] = await connection.execute(`
                SELECT COUNT(*) as total FROM ${tableName} 
                WHERE group_id = ? AND status = 0 AND image = ? AND description = ? AND price = ?
            `, [groupId, rep.image || '', rep.description || '', rep.price]);
            
            const totalStock = countRows[0].total;
            
            if (qty > totalStock) {
                return replyEphemeral(interaction, `❌ Lô hàng này chỉ còn **${totalStock}** sản phẩm.`);
            }
            
            const basePrice = Number(rep.price);
            const total = basePrice * qty;
            const finalAmount = generateUniqueAmount(total); 
            const orderCode = 'KZ-' + Math.random().toString(36).substring(2, 9).toUpperCase().padEnd(7, '0').substring(0, 7);
            
            pendingOrders.set(finalAmount, { 
                userId: interaction.user.id, 
                channelId: interaction.message.channel.id,
                messageId: interaction.message.id,
                interaction: interaction,
                type, groupId, qty, basePrice, finalAmount, orderCode, createdAt: Date.now(),
                repCode: repCode 
            });
            
            userCooldowns.set(userId, Date.now() + 5 * 60 * 1000);
            
            const bankId = process.env.BANK_ID || '970422';
            const bankAcc = process.env.BANK_ACCOUNT || '123456789';
            const bankName = process.env.BANK_NAME ? encodeURIComponent(process.env.BANK_NAME) : '';
            const qrUrl = `https://img.vietqr.io/image/${bankId}-${bankAcc}-compact2.png?amount=${finalAmount}&accountName=${bankName}`;

            const paymentEmbed = new EmbedBuilder()
                .setAuthor({ name: '💳 HÓA ĐƠN THANH TOÁN TỰ ĐỘNG', iconURL: 'https://cdn-icons-png.flaticon.com/512/2830/2830284.png' })
                .setDescription(`Vui lòng mở App Ngân Hàng và **Quét Mã QR** bên dưới để thanh toán.\n*(Nếu QR bị lỗi không hiện, hãy bấm vào nút [Mở ảnh QR Code](${qrUrl}) để quét)*\n\n⚠️ **CHÚ Ý QUAN TRỌNG:**\nBắt buộc phải chuyển **ĐÚNG SỐ TIỀN LẺ** ở bên dưới để hệ thống nhận diện đơn hàng của bạn. (Không cần ghi nội dung chuyển khoản)`)
                .addFields(
                    { name: '🔖 Mã Đơn Hàng', value: `**${orderCode}**`, inline: false },
                    { name: '🏦 Ngân Hàng', value: `**${process.env.BANK_NAME || 'MB Bank'}**`, inline: true },
                    { name: '💳 Số Tài Khoản', value: `**${bankAcc}**`, inline: true },
                    { name: '💵 TỔNG TIỀN (BẮT BUỘC)', value: `**${finalAmount.toLocaleString('vi-VN')} VNĐ**`, inline: false }
                )
                .setColor('#FF007F')
                .setImage(qrUrl)
                .setThumbnail('https://cdn-icons-png.flaticon.com/512/714/714390.png')
                .setFooter({ text: '⏳ Hóa đơn này sẽ tự hủy nếu không thanh toán trong 5 phút' })
                .setTimestamp();
                
            const cancelRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`cancel_order_${finalAmount}`).setLabel('❌ HỦY ĐƠN HÀNG').setStyle(ButtonStyle.Danger)
            );

            await interaction.update({ content: null, embeds: [paymentEmbed], components: [cancelRow] });
        }
        
        else if (interaction.isButton() && interaction.customId.startsWith('cancel_order_')) {
            const finalAmount = parseInt(interaction.customId.split('_')[2]);
            
            if (!pendingOrders.has(finalAmount)) {
                return replyEphemeral(interaction, '❌ Đơn hàng này không tồn tại, đã hết hạn hoặc đã được thanh toán.');
            }
            
            const order = pendingOrders.get(finalAmount);
            if (order.userId !== interaction.user.id) {
                return replyEphemeral(interaction, '❌ Bạn không có quyền hủy đơn hàng của người khác.');
            }
            
            pendingOrders.delete(finalAmount);
            userCooldowns.delete(order.userId);
            
            const categories = [
                { id: 'acc_pc', name: '🎮 ACCOUNT PC', type: 'custom' },
                { id: 'gcoin', name: '💎 CODE GCOIN', type: 'custom' },
                { id: 'steam', name: '💳 CODE STEAM WALLET', type: 'custom' },
                { id: 'outfit', name: '👕 CODE TRANG PHỤC', type: 'custom' }
            ];

            const rows = buildButtonRows(categories, 'catbtn');
            
            await interaction.update({ 
                content: '❌ **ĐƠN HÀNG CỦA BẠN ĐÃ BỊ HỦY!**\n> Thời gian chờ đã được xóa bỏ.\n\n🚀 **MỜI BẠN CHỌN DANH MỤC ĐỂ TIẾP TỤC MUA SẮM:**', 
                embeds: [], 
                components: rows 
            });
        }
        
    } catch (error) {
        console.error(error);
        if (!interaction.replied) {
            await replyEphemeral(interaction, '❌ Lỗi hệ thống.');
        }
    } finally {
        if(connection) await connection.end();
    }
});

// ============================================
// TRẠM QUÉT GIAO DỊCH WEB2M (SỐ LẺ)
// ============================================
setInterval(async () => {
    const API_KEY = process.env.WEB2M_API_KEY;
    const API_URL = process.env.WEB2M_API_URL;
    
    if (!API_KEY || !API_URL || pendingOrders.size === 0) return; 

    try {
        const response = await axios.get(`${API_URL}/${API_KEY}`);
        const transactions = response.data.transactions || response.data.data || response.data;
        if (!Array.isArray(transactions)) return;

        const connection = await mysql.createConnection(dbConfig);
        try {
            for (const tx of transactions) {
                const txId = String(tx.id || tx.transactionID || tx.refNo || tx.tid);
                if (!txId || processedTxIds.has(txId)) continue; 
                
                const amountReceived = Number(tx.creditAmount || tx.amount || 0);
                if (pendingOrders.has(amountReceived)) {
                    await processOrder(amountReceived, txId, connection);
                }
            }
        } finally {
            await connection.end();
        }
        
        const now = Date.now();
        for (const [amountKey, order] of pendingOrders.entries()) {
            if (now - order.createdAt > 5 * 60 * 1000) {
                pendingOrders.delete(amountKey);
            }
        }
        
        if (processedTxIds.size > 500) {
            const arr = Array.from(processedTxIds);
            const toKeep = new Set(arr.slice(arr.length - 100)); 
            processedTxIds.clear();
            toKeep.forEach(id => processedTxIds.add(id));
        }
        
    } catch (apiError) {
        console.error('[Web2M Fetch Error]:', apiError.message);
    }
}, 30000); 

const token = process.env.DISCORD_TOKEN || require('./config').DISCORD_TOKEN;
client.login(token).catch(err => console.error('❌ Lỗi đăng nhập Bot Discord:', err));
