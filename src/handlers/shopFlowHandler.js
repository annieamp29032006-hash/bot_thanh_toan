/**
 * shopFlowHandler.js - Luồng mua hàng cho KHÁCH, đọc sản phẩm từ MongoDB.
 *
 * Màn hình (đều là tin nhắn ẩn - ephemeral, điều hướng bằng interaction.update):
 *   1. Danh mục     (open_shop_menu / mcats)  -> nút mcat_<categoryKey>
 *   2. Sản phẩm     (mcat_<key> / mppg_)      -> select mpsel_<key>, có phân trang
 *   3. Chi tiết+SL  (mpsel chọn productId)    -> select mqty_<productId>
 *   4. QR thanh toán(mqty chọn số lượng)      -> nút mcancel_<reference>
 *
 * So với bản MariaDB cũ: bỏ một cấp. Maria tách "nhóm" và "biến thể" vì giá nằm ở
 * từng dòng list_items; trong Mongo thì Product đã mang sẵn giá nên chọn thẳng
 * sản phẩm. Luồng thanh toán phía sau giữ nguyên không đổi.
 *
 * customId dùng prefix "m..." để không đụng các handler khác.
 */
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder
} = require('discord.js');
const catalog = require('../services/catalogService');
const orderService = require('../services/orderService');

const BRAND = '#00D8FF';
const GOLD = '#FFD700';
const DANGER = '#ff4d4d';
const PRODUCTS_PER_PAGE = 24;

function catEmoji(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('pubg')) return '🔫';
    if (n.includes('chân lý') || n.includes('tft')) return '⚔️';
    if (n.includes('liên quân')) return '🎮';
    if (n.includes('steam')) return '💳';
    if (n.includes('gcoin') || n.includes('coin')) return '🪙';
    if (n.includes('outfit') || n.includes('trang phục')) return '👕';
    return '🛒';
}

// Tin nhắn hiện tại có phải ephemeral không (để chọn update vs reply)
function isEphemeral(interaction) {
    return interaction.message?.flags?.has(64);
}

async function replyOrUpdate(interaction, payload) {
    if (isEphemeral(interaction)) {
        return interaction.update(payload);
    }
    return interaction.reply({ ...payload, ephemeral: true });
}

function backRow(customId, label) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(ButtonStyle.Secondary)
    );
}

// ═══════════════════════════════════════════════════
// 1. MÀN DANH MỤC
// ═══════════════════════════════════════════════════
async function showCategories(interaction) {
    const cats = await catalog.getCategories();

    if (cats.length === 0) {
        return replyOrUpdate(interaction, {
            content: '🛠️ Hiện chưa có sản phẩm nào. Vui lòng quay lại sau!',
            embeds: [], components: []
        });
    }

    const embed = new EmbedBuilder()
        .setTitle('🌟 DANH MỤC SẢN PHẨM')
        .setDescription('Vui lòng chọn danh mục bạn muốn mua bên dưới 👇')
        .setColor(BRAND);

    // Danh mục đầu tiên có ảnh thì lấy làm ảnh minh họa cho màn này
    const withImg = cats.find(c => c.imageUrl);
    if (withImg) embed.setThumbnail(withImg.imageUrl);

    const rows = [];
    let row = new ActionRowBuilder();
    cats.slice(0, 20).forEach((c, i) => {
        if (i > 0 && i % 5 === 0) { rows.push(row); row = new ActionRowBuilder(); }
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`mcat_${c.key}`)
                .setLabel(`${c.name} (${c.avail})`.slice(0, 80))
                .setEmoji(catEmoji(c.name))
                .setStyle(ButtonStyle.Primary)
        );
    });
    if (row.components.length) rows.push(row);

    return replyOrUpdate(interaction, { content: '', embeds: [embed], components: rows.slice(0, 5) });
}

