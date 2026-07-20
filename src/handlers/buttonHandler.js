/**
 * buttonHandler.js - Xử lý tất cả button interactions
 */
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const productService = require('../services/productService');
const stockService = require('../services/stockService');
const orderService = require('../services/orderService');
const embeds = require('../utils/embedBuilder');
const { ButtonStyle, ButtonBuilder } = require('discord.js');

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
                .setCustomId(`${prefix}_${item.id}`)
                .setLabel(btnLabel)
                .setStyle(ButtonStyle.Primary)
        );
    });
    
    if (currentRow.components.length > 0) rows.push(currentRow);
    return rows;
}

async function handle(interaction) {
    if (!interaction.isButton() && !interaction.isModalSubmit()) return;

    const id = interaction.customId;

    // ═══════════════════════════════════════
    // MENU TƯƠNG TÁC (TỪ LỆNH /setup_shop)
    // ═══════════════════════════════════════
    if (id === 'open_shop_menu' || id === 'back_shop_menu') {
        const categories = [
            { id: 'acc_pc', name: '🎮 ACCOUNT PC' },
            { id: 'gcoin', name: '💎 CODE GCOIN' },
            { id: 'steam', name: '💳 CODE STEAM WALLET' },
            { id: 'outfit', name: '👕 CODE TRANG PHỤC' }
        ];

        const rows = buildButtonRows(categories, 'catbtn');
        
        if (id === 'open_shop_menu') {
            if (interaction.message?.flags?.has(64)) {
                return interaction.update({ content: '🚀 **MỜI BẠN CHỌN DANH MỤC CẦN MUA:**', embeds: [], components: rows });
            } else {
                return interaction.reply({ content: '🚀 **MỜI BẠN CHỌN DANH MỤC CẦN MUA:**', embeds: [], components: rows, ephemeral: true });
            }
        } else {
            return interaction.update({ content: '🚀 **MỜI BẠN CHỌN DANH MỤC CẦN MUA:**', embeds: [], components: rows });
        }
    }

    if (id.startsWith('catbtn_')) {
        const webCategory = id.replace('catbtn_', ''); // acc_pc, gcoin, steam, outfit
        const products = await productService.getAllWithStock({ webCategory: webCategory });
        
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('back_shop_menu').setLabel('⬅️ Trở Về').setStyle(ButtonStyle.Secondary)
        );

        if (products.length === 0) {
            return interaction.update({ content: `🛠️ **Mục này hiện đang hết hàng. Vui lòng quay lại sau!**`, embeds: [], components: [backRow] });
        }

        const rows = buildButtonRows(products.map(p => ({ id: p._id.toString(), name: p.name })), 'view');
        rows.push(backRow);

        let title = 'MỜI BẠN CHỌN SẢN PHẨM:';
        if (webCategory === 'acc_pc') title = '🎮 DANH SÁCH TÀI KHOẢN PC:';
        if (webCategory === 'gcoin') title = '💎 MỜI BẠN CHỌN MỆNH GIÁ GCOIN:';
        if (webCategory === 'steam') title = '💳 MỜI BẠN CHỌN MỆNH GIÁ STEAM WALLET:';
        if (webCategory === 'outfit') title = '👕 MỜI BẠN CHỌN SET TRANG PHỤC:';

        return interaction.update({ content: `**${title}**\n*(Sản phẩm sẽ được thanh toán qua QR Code tự động)*`, embeds: [], components: rows });
    }

    // ═══════════════════════════════════════
    // XEM THÔNG TIN SẢN PHẨM (từ danh mục)
    // ═══════════════════════════════════════
    if (id.startsWith('view_')) {
        const productId = id.replace('view_', '');
        const product = await productService.getWithStock(productId);
        if (!product || !product.isActive) {
            if (interaction.message?.flags?.has(64)) {
                return interaction.update({ content: '❌ Sản phẩm không tồn tại hoặc ngừng bán.', embeds: [], components: [] });
            } else {
                return interaction.reply({ content: '❌ Sản phẩm không tồn tại hoặc ngừng bán.', ephemeral: true });
            }
        }
        
        const embed = new EmbedBuilder()
            .setTitle(`📦 ${product.name}`)
            .setDescription(`**Giá bán:** ${product.price.toLocaleString('vi-VN')} VNĐ / 1 chiếc\n**Tồn kho:** ${product.stockCount} chiếc\n\n${product.description || '*Sản phẩm chất lượng cao, giao hàng tự động 24/7*'}`)
            .setColor(0x00FF00);
            
        if (product.imageUrl && product.imageUrl.startsWith('http')) {
            embed.setImage(product.imageUrl);
        }
        
        const buyRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`buy_${product._id}`)
                .setLabel('🛒 Tạo Đơn Hàng')
                .setStyle(ButtonStyle.Success)
        );
        
        if (interaction.message?.flags?.has(64)) {
            return interaction.update({ content: '', embeds: [embed], components: [buyRow] });
        } else {
            return interaction.reply({ embeds: [embed], components: [buyRow], ephemeral: true });
        }
    }

    // ═══════════════════════════════════════
    // NÚT MUA HÀNG (từ embed sản phẩm)
    // ═══════════════════════════════════════
    if (id.startsWith('buy_')) {
        const productId = id.replace('buy_', '');
        return handleBuyClick(interaction, productId);
    }

    if (id.startsWith('pagebtn_account_')) {
        const parts = id.split('_');
        const productId = parts[2];
        const page = parseInt(parts[3]);
        return handleAccountPagination(interaction, productId, page);
    }

    if (id.startsWith('buyitem_')) {
        const parts = id.split('_');
        const productId = parts[1];
        const stockId = parts[2];
        return handleBuySpecificItem(interaction, productId, stockId);
    }

    // ═══════════════════════════════════════
    // NÚT HỦY ĐƠN HÀNG
    // ═══════════════════════════════════════
    if (id.startsWith('cancel_order_')) {
        const orderRef = id.replace('cancel_order_', '');
        return handleCancelOrder(interaction, orderRef);
    }

    // ═══════════════════════════════════════
    // NÚT GIAO HÀNG VIP (Admin)
    // ═══════════════════════════════════════
    if (id.startsWith('admin_deliver_')) {
        const orderRef = id.replace('admin_deliver_', '');

        const modal = new ModalBuilder()
            .setCustomId(`modal_deliver_${orderRef}`)
            .setTitle(`Giao Hàng VIP: ${orderRef}`);

        const codeInput = new TextInputBuilder()
            .setCustomId('delivery_content')
            .setLabel('Nhập Code / Tài khoản / Nội dung giao:')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Ví dụ: Tài khoản: admin01 | Pass: 123456\nHoặc Code: ABC-XYZ-123')
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
        return interaction.showModal(modal);
    }

    // ═══════════════════════════════════════
    // NÚT DUYỆT HÀNG ĐẶC BIỆT (Admin)
    // ═══════════════════════════════════════
    if (id.startsWith('admin_approve_')) {
        const orderRef = id.replace('admin_approve_', '');

        const modal = new ModalBuilder()
            .setCustomId(`modal_approve_${orderRef}`)
            .setTitle(`Duyệt đơn: ${orderRef}`);

        // setRequired(true): Discord tự chặn bấm Gửi khi ô còn trống.
        const codeInput = new TextInputBuilder()
            .setCustomId('approval_content')
            .setLabel('Nội dung gửi cho khách:')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Ví dụ: Tài khoản: admin01 | Pass: 123456\nHoặc Code: ABC-XYZ-123')
            .setRequired(true)
            .setMinLength(1);

        modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
        return interaction.showModal(modal);
    }
}

