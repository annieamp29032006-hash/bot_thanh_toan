const { 
    SlashCommandBuilder, 
    ActionRowBuilder, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionsBitField,
    ChannelType
} = require('discord.js');
const db = require('../utils/database');

const setupCheckoutCommand = new SlashCommandBuilder()
    .setName('setup_checkout')
    .setDescription('Tạo Cổng Thanh Toán Nhanh qua Mã Số (Chỉ Admin)')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);

const autoPostProductsCommand = new SlashCommandBuilder()
    .setName('auto_post_products')
    .setDescription('Tự động tạo kênh và đăng toàn bộ sản phẩm lên để khách xem (Chỉ Admin)')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);

const testPayCommand = new SlashCommandBuilder()
    .setName('test_pay')
    .setDescription('Test giả lập khách thanh toán thành công (Chỉ Admin)')
    .addStringOption(option => 
        option.setName('order_code')
            .setDescription('Mã đơn hàng hiển thị trong QR (VD: DH1234)')
            .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);

const addProductCommand = new SlashCommandBuilder()
    .setName('them_san_pham')
    .setDescription('Tự động thêm sản phẩm mới và đăng bài lên kênh (Chỉ Admin)')
    .addStringOption(option => option.setName('nhom').setDescription('ID nhóm hàng (1: Vé, 2: Acc VIP, 3: Gcoin...)').setRequired(true))
    .addIntegerOption(option => option.setName('gia_tien').setDescription('Giá tiền (VNĐ)').setRequired(true))
    .addStringOption(option => option.setName('mo_ta').setDescription('Mô tả hiển thị cho khách').setRequired(true))
    .addAttachmentOption(option => option.setName('hinh_anh').setDescription('Ảnh minh họa').setRequired(true))
    .addStringOption(option => 
        option.setName('loai_hang')
            .setDescription('Cách thức giao hàng')
            .setRequired(true)
            .addChoices(
                { name: 'Giao Tự Động (Có sẵn code)', value: 'auto' },
                { name: 'Giao Thủ Công (Đợi Admin)', value: 'manual' }
            )
    )
    .addStringOption(option => option.setName('tai_khoan').setDescription('Tên đăng nhập hoặc Mã Code (Bỏ qua nếu Giao Thủ Công)').setRequired(false))
    .addStringOption(option => option.setName('mat_khau').setDescription('Mật khẩu (Bỏ trống nếu là Code)').setRequired(false))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);

// ---------------------------------------------------------
// 1. LỆNH /SETUP_CHECKOUT (Cổng Thanh Toán Nhanh)
// ---------------------------------------------------------
async function handleSetupCheckout(interaction) {
    const embed = new EmbedBuilder()
        .setTitle(`🛒 CỔNG THANH TOÁN NHANH`)
        .setDescription(`Hệ thống thanh toán hỏa tốc dành cho khách hàng đã biết trước mã sản phẩm.\n\n` +
            `🔹 **Bước 1:** Bấm nút bên dưới.\n` +
            `🔹 **Bước 2:** Nhập Mã Số Sản Phẩm (ID).\n` +
            `🔹 **Bước 3:** Quét mã QR thanh toán và nhận tài khoản ngay lập tức qua Tin nhắn riêng.`)
        .setImage('https://i.imgur.com/8Q5Z2zB.png')
        .setColor('#E67E22');

    const button = new ButtonBuilder()
        .setCustomId(`btn_open_checkout`)
        .setLabel(`Nhập Mã Số Sản Phẩm (Fast Checkout)`)
        .setEmoji('⚡')
        .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(button);
    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: '✅ Đã thiết lập Cổng Thanh Toán Nhanh thành công!', ephemeral: true });
}