// ═══════════════════════════════════════════════════
// 2. MÀN SẢN PHẨM trong danh mục (select + phân trang)
// ═══════════════════════════════════════════════════
async function showProducts(interaction, categoryKey, page = 1) {
    const cat = await catalog.getCategory(categoryKey);
    const all = await catalog.getProducts(categoryKey);

    if (all.length === 0) {
        return interaction.update({
            content: '🛠️ Danh mục này hiện đang hết hàng. Vui lòng quay lại sau!',
            embeds: [],
            components: [backRow('mcats', '⬅️ Về Danh Mục')]
        });
    }

    const totalPages = Math.max(1, Math.ceil(all.length / PRODUCTS_PER_PAGE));
    page = Math.min(Math.max(1, page), totalPages);
    const items = all.slice((page - 1) * PRODUCTS_PER_PAGE, page * PRODUCTS_PER_PAGE);

    const catName = cat ? cat.name : categoryKey;
    const embed = new EmbedBuilder()
        .setTitle(`${catEmoji(catName)} ${catName}`)
        .setDescription(
            `Đang có **${all.length}** sản phẩm. Chọn sản phẩm bên dưới để xem chi tiết & mua.` +
            (totalPages > 1 ? `\n\n📄 Trang **${page}/${totalPages}**` : '')
        )
        .setColor(BRAND);
    if (cat?.imageUrl) embed.setThumbnail(cat.imageUrl);

    const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`mpsel_${categoryKey}`)
            .setPlaceholder('🔽 Chọn sản phẩm để xem chi tiết...')
            .addOptions(items.map(p => ({
                label: p.name.slice(0, 90),
                value: p.id,
                description: `${p.price.toLocaleString('vi-VN')}đ • Còn ${p.avail}`.slice(0, 90),
                emoji: '🛒'
            })))
    );

    const components = [selectRow];

    if (totalPages > 1) {
        const nav = new ActionRowBuilder();
        if (page > 1) nav.addComponents(new ButtonBuilder().setCustomId(`mppg_${categoryKey}_${page - 1}`).setLabel('⬅️ Trang trước').setStyle(ButtonStyle.Primary));
        if (page < totalPages) nav.addComponents(new ButtonBuilder().setCustomId(`mppg_${categoryKey}_${page + 1}`).setLabel('Trang sau ➡️').setStyle(ButtonStyle.Primary));
        if (nav.components.length) components.push(nav);
    }
    components.push(backRow('mcats', '⬅️ Về Danh Mục'));

    return interaction.update({ content: '', embeds: [embed], components });
}

// ═══════════════════════════════════════════════════
// 3. MÀN CHI TIẾT SẢN PHẨM + CHỌN SỐ LƯỢNG
// ═══════════════════════════════════════════════════
async function showDetail(interaction, productId) {
    const p = await catalog.getProduct(productId);
    if (!p || p.avail === 0) {
        return interaction.update({
            content: '⚠️ Sản phẩm này vừa hết hàng hoặc có người khác đang mua. Vui lòng chọn sản phẩm khác!',
            embeds: [], components: [backRow('mcats', '⬅️ Về Danh Mục')]
        });
    }

    let desc = `💰 **Giá:** \`${p.price.toLocaleString('vi-VN')}đ\` / sản phẩm\n📦 **Còn lại:** \`${p.avail}\` sản phẩm\n`;
    if (p.description) {
        const lines = p.description.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 12);
        if (lines.length) desc += `\n**Thông tin sản phẩm:**\n` + lines.map(l => `> 🔹 ${l}`).join('\n');
    }
    desc += `\n\n*Thông tin đăng nhập/code sẽ được gửi ngay vào tin nhắn riêng sau khi thanh toán.*`;

    const embed = new EmbedBuilder()
        .setTitle(`🛒 ${p.name}`)
        .setDescription(desc)
        .setColor(GOLD);
    if (p.imageUrl) embed.setImage(p.imageUrl);

    // VIP chỉ bán 1 mỗi đơn (orderService cũng ép lại, đây chỉ là phần hiển thị)
    const maxQty = p.type === 'vip' ? 1 : p.avail;
    const qtyChoices = [1, 2, 3, 5, 10].filter(n => n <= maxQty);
    if (qtyChoices.length === 0) qtyChoices.push(1);

    const qtyRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`mqty_${p.id}`)
            .setPlaceholder('🧮 Chọn số lượng cần mua...')
            .addOptions(qtyChoices.map(n => ({
                label: `Mua ${n} sản phẩm`,
                value: String(n),
                description: `Tổng: ${(n * p.price).toLocaleString('vi-VN')}đ`
            })))
    );

    return interaction.update({
        content: '',
        embeds: [embed],
        components: [qtyRow, backRow(`mcat_${p.webCategory}`, '⬅️ Về danh sách')]
    });
}

