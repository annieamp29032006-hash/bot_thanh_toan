/**
 * shopFlowHandler.js - Luồng mua hàng cho KHÁCH (MongoDB, danh mục 2 cấp).
 *
 * Tất cả đều là NÚT BẤM, không dùng dropdown, và đều sửa tại chỗ trên cùng một
 * tin nhắn ẩn (ephemeral) bằng interaction.update - khách không bị trôi tin nhắn.
 *
 *   1. Danh mục cấp 1   (open_shop_menu / mroot)  -> mc1_<key>
 *   2. Danh mục cấp 2   (mc1_<key>)               -> mc2_<key>      | back: mroot
 *   3. Sản phẩm         (mc2_<key>)               -> mprod_<id>     | back: mc1_<parent>
 *   4. Chi tiết + SL    (mprod_<id>)              -> mbuy_<id>_<sl> | back: mc2_<key>
 *   5. QR thanh toán    (mbuy_...)                -> mcancel_<ref>
 *
 * Phân trang cũng bằng nút: mc2p_/mprodp_<key>_<trang>.
 *
 * Giới hạn Discord: tối đa 5 hàng x 5 nút = 25 component mỗi tin nhắn. Chừa 1 hàng
 * cho điều hướng nên mỗi trang hiển thị tối đa 20 mục.
 */
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');
const catalog = require('../services/catalogService');
const orderService = require('../services/orderService');

const BRAND = '#00D8FF';
const GOLD = '#FFD700';
const DANGER = '#ff4d4d';
const PER_PAGE = 20;      // 4 hàng x 5 nút
const QTY_CHOICES = [1, 2, 3, 5, 10];

function catEmoji(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('pubg')) return '🔫';
    if (n.includes('chân lý') || n.includes('tft')) return '⚔️';
    if (n.includes('liên quân')) return '🎮';
    if (n.includes('steam')) return '💳';
    if (n.includes('gcoin') || n.includes('coin')) return '🪙';
    if (n.includes('outfit') || n.includes('trang phục')) return '👕';
    if (n.includes('acc')) return '🎮';
    return '🛒';
}

function isEphemeral(interaction) {
    return interaction.message?.flags?.has(64);
}

async function replyOrUpdate(interaction, payload) {
    if (isEphemeral(interaction)) return interaction.update(payload);
    return interaction.reply({ ...payload, ephemeral: true });
}

/** Xếp danh sách mục thành các hàng nút, tối đa 5 nút mỗi hàng */
function buttonRows(items, makeButton, maxRows = 4) {
    const rows = [];
    let row = new ActionRowBuilder();
    items.forEach((it, i) => {
        if (i > 0 && i % 5 === 0) {
            rows.push(row);
            row = new ActionRowBuilder();
        }
        row.addComponents(makeButton(it));
    });
    if (row.components.length) rows.push(row);
    return rows.slice(0, maxRows);
}

/** Hàng điều hướng: quay lại + phân trang (nếu có) */
function navRow({ backId, backLabel, prevId, nextId }) {
    const row = new ActionRowBuilder();
    if (prevId) row.addComponents(new ButtonBuilder().setCustomId(prevId).setLabel('⬅️ Trang trước').setStyle(ButtonStyle.Primary));
    if (nextId) row.addComponents(new ButtonBuilder().setCustomId(nextId).setLabel('Trang sau ➡️').setStyle(ButtonStyle.Primary));
    if (backId) row.addComponents(new ButtonBuilder().setCustomId(backId).setLabel(backLabel || '⬅️ Quay lại').setStyle(ButtonStyle.Secondary));
    return row;
}

function paginate(all, page) {
    const totalPages = Math.max(1, Math.ceil(all.length / PER_PAGE));
    page = Math.min(Math.max(1, page), totalPages);
    return { items: all.slice((page - 1) * PER_PAGE, page * PER_PAGE), page, totalPages };
}

// ═══════════════════════════════════════════════════
// MÀN 1: DANH MỤC CẤP 1
// ═══════════════════════════════════════════════════
async function showRoots(interaction) {
    const roots = await catalog.getRootCategories();

    if (!roots.length) {
        return replyOrUpdate(interaction, {
            content: '🛠️ Hiện chưa có sản phẩm nào. Vui lòng quay lại sau!',
            embeds: [], components: []
        });
    }

    // Mỗi embed chỉ mang được một ảnh -> mỗi danh mục một embed để ảnh hiện ra.
    // Discord cho tối đa 10 embed mỗi tin nhắn.
    const shown = roots.slice(0, 9);
    const embeds = [
        new EmbedBuilder()
            .setTitle('🌟 DANH MỤC SẢN PHẨM')
            .setDescription('Chọn danh mục bạn muốn mua 👇')
            .setColor(BRAND)
    ];
    for (const r of shown) {
        const e = new EmbedBuilder()
            .setTitle(`${catEmoji(r.name)} ${r.name}`)
            .setDescription(`📦 Còn \`${r.avail}\` sản phẩm`)
            .setColor(BRAND);
        if (r.imageUrl) e.setThumbnail(r.imageUrl);
        embeds.push(e);
    }

    const rows = buttonRows(shown, r => new ButtonBuilder()
        .setCustomId(`mc1_${r.key}`)
        .setLabel(`${r.name} (${r.avail})`.slice(0, 80))
        .setEmoji(catEmoji(r.name))
        .setStyle(ButtonStyle.Primary), 5);

    return replyOrUpdate(interaction, { content: '', embeds, components: rows });
}