/**
 * Xử lý click mua hàng (bung bảng chọn số lượng hoặc mua luôn nếu là VIP)
 */
async function handleBuyClick(interaction, productId) {
    const product = await productService.getWithStock(productId);

    if (!product || !product.isActive) {
        if (interaction.message?.flags?.has(64)) return interaction.update({ content: '❌ Sản phẩm không tồn tại hoặc ngừng bán.', embeds: [], components: [] });
        else return interaction.reply({ content: '❌ Sản phẩm không tồn tại hoặc ngừng bán.', ephemeral: true });
    }

    // VIP: Mua thẳng 1 cái, không cần chọn số lượng
    if (product.type === 'vip') {
        return handleBuyConfirm(interaction, productId, 1, interaction.token);
    }

    // Account: Lướt chọn từng nick (Pagination)
    if (product.type === 'account') {
        return handleAccountPagination(interaction, productId, 1, true);
    }

    // Code: Hiển thị form nhập số lượng
    if (product.stockCount === 0) {
        if (interaction.message?.flags?.has(64)) {
            return interaction.update({ content: '❌ Sản phẩm đã hết hàng!', embeds: [], components: [] });
        } else {
            return interaction.reply({ content: '❌ Sản phẩm đã hết hàng!', ephemeral: true });
        }
    }

    const modal = new ModalBuilder()
        .setCustomId(`modal_buy_${productId}`)
        .setTitle(`Mua ${product.name.length > 30 ? product.name.substring(0, 30) : product.name}`);

    const qtyInput = new TextInputBuilder()
        .setCustomId('quantity')
        .setLabel(`Nhập số lượng (Kho: ${product.stockCount}):`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ví dụ: 1, 2, 5...')
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(qtyInput));
    return interaction.showModal(modal);
}

/**
 * Xử lý mua 1 tài khoản đích danh
 */
async function handleBuySpecificItem(interaction, productId, stockId) {
    if (interaction.message?.flags?.has(64)) {
        await interaction.deferUpdate();
    } else {
        await interaction.deferReply({ ephemeral: true });
    }

    const result = await orderService.createSpecificOrder(
        interaction.user.id,
        interaction.user.username,
        productId,
        stockId,
        interaction.token
    );

    if (!result.success) {
        return interaction.editReply({ content: `❌ ${result.message}`, components: [] });
    }

    const embed = embeds.paymentEmbed(result.order, result.qrUrl);
    const cancelRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`cancel_order_${result.order.reference}`)
            .setLabel('❌ Hủy giao dịch')
            .setStyle(ButtonStyle.Danger)
    );
    return interaction.editReply({ embeds: [embed], components: [cancelRow] });
}