// ═══════════════════════════════════════════════════
// 4. TẠO ĐƠN + HIỂN THỊ QR
// ═══════════════════════════════════════════════════
async function createOrderAndShowQR(interaction, productId, quantity) {
    await interaction.deferUpdate();

    // interaction.token cho phép sửa lại chính tin nhắn ẩn này khi thanh toán xong
    const result = await orderService.createOrder(
        interaction.user.id,
        interaction.user.username,
        productId,
        quantity,
        interaction.token
    );

    if (!result.success) {
        return interaction.editReply({ content: `❌ ${result.message}`, embeds: [], components: [] });
    }

    const embed = paymentEmbed(result.order, result.qrUrl);
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`mcancel_${result.order.reference}`)
            .setLabel('❌ Hủy giao dịch')
            .setStyle(ButtonStyle.Danger)
    );
    return interaction.editReply({ content: '', embeds: [embed], components: [row] });
}

// ═══════════════════════════════════════════════════
// HỦY ĐƠN
// ═══════════════════════════════════════════════════
async function cancelOrder(interaction, reference) {
    await interaction.deferUpdate();

    // Chỉ chủ đơn mới được hủy - customId nằm trong tin ẩn nhưng vẫn kiểm tra cho chắc
    const order = await orderService.findByReference(reference);
    if (!order) {
        return interaction.editReply({ content: '❌ Không tìm thấy đơn hàng.', embeds: [], components: [] });
    }
    if (String(order.userId) !== interaction.user.id) {
        return interaction.editReply({ content: '❌ Đây không phải đơn của bạn.', embeds: [], components: [] });
    }

    const result = await orderService.cancelOrder(reference);
    if (!result.success) {
        return interaction.editReply({ content: `❌ ${result.message}`, embeds: [], components: [] });
    }

    return interaction.editReply({
        content: `✅ Đã hủy giao dịch **${reference}**.`,
        embeds: [],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('open_shop_menu').setLabel('🛒 Mua hàng tiếp').setStyle(ButtonStyle.Success)
        )]
    });
}

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════
function paymentEmbed(order, qrUrl) {
    return new EmbedBuilder()
        .setTitle('💳 THÔNG TIN THANH TOÁN')
        .setDescription(
            `Cảm ơn bạn đã đặt hàng! Quét mã QR bên dưới để thanh toán.\n\n` +
            `🛒 **Sản phẩm:** \`${order.productName}\`\n` +
            `📝 **Số lượng:** \`${order.quantity}\`\n` +
            `🏷️ **Mã đơn:** \`${order.reference}\`\n\n` +
            `⚠️ **LƯU Ý:**\n` +
            `> Bạn **BẮT BUỘC** chuyển **ĐÚNG SỐ TIỀN** dưới đây (kể cả số lẻ).\n` +
            `> KHÔNG cần ghi nội dung chuyển khoản.\n` +
            `> Hệ thống tự động duyệt & giao hàng qua tin nhắn riêng (DM).\n\n` +
            `💰 **Số tiền cần chuyển:** \`${Number(order.totalAmount).toLocaleString('vi-VN')} VNĐ\``
        )
        .setImage(qrUrl)
        .setColor(DANGER)
        .setFooter({ text: `Tự hủy nếu quá thời gian chưa thanh toán | Kaiz Store` })
        .setTimestamp();
}

// ═══════════════════════════════════════════════════
// ROUTER: trả về true nếu đã xử lý interaction
// ═══════════════════════════════════════════════════
async function route(interaction) {
    if (interaction.isButton()) {
        const id = interaction.customId;
        if (id === 'open_shop_menu' || id === 'mcats') { await showCategories(interaction); return true; }
        if (id.startsWith('mppg_')) {
            // mppg_<categoryKey>_<page> - key có thể chứa '_' nên cắt page từ phải sang
            const rest = id.slice(5);
            const i = rest.lastIndexOf('_');
            await showProducts(interaction, rest.slice(0, i), parseInt(rest.slice(i + 1)));
            return true;
        }
        if (id.startsWith('mcat_')) { await showProducts(interaction, id.slice(5), 1); return true; }
        if (id.startsWith('mcancel_')) { await cancelOrder(interaction, id.slice(8)); return true; }
        return false;
    }

    if (interaction.isStringSelectMenu()) {
        const id = interaction.customId;
        if (id.startsWith('mpsel_')) { await showDetail(interaction, interaction.values[0]); return true; }
        if (id.startsWith('mqty_')) {
            await createOrderAndShowQR(interaction, id.slice(5), parseInt(interaction.values[0]));
            return true;
        }
        return false;
    }

    return false;
}

module.exports = { route, showCategories };