// ═══════════════════════════════════════════════════
// MÀN 2: DANH MỤC CẤP 2
// ═══════════════════════════════════════════════════
async function showChildren(interaction, parentKey, page = 1) {
    const parent = await catalog.getCategory(parentKey);
    const all = await catalog.getChildCategories(parentKey);

    if (!all.length) {
        return interaction.update({
            content: '🛠️ Danh mục này hiện đang hết hàng. Vui lòng chọn danh mục khác!',
            embeds: [],
            components: [navRow({ backId: 'mroot', backLabel: '⬅️ Về Danh Mục' })]
        });
    }

    const { items, page: p, totalPages } = paginate(all, page);
    const parentName = parent ? parent.name : parentKey;

    const embeds = [
        new EmbedBuilder()
            .setTitle(`${catEmoji(parentName)} ${parentName}`)
            .setDescription(
                `Chọn loại sản phẩm bạn quan tâm 👇` +
                (totalPages > 1 ? `\n\n📄 Trang **${p}/${totalPages}**` : '')
            )
            .setColor(BRAND)
    ];
    if (parent?.imageUrl) embeds[0].setThumbnail(parent.imageUrl);

    for (const c of items.slice(0, 9)) {
        const e = new EmbedBuilder()
            .setTitle(`${catEmoji(c.name)} ${c.name}`)
            .setDescription(`📦 Còn \`${c.avail}\` sản phẩm`)
            .setColor(BRAND);
        if (c.imageUrl) e.setThumbnail(c.imageUrl);
        embeds.push(e);
    }

    const rows = buttonRows(items, c => new ButtonBuilder()
        .setCustomId(`mc2_${c.key}`)
        .setLabel(`${c.name} (${c.avail})`.slice(0, 80))
        .setStyle(ButtonStyle.Secondary));

    rows.push(navRow({
        backId: 'mroot',
        backLabel: '⬅️ Về Danh Mục',
        prevId: p > 1 ? `mc2p_${parentKey}_${p - 1}` : null,
        nextId: p < totalPages ? `mc2p_${parentKey}_${p + 1}` : null
    }));

    return interaction.update({ content: '', embeds, components: rows });
}

// ═══════════════════════════════════════════════════
// MÀN 3: SẢN PHẨM
// ═══════════════════════════════════════════════════
async function showProducts(interaction, childKey, page = 1) {
    const cat = await catalog.getCategory(childKey);
    const all = await catalog.getProducts(childKey);
    const backId = cat?.parentKey ? `mc1_${cat.parentKey}` : 'mroot';

    if (!all.length) {
        return interaction.update({
            content: '⚠️ Danh mục này vừa hết hàng. Vui lòng chọn mục khác!',
            embeds: [],
            components: [navRow({ backId, backLabel: '⬅️ Quay lại' })]
        });
    }

    const { items, page: p, totalPages } = paginate(all, page);
    const catName = cat ? cat.name : childKey;

    const embed = new EmbedBuilder()
        .setTitle(`📦 ${catName}`)
        .setDescription(
            `Đang có **${all.length}** sản phẩm. Bấm vào sản phẩm để xem chi tiết & mua 👇` +
            (totalPages > 1 ? `\n\n📄 Trang **${p}/${totalPages}**` : '')
        )
        .setColor(BRAND);
    if (cat?.imageUrl) embed.setThumbnail(cat.imageUrl);

    for (const pr of items.slice(0, 20)) {
        embed.addFields({
            name: pr.name.slice(0, 250),
            value: `💰 \`${pr.price.toLocaleString('vi-VN')}đ\` • 📦 Còn \`${pr.avail}\``,
            inline: true
        });
    }

    const rows = buttonRows(items, pr => new ButtonBuilder()
        .setCustomId(`mprod_${pr.id}`)
        .setLabel(`${pr.name}`.slice(0, 80))
        .setEmoji('🛒')
        .setStyle(ButtonStyle.Secondary));

    rows.push(navRow({
        backId,
        backLabel: '⬅️ Quay lại',
        prevId: p > 1 ? `mprodp_${childKey}_${p - 1}` : null,
        nextId: p < totalPages ? `mprodp_${childKey}_${p + 1}` : null
    }));

    return interaction.update({ content: '', embeds: [embed], components: rows });
}