// ---------------------------------------------------------
// 2. LỆNH /AUTO_POST_PRODUCTS (Đăng sản phẩm ra các kênh)
// ---------------------------------------------------------
async function handleAutoPostProducts(interaction) {
    await interaction.deferReply({ ephemeral: true });
    
    const categories = await db.getCategories();
    if (!categories || categories.length === 0) {
        return interaction.editReply({ content: '❌ Database không có danh mục nào!' });
    }

    const guild = interaction.guild;
    let createdCount = 0;
    let postedCount = 0;

    // Tạo kênh Log Lịch sử Giao Dịch nếu chưa có
    const logChannelName = 'lich-su-giao-dich';
    let logChannel = guild.channels.cache.find(c => c.name === logChannelName);
    if (!logChannel) {
        try {
            await guild.channels.create({
                name: logChannelName,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        deny: [PermissionsBitField.Flags.SendMessages],
                    }
                ],
                reason: 'Auto setup log channel'
            });
            createdCount++;
        } catch (e) {
            console.error('Không thể tạo kênh log:', e);
        }
    }

    for (const cat of categories) {
        try {
            const channelName = cat.name.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');
            
            // Tìm hoặc tạo kênh mới
            let channel = guild.channels.cache.find(c => c.name === channelName);
            if (!channel) {
                channel = await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    reason: 'Auto post products categories'
                });
                createdCount++;
            }

            // Gửi tiêu đề Gian hàng
            const titleEmbed = new EmbedBuilder()
                .setTitle(`🔥 GIAN HÀNG: ${cat.name.toUpperCase()} 🔥`)
                .setDescription(`Tất cả sản phẩm thuộc danh mục **${cat.name}** đang được bày bán tại đây.\nBạn ưng ý sản phẩm nào, chỉ cần bấm **[🛒 Mua Ngay]** ở dưới bức ảnh đó!`)
                .setColor('#F1C40F');
            await channel.send({ embeds: [titleEmbed] });

            // Lấy tất cả sản phẩm của danh mục này
            const products = await db.getAvailableProducts(String(cat.id));
            
            // Nhóm các sản phẩm theo giá và mô tả
            const grouped = new Map();
            for (const p of products) {
                const key = `${p.price}_${p.description}`;
                if (!grouped.has(key)) {
                    grouped.set(key, { template: p, count: 1 });
                } else {
                    grouped.get(key).count++;
                }
            }

            for (const group of grouped.values()) {
                const { template, count } = group;
                
                const productEmbed = new EmbedBuilder()
                    .setColor('#3498DB');

                if (count > 1) {
                    productEmbed.setTitle(`Sản Phẩm: ${template.description || `Mã số #${template.id}`}`);
                    productEmbed.setDescription(`**Giá:** ${parseInt(template.price || 0).toLocaleString()} VNĐ\n📦 **Kho còn:** \`${count}\` chiếc\n*(Hệ thống sẽ tự động xuất kho 1 chiếc khi bạn mua)*`);
                } else {
                    productEmbed.setTitle(`Mã số #${template.id}`);
                    productEmbed.setDescription(`**Mô tả:** ${template.description || 'Không có'}\n**Giá:** ${parseInt(template.price || 0).toLocaleString()} VNĐ`);
                }

                if (template.image) {
                    productEmbed.setImage(template.image);
                }

                const customId = count > 1 ? `pre_confirm_grouped_${template.id}` : `pre_confirm_buy_${template.id}`;
                const label = count > 1 ? `Mua Ngay` : `Mua Sản Phẩm Này (Mã ${template.id})`;

                const buyBtn = new ButtonBuilder()
                    .setCustomId(customId)
                    .setLabel(label)
                    .setEmoji('🛒')
                    .setStyle(ButtonStyle.Primary);

                const row = new ActionRowBuilder().addComponents(buyBtn);
                const msg = await channel.send({ embeds: [productEmbed], components: [row] });
                
                // Lưu ID tin nhắn vào DB để sau này xóa (Chỉ lưu cho template)
                await db.updateProductMessage(template.id, channel.id, msg.id);
                
                postedCount++;
            }

        } catch (err) {
            console.error(`Lỗi đăng bài cho danh mục ${cat.name}:`, err);
        }
    }

    await interaction.editReply({ content: `✅ Đã hoàn tất! Tạo/Cập nhật **${createdCount} kênh** và đăng tổng cộng **${postedCount} sản phẩm**.` });
}

