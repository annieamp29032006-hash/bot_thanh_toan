/**
 * embedBuilder.js - Template embed đẹp cho sản phẩm, đơn hàng, log
 */
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const config = require('../../config');

const BRAND_COLOR = '#00D8FF';
const SUCCESS_COLOR = '#00ff88';
const WARNING_COLOR = '#FFD700';
const DANGER_COLOR = '#ff4d4d';

const FOOTER = { text: '© 2026 Kaiz Store | Hệ thống tự động' };

// ═══════════════════════════════════════════════════
// EMBED SẢN PHẨM (Hiển thị trong kênh shop)
// ═══════════════════════════════════════════════════
function productEmbed(product, stockCount = 0) {
    const typeLabel = { code: '📦 Code / Key', vip: '⭐ Sản phẩm VIP', account: '🎮 Tài khoản đích danh' };
    const embed = new EmbedBuilder()
        .setTitle(`💎 ${product.name}`)
        .setDescription(product.description ? `*${product.description}*` : '*Không có mô tả chi tiết*')
        .addFields(
            { name: '💰 Giá Bán', value: `\`${product.price.toLocaleString()} VNĐ\``, inline: true },
            { name: '🔖 Phân Loại', value: `**${typeLabel[product.type] || product.type}**`, inline: true }
        )
        .setColor(product.type === 'vip' ? WARNING_COLOR : BRAND_COLOR)
        .setFooter(FOOTER)
        .setTimestamp();

    if (product.type !== 'vip') {
        embed.addFields({ name: '📊 Tồn Kho', value: `\`${stockCount}\` sản phẩm`, inline: true });
    }

    if (product.imageUrl) {
        embed.setImage(product.imageUrl);
    }

    return embed;
}

// Nút Mua Hàng
function buyButton(productId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`buy_${productId}`)
            .setLabel('🛒 Mua Ngay')
            .setStyle(ButtonStyle.Success)
    );
}

// ═══════════════════════════════════════════════════
// EMBED TÀI KHOẢN ĐƠN LẺ (PAGINATION)
// ═══════════════════════════════════════════════════
function accountItemEmbed(product, stockItem, index) {
    const embed = new EmbedBuilder()
        .setTitle(`🎮 Tài khoản #${index} - ${product.name}`)
        .setDescription(`**Giá bán:** ${product.price.toLocaleString('vi-VN')} VNĐ\n\n*(Thông tin đăng nhập sẽ được gửi ngay sau khi thanh toán)*`)
        .setColor(WARNING_COLOR)
        .setFooter({ text: 'Nhấn nút "Mua Số..." bên dưới để sở hữu tài khoản này' });
        
    if (stockItem.imageUrl && stockItem.imageUrl.startsWith('http')) {
        embed.setImage(stockItem.imageUrl);
    } else if (product.imageUrl) {
        embed.setImage(product.imageUrl);
    }
    
    return embed;
}

// ═══════════════════════════════════════════════════
// EMBED SHOP MENU (Gộp sản phẩm)
// ═══════════════════════════════════════════════════
function shopMenuEmbed(menuTitle, description) {
    return new EmbedBuilder()
        .setTitle(`🛍️ ${menuTitle}`)
        .setDescription(description || '👇 **Vui lòng chọn một mặt hàng bên dưới để tiến hành thanh toán.**')
        .setColor(BRAND_COLOR)
        .setFooter(FOOTER)
        .setTimestamp();
}

function shopMenuSelect(products, stockMap) {
    const options = products.map(p => {
        const stockCount = stockMap[p._id.toString()] || 0;
        let desc = `${p.price.toLocaleString()} VNĐ`;
        if (p.type !== 'vip') {
            desc += ` | Còn lại: ${stockCount}`;
        }
        return {
            label: p.name,
            value: p._id.toString(),
            description: desc,
            emoji: p.type === 'vip' ? '⭐' : '🛒'
        };
    });

    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('select_product_menu')
            .setPlaceholder('🔽 Lựa chọn sản phẩm bạn muốn mua...')
            .addOptions(options)
    );
}

// ═══════════════════════════════════════════════════
// SELECT MENU SỐ LƯỢNG
// ═══════════════════════════════════════════════════
function quantitySelect(productId, maxStock) {
    const options = [1, 2, 3, 5, 10, 20].filter(n => n <= maxStock).map(n => ({
        label: `${n} sản phẩm`,
        value: `${n}`,
        description: `Mua số lượng: ${n}`
    }));

    if (options.length === 0) {
        options.push({ label: '1 sản phẩm', value: '1', description: 'Mua số lượng: 1' });
    }

    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`qty_${productId}`)
            .setPlaceholder('📦 Chọn số lượng cần mua...')
            .addOptions(options)
    );
}