/**
 * Hiển thị danh sách tài khoản theo trang (Pagination)
 */
async function handleAccountPagination(interaction, productId, page = 1, isInitial = false) {
    if (!isInitial) {
        if (interaction.message?.flags?.has(64)) {
        await interaction.deferUpdate();
    } else {
        await interaction.deferReply({ ephemeral: true });
    }
    }

    const product = await productService.getById(productId);
    if (!product || !product.isActive) {
        const msg = '❌ Sản phẩm không tồn tại hoặc ngừng bán.';
        return interaction.editReply({ content: msg, embeds: [], components: [] });
    }

    const { items, totalStock, totalPages } = await productService.getAvailableStock(productId, page, 3);

    if (totalStock === 0) {
        const msg = '⚠️ Gói này hiện đang hết hàng. Vui lòng quay lại sau!';
        return interaction.editReply({ content: msg, embeds: [], components: [] });
    }

    if (items.length === 0 && page > 1) {
        // Trường hợp khách nhấn sang trang không có data
        return interaction.editReply({ content: '⚠️ Không có dữ liệu ở trang này!', embeds: [], components: [] });
    }

    const displayEmbeds = [];
    const buttonsRow1 = new ActionRowBuilder();
    const buttonsRow2 = new ActionRowBuilder();

    items.forEach((item, idx) => {
        const num = idx + 1 + (page - 1) * 3;
        const embed = embeds.accountItemEmbed(product, item, num);
        displayEmbeds.push(embed);

        const btn = new ButtonBuilder()
            .setCustomId(`buyitem_${productId}_${item._id}`)
            .setLabel(`🛒 Mua Số ${num}`)
            .setStyle(ButtonStyle.Success);
            
        if (idx < 5) buttonsRow1.addComponents(btn);
        else buttonsRow2.addComponents(btn);
    });

    const navRow = new ActionRowBuilder();
    if (page > 1) {
        navRow.addComponents(new ButtonBuilder().setCustomId(`pagebtn_account_${productId}_${page - 1}`).setLabel('⬅️ Trang Trước').setStyle(ButtonStyle.Primary));
    }
    if (page < totalPages) {
        navRow.addComponents(new ButtonBuilder().setCustomId(`pagebtn_account_${productId}_${page + 1}`).setLabel('Trang Sau ➡️').setStyle(ButtonStyle.Primary));
    }

    const components = [];
    if (buttonsRow1.components.length > 0) components.push(buttonsRow1);
    if (buttonsRow2.components.length > 0) components.push(buttonsRow2);
    if (navRow.components.length > 0) components.push(navRow);

    const contentStr = `🛒 **ĐANG CÓ ${totalStock} SẢN PHẨM TRONG KHO!** (Trang ${page}/${totalPages})\n> Dưới đây là danh sách tài khoản. Hãy bấm nút Mua tương ứng với số thứ tự của tài khoản bạn ưng ý!`;

    if (isInitial) {
        return interaction.editReply({ content: contentStr, embeds: displayEmbeds, components: components });
    } else {
        return interaction.editReply({ content: contentStr, embeds: displayEmbeds, components: components });
    }
}

/**
 * Xử lý xác nhận mua (sau khi chọn số lượng hoặc VIP bấm mua)
 */
async function handleBuyConfirm(interaction, productId, quantity, token = null) {
    if (interaction.message?.flags?.has(64)) {
        await interaction.deferUpdate();
    } else {
        await interaction.deferReply({ ephemeral: true });
    }

    const result = await orderService.createOrder(
        interaction.user.id,
        interaction.user.username,
        productId,
        quantity,
        token || interaction.token
    );

    if (!result.success) {
        return interaction.editReply({ content: `❌ ${result.message}`, components: [] });
    }

    const embed = embeds.paymentEmbed(result.order, result.qrUrl);
    const cancelRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`cancel_order_${result.order.reference}`)
            .setLabel('❌ Hủy giao dịch')
            .setStyle(ButtonStyle.Danger)
    );
    return interaction.editReply({ embeds: [embed], components: [cancelRow] });
}

/**
 * Xử lý click nút Hủy đơn hàng
 */
async function handleCancelOrder(interaction, orderRef) {
    if (interaction.message?.flags?.has(64)) {
        await interaction.deferUpdate();
    } else {
        await interaction.deferReply({ ephemeral: true });
    }

    const result = await orderService.cancelOrder(orderRef);
    if (!result.success) {
        return interaction.editReply({ content: `❌ ${result.message}`, components: [] });
    }

    return interaction.editReply({ 
        content: `✅ Đã hủy giao dịch **${orderRef}** thành công!`, 
        embeds: [], 
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('open_shop_menu')
                    .setLabel('🛒 Mua hàng tiếp')
                    .setStyle(ButtonStyle.Success)
            )
        ] 
    });
}

module.exports = { handle, handleBuyClick, handleBuyConfirm, handleCancelOrder };