// ---------------------------------------------------------
// 2.5 LỆNH /THEM_SAN_PHAM (Đăng Tự Động)
// ---------------------------------------------------------
async function handleAddProduct(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const groupId = interaction.options.getString('nhom');
    const price = interaction.options.getInteger('gia_tien');
    const loaiHang = interaction.options.getString('loai_hang');
    const isManual = (loaiHang === 'manual');
    const username = interaction.options.getString('tai_khoan') || (isManual ? "Giao Thủ Công" : "");
    const password = interaction.options.getString('mat_khau') || "";
    const description = interaction.options.getString('mo_ta');
    const attachment = interaction.options.getAttachment('hinh_anh');

    if (!isManual && username === "") {
        return interaction.editReply({ content: '❌ Nếu Giao Tự Động, bạn BẮT BUỘC phải điền Tài khoản/Code vào ô tai_khoan!' });
    }

    // Kiểm tra nhóm có tồn tại không
    const categories = await db.getCategories();
    const cat = categories.find(c => String(c.id) === groupId);
    if (!cat) {
        return interaction.editReply({ content: `❌ Không tìm thấy nhóm hàng có ID = ${groupId}. Hãy kiểm tra lại file products.json (Phần groups).` });
    }

    // Nếu là ảnh hợp lệ
    if (!attachment.contentType || !attachment.contentType.startsWith('image/')) {
        return interaction.editReply({ content: '❌ File đính kèm phải là hình ảnh!' });
    }

    const newProductData = {
        groups: parseInt(groupId),
        price: price,
        username: username,
        password: password,
        image: attachment.url,
        description: description,
        isManual: isManual
    };

    const result = db.addProduct(newProductData);
    if (!result.success) {
        return interaction.editReply({ content: `❌ Lỗi khi thêm vào DB.` });
    }

    const product = result.product;

    // Tìm kênh đăng bài
    const channelName = cat.name.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');
    let shopChannel = interaction.guild.channels.cache.find(c => c.name === channelName);
    
    if (!shopChannel) {
        return interaction.editReply({ content: `✅ Đã lưu vào DB thành công, nhưng không tìm thấy kênh #${channelName} để đăng bài. Vui lòng gõ lại /auto_post_products để bot tự tạo kênh nhé!` });
    }

    // Tạo Embed
    const embed = new EmbedBuilder()
        .setTitle(cat.name.toUpperCase())
        .setDescription(`📝 **Mô tả:** ${product.description}\n\n💰 **Giá:** ${product.price.toLocaleString()} VNĐ`)
        .setImage(product.image)
        .setColor('#3498DB');

    const buyBtn = new ButtonBuilder()
        .setCustomId(`buy_${product.id}`)
        .setLabel(`Mua Sản Phẩm Này`)
        .setEmoji('🛒')
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(buyBtn);

    const message = await shopChannel.send({ embeds: [embed], components: [row] });
    
    // Lưu Message ID vào DB
    db.updateProductMsg(product.id, shopChannel.id, message.id);

    await interaction.editReply({ content: `✅ Đã thêm sản phẩm #${product.id} thành công và tự động đăng bài lên kênh <#${shopChannel.id}>!` });
}

// ---------------------------------------------------------
// 3. LỆNH /TEST_PAY (Giả lập thanh toán)
// ---------------------------------------------------------
async function handleTestPay(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const orderAmount = interaction.options.getString('order_code'); // Now it's the amount

    try {
        const response = await fetch('http://localhost:3000/webhook/payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transferAmount: parseInt(orderAmount) || 0
            })
        });

        const data = await response.json();
        if (data.success) {
            await interaction.editReply({ content: `✅ Giả lập thành công đơn hàng số tiền **${orderAmount}đ**! Bot đang tiến hành giao Acc, xóa ảnh, nổ Log... Vui lòng kiểm tra các kênh!` });
        } else {
            await interaction.editReply({ content: `❌ Lỗi giả lập: ${data.message}` });
        }
    } catch (err) {
        console.error(err);
        await interaction.editReply({ content: `❌ Lỗi khi gọi Webhook: Bot Webhook có đang bật không?` });
    }
}