// ═══════════════════════════════════════════════════
// EMBED QR THANH TOÁN
// ═══════════════════════════════════════════════════
function paymentEmbed(order, qrUrl) {
    return new EmbedBuilder()
        .setTitle('💳 THÔNG TIN THANH TOÁN')
        .setDescription(
            `Cảm ơn bạn đã đặt hàng! Vui lòng quét mã QR bên dưới để thanh toán.\n\n` +
            `🛒 **Sản phẩm:** \`${order.productName}\`\n` +
            `📝 **Số lượng:** \`${order.quantity}\`\n` +
            `🏷️ **Mã đơn hàng:** \`${order.reference}\`\n\n` +
            `⚠️ **LƯU Ý QUAN TRỌNG:**\n` +
            `> Hệ thống duyệt đơn hoàn toàn tự động.\n` +
            `> Bạn **BẮT BUỘC** phải chuyển khoản **ĐÚNG ĐẾN TỪNG ĐỒNG**.\n` +
            `> KHÔNG cần ghi nội dung chuyển khoản.\n\n` +
            `💰 **Số tiền cần thanh toán:** \`${order.totalAmount.toLocaleString()} VNĐ\``
        )
        .setImage(qrUrl)
        .setColor(DANGER_COLOR)
        .setFooter({ text: `Hủy tự động sau ${config.PAYMENT_TIMEOUT} phút nếu chưa thanh toán | Kaiz Store` })
        .setTimestamp();
}

// ═══════════════════════════════════════════════════
// EMBED GIAO HÀNG THÀNH CÔNG (DM)
// ═══════════════════════════════════════════════════
function deliveryEmbed(order, items) {
    let itemsText = '';
    if (order.productType === 'code') {
        itemsText = items.map((item, i) => `**${i + 1}.** \`${item.content}\``).join('\n');
    } else if (order.productType === 'account') {
        itemsText = items.map((item, i) => 
            `**${i + 1}.** Tài khoản: \`${item.content}\` | Mật khẩu: \`${item.password}\``
        ).join('\n');
    } else if (order.productType === 'vip') {
        itemsText = `\`\`\`\n${order.deliveryContent}\n\`\`\``;
    }

    return new EmbedBuilder()
        .setTitle('🎉 GIAO HÀNG THÀNH CÔNG')
        .setDescription(
            `Cảm ơn bạn đã tin tưởng và ủng hộ Kaiz Store!\n\n` +
            `🏷️ **Mã đơn:** \`${order.reference}\`\n` +
            `🛒 **Sản phẩm:** \`${order.productName}\` (x${order.quantity})\n` +
            `💰 **Đã thanh toán:** \`${order.totalAmount.toLocaleString()} VNĐ\`\n\n` +
            `📦 **THÔNG TIN SẢN PHẨM CỦA BẠN:**\n${itemsText}\n\n` +
            `*Lưu ý: Hãy lưu lại thông tin này cẩn thận.*`
        )
        .setColor(SUCCESS_COLOR)
        .setFooter(FOOTER)
        .setTimestamp();
}

// ═══════════════════════════════════════════════════
// EMBED CHỜ ADMIN GIAO (VIP)
// ═══════════════════════════════════════════════════
function vipWaitingEmbed(order) {
    return new EmbedBuilder()
        .setTitle('⏳ ĐANG XỬ LÝ ĐƠN HÀNG VIP')
        .setDescription(
            `Đơn hàng **${order.reference}** đã thanh toán thành công!\n\n` +
            `🛒 **Sản phẩm:** \`${order.productName}\`\n` +
            `💰 **Đã thanh toán:** \`${order.totalAmount.toLocaleString()} VNĐ\`\n\n` +
            `📌 **Tiến trình giao hàng:**\n` +
            `> ⏰ Đây là sản phẩm **VIP**, cần Admin trực tiếp xử lý.\n` +
            `> ⏳ Thời gian dự kiến: **5 - ${config.PAYMENT_TIMEOUT} phút**.\n` +
            `> 📨 Hãy mở **Nhận tin nhắn từ người lạ** để Bot có thể gửi hàng.\n` +
            `> ❓ Hỗ trợ: Vui lòng mở Ticket nếu quá thời gian chưa nhận được hàng.`
        )
        .setColor(WARNING_COLOR)
        .setFooter(FOOTER)
        .setTimestamp();
}

