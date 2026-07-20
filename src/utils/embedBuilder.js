/**
 * embedBuilder.js - Template embed đẹp cho sản phẩm, đơn hàng, log
 */
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const config = require('../../config');

const BRAND_COLOR = '#00D8FF';
const SUCCESS_COLOR = '#00ff88';
const WARNING_COLOR = '#FFD700';
const DANGER_COLOR = '#ff4d4d';

const ITEM_COLOR = '#2B2D31';   // trùng nền Discord: khối sản phẩm liền mạch với khung chat

// Logo tự host trên VPS, KHÔNG dùng link cdn.discordapp.com trực tiếp: link CDN
// Discord có chữ ký ex/is/hm và hết hạn sau khoảng 24 giờ, nhúng thẳng vào embed
// thì hôm sau ảnh hiện thành ô vỡ.
const SHOP_LOGO_URL = 'https://bot.adminkaiz.com/assets/logo.png';

const FOOTER = { text: '© 2026 Kaiz Store | Hệ thống tự động' };

// Markdown nghiêng của Discord không bắc qua xuống dòng: bọc cả đoạn nhiều dòng
// trong một cặp * sẽ hiện ra dấu sao thô. Nên phải nghiêng từng dòng một.
function italicLines(text) {
    return String(text)
        .split('\n')
        .map(l => (l.trim() ? `*${l.trim()}*` : ''))
        .join('\n');
}