// ---------------------------------------------------------
// 3. XỬ LÝ NÚT BẤM
// ---------------------------------------------------------
async function handleButton(interaction) {
    // 3.1 NÚT MỞ POPUP NHẬP MÃ (Ở Cổng Fast Checkout)
    if (interaction.customId === 'btn_open_checkout') {
        const modal = new ModalBuilder()
            .setCustomId('checkout_modal')
            .setTitle('Thanh Toán Sản Phẩm');

        const idInput = new TextInputBuilder()
            .setCustomId('product_id_input')
            .setLabel("Nhập Mã Số Sản Phẩm (ID):")
            .setPlaceholder("Ví dụ: 101, 202...")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(idInput));
        await interaction.showModal(modal);
    }

    // 3.2 NÚT "MUA SẢN PHẨM NÀY" MUA SỈ (GROUPED)
    if (interaction.customId.startsWith('pre_confirm_grouped_')) {
        const templateId = interaction.customId.replace('pre_confirm_grouped_', '');
        
        const modal = new ModalBuilder()
            .setCustomId(`qty_modal_${templateId}`)
            .setTitle('Nhập Số Lượng Mua');

        const qtyInput = new TextInputBuilder()
            .setCustomId('quantity_input')
            .setLabel("Số lượng (Tối đa: 10):")
            .setStyle(TextInputStyle.Short)
            .setValue("1")
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(qtyInput));
        return interaction.showModal(modal);
    }

    // 3.2.1 NÚT "MUA SẢN PHẨM NÀY" Ở TỪNG BÀI POST (SINGLE)
    if (interaction.customId.startsWith('pre_confirm_buy_')) {
        await interaction.deferReply({ ephemeral: true });
        
        const productId = interaction.customId.replace('pre_confirm_buy_', '');
        const product = await db.getProduct(productId);
        if (!product || product.status !== 0) {
            return interaction.editReply({ content: '❌ Sản phẩm này đã được bán hoặc không khả dụng!', embeds: [], components: [] });
        }

        const embed = new EmbedBuilder()
            .setTitle(`XÁC NHẬN MUA: #${product.id}`)
            .setDescription(`**Bạn có chắc chắn muốn mua sản phẩm này với giá ${parseInt(product.price || 0).toLocaleString()} VNĐ không?**`)
            .setColor('#9B59B6');

        const confirmBtn = new ButtonBuilder()
            .setCustomId(`confirm_buy_${product.id}`)
            .setLabel(`Chốt Mua Ngay`)
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success);

        const cancelBtn = new ButtonBuilder()
            .setCustomId(`cancel_buy_${product.id}`)
            .setLabel(`Hủy`)
            .setEmoji('❌')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);
        await interaction.editReply({ embeds: [embed], components: [row] });
    }


    // 3.3 NÚT CHỐT MUA (Sinh mã QR)
    if (interaction.customId.startsWith('confirm_buy_')) {
        await interaction.deferUpdate();
        const productId = interaction.customId.replace('confirm_buy_', '');
        const discordUserId = interaction.user.id;

        const result = await db.createOrder(productId, discordUserId);
        
        if (!result.success) {
            return interaction.editReply({ content: `❌ Lỗi: ${result.message}` });
        }

        const bankName = process.env.BANK_NAME || 'MB';
        const bankAccount = process.env.BANK_ACCOUNT || '123456789';
        const bankId = process.env.BANK_ID || '970422'; // Default MB
        
        // Cú pháp tạo QR qua img.vietqr.io (Hoàn toàn KHÔNG có addInfo)
        const qrUrl = `https://img.vietqr.io/image/${bankId}-${bankAccount}-compact2.png?amount=${result.finalPrice}&accountName=${bankName}`;
        
        const qrEmbed = new EmbedBuilder()
            .setTitle('QR THANH TOÁN (QUÉT LÀ MUA)')
            .setDescription(`Bạn đang mua **Sản phẩm #${productId}**\n\n💰 **Số tiền cần thanh toán:** \`${result.finalPrice.toLocaleString()} VNĐ\`\n🧾 **Mã tham chiếu:** \`${result.orderCode}\` *(Chỉ dùng để tra cứu)*\n\n⚠️ **LƯU Ý QUAN TRỌNG:**\nVui lòng chuyển **ĐÚNG SỐ TIỀN LẺ** ở trên để hệ thống tự động giao hàng. Quét mã QR để app ngân hàng tự điền đúng số tiền nhé!`)
            .setImage(qrUrl)
            .setColor('#E74C3C')
            .setFooter({ text: 'Đơn hàng tự hủy sau 15 phút' });

        await interaction.editReply({ embeds: [qrEmbed], components: [] });
    }

    // 3.5 NÚT HỦY
    if (interaction.customId.startsWith('cancel_buy_')) {
        await interaction.update({ content: 'Đã hủy thao tác.', embeds: [], components: [] });
    }

    // 3.6 NÚT "GIAO HÀNG CHO KHÁCH NÀY" (Dành cho Admin)
    if (interaction.customId.startsWith('admin_deliver_')) {
        const parts = interaction.customId.replace('admin_deliver_', '').split('_');
        const orderCode = parts[0];
        const discordUserId = parts[1];

        const modal = new ModalBuilder()
            .setCustomId(`modal_deliver_${orderCode}_${discordUserId}`)
            .setTitle(`Giao Hàng Cho: ${orderCode}`);

        const codeInput = new TextInputBuilder()
            .setCustomId('code_input')
            .setLabel("Nhập Nội dung / Tài khoản / Code:")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("Ví dụ: Tài khoản: admin | Pass: 123456\nHoặc Mã Code: ABC-XYZ")
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
        return interaction.showModal(modal);
    }
}