// ═══════════════════════════════════════════════════
// EMBED LOG ADMIN (VIP cần xử lý)
// ═══════════════════════════════════════════════════
function vipAdminAlertEmbed(order, userId) {
    return new EmbedBuilder()
        .setTitle('🚨 ĐƠN HÀNG VIP CẦN XỬ LÝ')
        .setDescription(
            `Khách hàng <@${userId}> vừa thanh toán đơn VIP!\n\n` +
            `🏷️ **Mã đơn:** \`${order.reference}\`\n` +
            `🛒 **Sản phẩm:** \`${order.productName}\`\n` +
            `💰 **Số tiền:** \`${order.totalAmount.toLocaleString()} VNĐ\`\n\n` +
            `👉 Bấm nút bên dưới hoặc dùng lệnh \`/order deliver ${order.reference}\` để gửi hàng cho khách.`
        )
        .setColor(DANGER_COLOR)
        .setFooter(FOOTER)
        .setTimestamp();
}

function vipDeliverButton(orderRef) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`admin_deliver_${orderRef}`)
            .setLabel('📦 Bấm để Giao Hàng')
            .setStyle(ButtonStyle.Primary)
    );
}

// ═══════════════════════════════════════════════════
// EMBED LOG GIAO DỊCH
// ═══════════════════════════════════════════════════
function saleLogEmbed(order, userId, logType) {
    const colorMap = { code_sale: SUCCESS_COLOR, vip_sale: WARNING_COLOR, account_sale: BRAND_COLOR };
    const titleMap = { code_sale: '📜 LOG BÁN CODE', vip_sale: '⭐ LOG BÁN VIP', account_sale: '🎮 LOG BÁN ACCOUNT' };
    
    const fields = [
        { name: '👤 Người mua', value: `<@${userId}>`, inline: true },
        { name: '💰 Doanh thu', value: `\`${order.totalAmount.toLocaleString()} VNĐ\``, inline: true }
    ];

    if (logType === 'vip_sale' && order.deliveredBy) {
        fields.push({ name: '👨‍💻 Admin xử lý', value: `<@${order.deliveredBy}>`, inline: true });
    }

    return new EmbedBuilder()
        .setTitle(titleMap[logType] || '📋 LOG GIAO DỊCH')
        .setDescription(`**Sản phẩm:** ${order.productName} (x${order.quantity})\n**Mã đơn:** \`${order.reference}\``)
        .setFields(fields)
        .setColor(colorMap[logType] || '#95A5A6')
        .setFooter(FOOTER)
        .setTimestamp();
}

// ═══════════════════════════════════════════════════
// EMBED THỐNG KÊ DOANH THU
// ═══════════════════════════════════════════════════
function revenueStatsEmbed(title, totalRevenue, totalOrders, topBuyers) {
    const embed = new EmbedBuilder()
        .setTitle(`📊 ${title}`)
        .setDescription(`Hệ thống cập nhật tự động mỗi 10 phút.`)
        .addFields(
            { name: '💰 Tổng Doanh Thu', value: `**${totalRevenue.toLocaleString()} VNĐ**`, inline: true },
            { name: '🛒 Số Lượng Đơn', value: `**${totalOrders}** đơn`, inline: true }
        )
        .setColor(BRAND_COLOR)
        .setFooter(FOOTER)
        .setTimestamp();

    if (topBuyers && topBuyers.length > 0) {
        let topText = '';
        const medals = ['🥇', '🥈', '🥉'];
        topBuyers.forEach((b, index) => {
            const medal = medals[index] || '🏅';
            topText += `${medal} <@${b._id}>: \`${b.totalSpent.toLocaleString()} VNĐ\` (${b.orderCount} đơn)\n`;
        });
        embed.addFields({ name: '🏆 TOP KHÁCH HÀNG VIP', value: topText, inline: false });
    } else {
        embed.addFields({ name: '🏆 TOP KHÁCH HÀNG VIP', value: '*Chưa có dữ liệu*', inline: false });
    }

    return embed;
}

module.exports = {
    productEmbed,
    buyButton,
    quantitySelect,
    paymentEmbed,
    deliveryEmbed,
    vipWaitingEmbed,
    vipAdminAlertEmbed,
    vipDeliverButton,
    saleLogEmbed,
    shopMenuEmbed,
    shopMenuSelect,
    revenueStatsEmbed,
    accountItemEmbed
};