// ═══════════════════════════════════════════════════
// EMBED SẢN PHẨM (Hiển thị trong kênh shop)
// ═══════════════════════════════════════════════════
function productEmbed(product, stockCount = 0) {
    const typeLabel = { code: '📦 Code / Key', vip: '⭐ Sản phẩm VIP', account: '🎮 Tài khoản đích danh' };
    const embed = new EmbedBuilder()
        .setTitle(`💎 ${product.name}`)
        .setDescription(product.description ? italicLines(product.description) : '*Không có mô tả chi tiết*')
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

    const warranty = (product.warranty || '').trim();
    if (warranty) {
        embed.addFields({ name: '🛡️ Chính Sách Bảo Hành', value: warranty, inline: false });
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
    const lines = [`**Giá bán:** ${product.price.toLocaleString('vi-VN')} VNĐ`];

    // Mô tả riêng của từng acc: đây là chỗ DUY NHẤT nó xuất hiện - khách cần đọc
    // trước khi quyết mua, chứ giao hàng xong mới thấy thì vô nghĩa.
    const note = (stockItem.note || '').trim();
    if (note) lines.push('', italicLines(note));

    const warranty = (stockItem.warranty || '').trim() || (product.warranty || '').trim();
    if (warranty) lines.push('', `🛡️ **Bảo hành:** ${warranty}`);

    lines.push('', '*(Thông tin đăng nhập sẽ được gửi ngay sau khi thanh toán)*');

    const embed = new EmbedBuilder()
        .setTitle(`🎮 Tài khoản #${index} - ${product.name}`)
        .setDescription(lines.join('\n'))
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
// EMBED CHÀO MỪNG (Anchor message của kênh shop)
// ═══════════════════════════════════════════════════
// Trước đây embed này bị chép y hệt ở setup_shop.js và messageCreate.js, mà bản
// sau lại thiếu màu với footer. Gom về một chỗ để sửa một lần là cả hai cùng đổi.
function shopWelcomeEmbed() {
    return new EmbedBuilder()
        .setAuthor({ name: '🛒 HỆ THỐNG CỬA HÀNG TỰ ĐỘNG', iconURL: SHOP_LOGO_URL })
        .setTitle('🌟 DANH MỤC SẢN PHẨM 🌟')
        .setDescription(
            'Chào mừng bạn đến với hệ thống Cửa Hàng!\n\n' +
            '💎 **CAM KẾT DỊCH VỤ:**\n' +
            '> • ⚡ Hoạt động tự động 24/7\n' +
            '> • 🚀 Giao dịch siêu tốc\n' +
            '> • 🛡️ Kín đáo & Bảo mật tuyệt đối\n\n' +
            '👇 *Vui lòng nhấn nút bên dưới để bắt đầu mua sắm!*'
        )
        .setImage(SHOP_LOGO_URL)
        .setColor(BRAND_COLOR)
        .setFooter({ text: 'Uy tín - Nhanh chóng - Tiện lợi' });
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
// Mã hiển thị cho từng món trong kho. Suy thẳng từ _id nên gửi lại DM bao nhiêu
// lần vẫn ra đúng mã cũ, khỏi phải thêm cột riêng trong DB.
function stockCode(item, prefix = 'ACC') {
    const id = String((item && item._id) || '');
    return id ? `${prefix}-${id.slice(-6).toUpperCase()}` : `${prefix}-??????`;
}

// Embed tóm tắt đơn. Hàng thật nằm ở các embed riêng phía sau (xem
// deliveryItemEmbeds) nên ở đây không liệt kê lại, tránh khách phải đọc hai lần.
function deliveryEmbed(order, items) {
    const lines = [
        `Cảm ơn bạn đã tin tưởng và ủng hộ Kaiz Store!`,
        ``,
        `🏷️ **Mã đơn:** \`${order.reference}\``,
        `🛒 **Sản phẩm:** \`${order.productName}\` (x${order.quantity})`,
        `💰 **Đã thanh toán:** \`${order.totalAmount.toLocaleString()} VNĐ\``,
        ``
    ];

    if (order.productType === 'vip') {
        lines.push(`📦 **THÔNG TIN SẢN PHẨM CỦA BẠN:**`, '```', order.deliveryContent || '(trống)', '```');
    } else {
        lines.push(`👇 **Hệ thống đang xuất kho và gửi từng sản phẩm cho bạn bên dưới...**`);
    }

    return new EmbedBuilder()
        .setTitle('🎉 GIAO HÀNG THÀNH CÔNG')
        .setDescription(lines.join('\n'))
        .setColor(SUCCESS_COLOR)
        .setFooter(FOOTER)
        .setTimestamp();
}

// Mỗi món một embed riêng, bày kiểu blockquote để khách copy từng ô cho gọn.
// Dòng "Email Gắn Kèm" chỉ hiện khi lúc nạp kho có phần dư sau user|pass.
// fallbackWarranty: chính sách bảo hành chung của mặt hàng, chỉ dùng cho những
// stock không khai bảo hành riêng.
function deliveryItemEmbeds(order, items, fallbackWarranty = '') {
    const total = items.length;

    return items.map((item, i) => {
        const email = (item.email || '').trim();
        const warranty = (item.warranty || '').trim() || String(fallbackWarranty || '').trim();

        // Bày theo DỮ LIỆU CÓ THẬT, không theo productType. Danh mục bán theo số
        // lượng vẫn có thể chứa tài khoản đầy đủ user/pass/mail - lúc đó phải giao
        // đủ, chứ không được rút gọn thành mỗi dòng Code.
        const isAccount = Boolean(item.password || email || warranty);
        const heading = isAccount ? 'Sản phẩm' : 'Mã Code';
        const code = stockCode(item, isAccount ? 'ACC' : 'CODE');
        const lines = [`**📦 ${heading} #${i + 1} / ${total}** (Mã: ${code})`];

        if (isAccount) {
            lines.push(`> 👤 Tài khoản: \`${item.content}\``);
            if (item.password) lines.push(`> 🔑 Mật khẩu: \`${item.password}\``);
        } else {
            lines.push(`> 🎟️ Code: \`${item.content}\``);
        }

        // Mô tả riêng cố tình KHÔNG giao ở đây - nó chỉ để khách xem lúc chọn hàng.
        if (email) lines.push(`> 📧 Email: \`${email}\``);
        if (warranty) lines.push(`> 🛡️ Bảo hành: \`${warranty}\``);

        return new EmbedBuilder().setColor(ITEM_COLOR).setDescription(lines.join('\n'));
    });
}

const DELIVERY_DONE_NOTE =
    '⚠️ *Quá trình giao hàng hoàn tất. Quý khách vui lòng lưu thông tin và đổi mật khẩu ngay lập tức để bảo vệ tài khoản!*';

// ═══════════════════════════════════════════════════
// HÀNG ĐẶC BIỆT - CHỜ ADMIN XÉT DUYỆT
// ═══════════════════════════════════════════════════
// Khách vẫn quét QR trả tiền như thường, nhưng hàng không tự bay đi: đơn dừng ở
// trạng thái "paid" cho tới khi admin bấm duyệt và nhập nội dung giao.

// Báo cho khách: đã nhận tiền, đang chờ duyệt.
function specialWaitingEmbed(order) {
    return new EmbedBuilder()
        .setTitle('⏳ ĐƠN HÀNG ĐANG CHỜ XÉT DUYỆT')
        .setDescription(
            `Đơn hàng **${order.reference}** đã thanh toán thành công!\n\n` +
            `🛒 **Sản phẩm:** \`${order.productName}\` (x${order.quantity})\n` +
            `💰 **Đã thanh toán:** \`${order.totalAmount.toLocaleString()} VNĐ\`\n\n` +
            `📌 **Tiến trình:**\n` +
            `> ⭐ Đây là sản phẩm **đặc biệt**, cần quản trị viên xét duyệt trước khi giao.\n` +
            `> 📨 Hãy mở **Nhận tin nhắn từ người lạ** để Bot gửi hàng được.\n` +
            `> 💬 Nếu chờ lâu, vui lòng liên hệ quản trị viên kèm mã đơn ở trên.`
        )
        .setColor(WARNING_COLOR)
        .setFooter(FOOTER)
        .setTimestamp();
}

// Báo cho admin ở kênh xét duyệt, kèm nút mở ô nhập nội dung giao.
function specialAdminAlertEmbed(order, userId, items = []) {
    const danhSach = items.length
        ? items.map((it, i) => `> ${i + 1}. \`${it.content}\`${it.password ? ` / \`${it.password}\`` : ''}`).join('\n')
        : '> *(không có dữ liệu kho)*';

    return new EmbedBuilder()
        .setTitle('⭐ ĐƠN HÀNG ĐẶC BIỆT CHỜ DUYỆT')
        .setDescription(
            `Khách <@${userId}> đã thanh toán, đơn đang chờ bạn xét duyệt.\n\n` +
            `🏷️ **Mã đơn:** \`${order.reference}\`\n` +
            `🛒 **Sản phẩm:** \`${order.productName}\` (x${order.quantity})\n` +
            `💰 **Số tiền:** \`${order.totalAmount.toLocaleString()} VNĐ\`\n\n` +
            `📦 **Hàng đã giữ trong kho:**\n${danhSach}\n\n` +
            `👉 Bấm nút bên dưới để nhập nội dung gửi cho khách.\n` +
            `*Không duyệt thì cứ để đó, đơn vẫn giữ nguyên trạng thái chờ.*`
        )
        .setColor(WARNING_COLOR)
        .setFooter(FOOTER)
        .setTimestamp();
}

function specialApproveButton(orderRef) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`admin_approve_${orderRef}`)
            .setLabel('✅ Duyệt & Gửi Hàng')
            .setStyle(ButtonStyle.Success)
    );
}