// ---------------------------------------------------------
// 4. XỬ LÝ MODAL SUBMIT (Nhập mã ở Fast Checkout)
// ---------------------------------------------------------
async function handleModalSubmit(interaction) {
    if (interaction.customId === 'checkout_modal') {
        await interaction.deferReply({ ephemeral: true });
        
        const productId = interaction.fields.getTextInputValue('product_id_input').trim();
        const product = await db.getProduct(productId);

        if (!product) {
            return interaction.editReply({ content: '❌ Không tìm thấy sản phẩm có mã này. Vui lòng kiểm tra lại!', embeds: [], components: [] });
        }

        if (product.status !== 0) {
            return interaction.editReply({ content: '❌ Sản phẩm này đã được bán hoặc không khả dụng!', embeds: [], components: [] });
        }

        const embed = new EmbedBuilder()
            .setTitle(`THÔNG TIN SẢN PHẨM: #${product.id}`)
            .setDescription(`**Giá bán:** ${parseInt(product.price || 0).toLocaleString()} VNĐ`)
            .setColor('#9B59B6');

        if (product.image) {
            embed.setImage(product.image);
        }

        const confirmBtn = new ButtonBuilder()
            .setCustomId(`confirm_buy_${product.id}`)
            .setLabel(`Xác Nhận Mua Ngay`)
            .setEmoji('✅')
            .setStyle(ButtonStyle.Success);

        const cancelBtn = new ButtonBuilder()
            .setCustomId(`cancel_buy_${product.id}`)
            .setLabel(`Hủy`)
            .setEmoji('❌')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);
        await interaction.editReply({ embeds: [embed], components: [row] });
    }

    // 4.3 NHẬP CODE GIAO HÀNG (Dành cho Admin)
    if (interaction.customId.startsWith('modal_deliver_')) {
        await interaction.deferReply({ ephemeral: true });
        
        const parts = interaction.customId.replace('modal_deliver_', '').split('_');
        const orderCode = parts[0];
        const discordUserId = parts[1];
        const deliveryCode = interaction.fields.getTextInputValue('code_input');

        try {
            // Ping khách hàng
            const user = await interaction.client.users.fetch(discordUserId);
            if (user) {
                const embed = new EmbedBuilder()
                    .setTitle('🎉 ĐƠN HÀNG ĐÃ ĐƯỢC XỬ LÝ')
                    .setDescription(`Admin vừa giao hàng cho đơn **${orderCode}** của bạn!\n\n📦 **Thông tin sản phẩm:**\n\`\`\`\n${deliveryCode}\n\`\`\``)
                    .setColor('#00FF00');
                
                await user.send({ embeds: [embed] });
            }

            // Sửa lại bài viết Log
            const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
            originalEmbed.setColor('#2ECC71');
            originalEmbed.setTitle('✅ ĐÃ GIAO HÀNG THỦ CÔNG');

            // Xóa nút bấm cũ
            await interaction.message.edit({ content: '', embeds: [originalEmbed], components: [] });

            return interaction.editReply({ content: '✅ Đã gửi hàng cho khách thành công!' });
        } catch (err) {
            console.error('Lỗi khi Admin giao hàng thủ công:', err);
            return interaction.editReply({ content: '❌ Có lỗi khi gửi tin nhắn cho khách. Khách có chặn DMs không?' });
        }
    }
}

module.exports = {
    setupCheckoutCommand,
    autoPostProductsCommand,
    testPayCommand,
    addProductCommand,
    handleSetupCheckout,
    handleAutoPostProducts,
    handleTestPay,
    handleAddProduct,
    handleButton,
    handleModalSubmit
};