// ═══════════════════════════════════════════════════
// MÀN 4: CHI TIẾT SẢN PHẨM + CHỌN SỐ LƯỢNG (nút)
// ═══════════════════════════════════════════════════
async function showDetail(interaction, productId) {
    const p = await catalog.getProduct(productId);
    if (!p || p.avail === 0) {
        return interaction.update({
            content: '⚠️ Sản phẩm này vừa hết hàng hoặc có người khác đang mua. Vui lòng chọn sản phẩm khác!',
            embeds: [],
            components: [navRow({ backId: 'mroot', backLabel: '⬅️ Về Danh Mục' })]
        });
    }

    let desc = `💰 **Giá:** \`${p.price.toLocaleString('vi-VN')}đ\` / sản phẩm\n` +
               `📦 **Còn lại:** \`${p.avail}\` sản phẩm\n`;
    if (p.description) {
        const lines = p.description.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 12);
        if (lines.length) desc += `\n**Thông tin sản phẩm:**\n` + lines.map(l => `> 🔹 ${l}`).join('\n');
    }
    desc += `\n\n*Thông tin đăng nhập/code sẽ được gửi ngay vào tin nhắn riêng sau khi thanh toán.*` +
            `\n\n**Chọn số lượng cần mua 👇**`;

    const embed = new EmbedBuilder()
        .setTitle(`🛒 ${p.name}`)
        .setDescription(desc)
        .setColor(GOLD);
    if (p.imageUrl) embed.setImage(p.imageUrl);

    // VIP chỉ bán 1 mỗi đơn (orderService cũng ép lại, đây chỉ là hiển thị)
    const maxQty = p.type === 'vip' ? 1 : p.avail;
    const choices = QTY_CHOICES.filter(n => n <= maxQty);
    if (!choices.length) choices.push(1);

    const rows = buttonRows(choices, n => new ButtonBuilder()
        .setCustomId(`mbuy_${p.id}_${n}`)
        .setLabel(`Mua ${n} — ${(n * p.price).toLocaleString('vi-VN')}đ`.slice(0, 80))
        .setStyle(ButtonStyle.Success), 4);

    rows.push(navRow({ backId: `mc2_${p.webCategory}`, backLabel: '⬅️ Quay lại' }));

    return interaction.update({ content: '', embeds: [embed], components: rows });
}

// ═══════════════════════════════════════════════════
// MÀN 5: TẠO ĐƠN + QR
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
        const p = await catalog.getProduct(productId);
        return interaction.editReply({
            content: `❌ ${result.message}`,
            embeds: [],
            components: [navRow({
                backId: p ? `mc2_${p.webCategory}` : 'mroot',
                backLabel: '⬅️ Quay lại'
            })]
        });
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`mcancel_${result.order.reference}`)
            .setLabel('❌ Hủy giao dịch')
            .setStyle(ButtonStyle.Danger)
    );
    return interaction.editReply({
        content: '',
        embeds: [paymentEmbed(result.order, result.qrUrl)],
        components: [row]
    });
}

// ═══════════════════════════════════════════════════
// HỦY ĐƠN
// ═══════════════════════════════════════════════════
async function cancelOrder(interaction, reference) {
    await interaction.deferUpdate();

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
            new ButtonBuilder().setCustomId('mroot').setLabel('🛒 Mua hàng tiếp').setStyle(ButtonStyle.Success)
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

/** Tách "<key>_<số trang>" - key có thể chứa '_' nên cắt từ phải sang */
function splitPage(rest) {
    const i = rest.lastIndexOf('_');
    return { key: rest.slice(0, i), page: parseInt(rest.slice(i + 1)) || 1 };
}

// ═══════════════════════════════════════════════════
// ROUTER: trả về true nếu đã xử lý interaction
// ═══════════════════════════════════════════════════
async function route(interaction) {
    if (!interaction.isButton()) return false;
    const id = interaction.customId;

    if (id === 'open_shop_menu' || id === 'mroot' || id === 'mcats') { await showRoots(interaction); return true; }

    // Phân trang phải kiểm tra TRƯỚC vì tiền tố dài hơn dễ bị prefix ngắn nuốt mất
    if (id.startsWith('mc2p_')) {
        const { key, page } = splitPage(id.slice(5));
        await showChildren(interaction, key, page); return true;
    }
    if (id.startsWith('mprodp_')) {
        const { key, page } = splitPage(id.slice(7));
        await showProducts(interaction, key, page); return true;
    }

    if (id.startsWith('mc1_')) { await showChildren(interaction, id.slice(4), 1); return true; }
    if (id.startsWith('mc2_')) { await showProducts(interaction, id.slice(4), 1); return true; }
    if (id.startsWith('mprod_')) { await showDetail(interaction, id.slice(6)); return true; }
    if (id.startsWith('mbuy_')) {
        const rest = id.slice(5);
        const i = rest.lastIndexOf('_');
        await createOrderAndShowQR(interaction, rest.slice(0, i), parseInt(rest.slice(i + 1)) || 1);
        return true;
    }
    if (id.startsWith('mcancel_')) { await cancelOrder(interaction, id.slice(8)); return true; }

    return false;
}

module.exports = { route, showCategories: showRoots };