// Nội dung admin nhập, gửi thẳng cho khách.
function specialDeliveredEmbed(order) {
    return new EmbedBuilder()
        .setTitle('🎉 ĐƠN HÀNG ĐÃ ĐƯỢC DUYỆT')
        .setDescription(
            `Đơn hàng **${order.reference}** đã được quản trị viên duyệt!\n\n` +
            `🛒 **Sản phẩm:** \`${order.productName}\` (x${order.quantity})\n` +
            `💰 **Đã thanh toán:** \`${order.totalAmount.toLocaleString()} VNĐ\`\n\n` +
            `📦 **THÔNG TIN SẢN PHẨM CỦA BẠN:**\n` +
            '```\n' + (order.deliveryContent || '(trống)') + '\n```\n' +
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
    shopWelcomeEmbed,
    specialWaitingEmbed,
    specialAdminAlertEmbed,
    specialApproveButton,
    specialDeliveredEmbed,
    deliveryEmbed,
    deliveryItemEmbeds,
    DELIVERY_DONE_NOTE,
    vipWaitingEmbed,
    vipAdminAlertEmbed,
    vipDeliverButton,
    saleLogEmbed,
    shopMenuEmbed,
    shopMenuSelect,
    revenueStatsEmbed,
    accountItemEmbed
};
