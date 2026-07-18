/**
 * shopFlowHandler.js - Luồng mua hàng cho KHÁCH, đọc sản phẩm từ MariaDB.
 *
 * Màn hình (đều là tin nhắn ẩn - ephemeral, điều hướng bằng interaction.update):
 *   1. Danh mục       (open_shop_menu)         -> nút mcat_<catId>
 *   2. Nhóm sản phẩm  (mcat_<catId>)           -> nút mgrp_<groupId>
 *   3. Variant        (mgrp_<groupId> / mvpg_) -> select mvsel_<groupId>, phân trang
 *   4. Chi tiết + SL  (mvsel chọn repId)       -> select mqty_<repId>
 *   5. QR thanh toán  (mqty chọn số lượng)     -> nút mcancel_<reference>
 *
 * customId dùng prefix "m..." để không đụng các handler MongoDB cũ.
 */
const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder
} = require('discord.js');
const catalog = require('../services/catalogService');
const orderService = require('../services/mariaOrderService');

const BRAND = '#00D8FF';
const GOLD = '#FFD700';
const DANGER = '#ff4d4d';
const VARIANTS_PER_PAGE = 24;

// Danh mục -> emoji cho đẹp
function catEmoji(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('pubg')) return '🔫';
    if (n.includes('chân lý') || n.includes('tft')) return '⚔️';
    if (n.includes('liên quân')) return '🎮';
    if (n.includes('steam')) return '💳';
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

    const rows = [];
    let row = new ActionRowBuilder();
    cats.forEach((c, i) => {
        if (i > 0 && i % 5 === 0) { rows.push(row); row = new ActionRowBuilder(); }
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`mcat_${c.id}`)
                .setLabel(`${c.name} (${c.avail})`.slice(0, 80))
                .setEmoji(catEmoji(c.name))
                .setStyle(ButtonStyle.Primary)
        );
    });
    if (row.components.length) rows.push(row);

    return replyOrUpdate(interaction, { content: '', embeds: [embed], components: rows });
}

// ═══════════════════════════════════════════════════
// 2. MÀN NHÓM SẢN PHẨM trong danh mục
// ═══════════════════════════════════════════════════
async function showGroups(interaction, categoryId) {
    const groups = await catalog.getGroups(categoryId);

    if (groups.length === 0) {
        return interaction.update({
            content: '🛠️ Danh mục này hiện đang hết hàng. Vui lòng quay lại sau!',
            embeds: [],
            components: [backRow('mcats', '⬅️ Về Danh Mục')]
        });
    }

    const catName = groups[0].categoryName;
    const embed = new EmbedBuilder()
        .setTitle(`${catEmoji(catName)} ${catName}`)
        .setDescription('Chọn loại sản phẩm bạn quan tâm 👇')
        .setColor(BRAND);

    const rows = [];
    let row = new ActionRowBuilder();
    groups.slice(0, 20).forEach((g, i) => {
        if (i > 0 && i % 5 === 0) { rows.push(row); row = new ActionRowBuilder(); }
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`mgrp_${g.id}`)
                .setLabel(`${g.name}`.slice(0, 78))
                .setStyle(ButtonStyle.Secondary)
        );
        embed.addFields({
            name: g.name.slice(0, 250),
            value: `💰 Từ \`${g.minPrice.toLocaleString('vi-VN')}đ\` • 📦 Còn \`${g.avail}\` sản phẩm`,
            inline: false
        });
    });
    if (row.components.length) rows.push(row);
    rows.push(backRow('mcats', '⬅️ Về Danh Mục'));

    return interaction.update({ content: '', embeds: [embed], components: rows.slice(0, 5) });
}

// ═══════════════════════════════════════════════════
// 3. MÀN VARIANT (select menu + phân trang)
// ═══════════════════════════════════════════════════
async function showVariants(interaction, groupId, page = 1) {
    const group = await catalog.getGroup(groupId);
    if (!group) {
        return interaction.update({ content: '❌ Không tìm thấy nhóm sản phẩm.', embeds: [], components: [] });
    }

    const { items, total, totalPages } = await catalog.getVariants(groupId, page, VARIANTS_PER_PAGE);
    if (items.length === 0) {
        return interaction.update({
            content: '⚠️ Nhóm này hiện đang hết hàng.',
            embeds: [],
            components: [backRow(`mcat_${group.categoryId}`, '⬅️ Trở về')]
        });
    }

    const embed = new EmbedBuilder()
        .setTitle(`📦 ${group.name}`)
        .setDescription(
            `Đang có **${total}** loại sản phẩm. Chọn sản phẩm trong danh sách bên dưới để xem chi tiết & mua.` +
            (totalPages > 1 ? `\n\n📄 Trang **${page}/${totalPages}**` : '')
        )
        .setColor(BRAND);
    if (group.image) embed.setThumbnail(group.image);

    const options = items.map(v => ({
        label: v.name.slice(0, 90),
        value: String(v.repId),
        description: `${v.price.toLocaleString('vi-VN')}đ • Còn ${v.qty}`.slice(0, 90),
        emoji: '🛒'
    }));

    const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`mvsel_${groupId}`)
            .setPlaceholder('🔽 Chọn sản phẩm để xem chi tiết...')
            .addOptions(options)
    );

    const components = [selectRow];

    // Nút phân trang
    if (totalPages > 1) {
        const nav = new ActionRowBuilder();
        if (page > 1) nav.addComponents(new ButtonBuilder().setCustomId(`mvpg_${groupId}_${page - 1}`).setLabel('⬅️ Trang trước').setStyle(ButtonStyle.Primary));
        if (page < totalPages) nav.addComponents(new ButtonBuilder().setCustomId(`mvpg_${groupId}_${page + 1}`).setLabel('Trang sau ➡️').setStyle(ButtonStyle.Primary));
        if (nav.components.length) components.push(nav);
    }
    components.push(backRow(`mcat_${group.categoryId}`, '⬅️ Về nhóm'));

    return interaction.update({ content: '', embeds: [embed], components });
}

// ═══════════════════════════════════════════════════
// 4. MÀN CHI TIẾT SẢN PHẨM + CHỌN SỐ LƯỢNG
// ═══════════════════════════════════════════════════
async function showDetail(interaction, repId) {
    const v = await catalog.getVariantByRep(repId);
    if (!v || v.qty === 0) {
        return interaction.update({
            content: '⚠️ Sản phẩm này vừa hết hàng hoặc có người khác đang mua. Vui lòng chọn sản phẩm khác!',
            embeds: [], components: []
        });
    }

    let desc = `💰 **Giá:** \`${v.price.toLocaleString('vi-VN')}đ\` / sản phẩm\n📦 **Còn lại:** \`${v.qty}\` sản phẩm\n`;
    if (v.descLines.length > 0) {
        desc += `\n**Thông tin sản phẩm:**\n` + v.descLines.slice(0, 12).map(l => `> 🔹 ${l}`).join('\n');
    }
    desc += `\n\n*Thông tin đăng nhập/code sẽ được gửi ngay vào tin nhắn riêng sau khi thanh toán.*`;

    const embed = new EmbedBuilder()
        .setTitle(`🛒 ${v.name}`)
        .setDescription(desc)
        .setColor(GOLD);
    if (v.imageUrl) embed.setImage(v.imageUrl);

    // Select số lượng (giới hạn theo tồn kho)
    const qtyChoices = [1, 2, 3, 5, 10].filter(n => n <= v.qty);
    if (qtyChoices.length === 0) qtyChoices.push(1);
    const qtyRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`mqty_${repId}`)
            .setPlaceholder('🧮 Chọn số lượng cần mua...')
            .addOptions(qtyChoices.map(n => ({
                label: `Mua ${n} sản phẩm`,
                value: String(n),
                description: `Tổng: ${(n * v.price).toLocaleString('vi-VN')}đ`
            })))
    );

    return interaction.update({
        content: '',
        embeds: [embed],
        components: [qtyRow, backRow(`mgrp_${v.groupId}`, '⬅️ Về danh sách')]
    });
}

// ═══════════════════════════════════════════════════
// 5. TẠO ĐƠN + HIỂN THỊ QR
// ═══════════════════════════════════════════════════
async function createOrderAndShowQR(interaction, repId, quantity) {
    await interaction.deferUpdate();

    const result = await orderService.createOrder(
        interaction.user.id,
        interaction.user.username,
        repId,
        quantity,
        interaction.channelId
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
    const sent = await interaction.editReply({ content: '', embeds: [embed], components: [row] });

    // Ghi lại id tin nhắn QR để lát nữa thanh toán xong còn reply vào đúng nó.
    // Lỗi ở đây không được làm hỏng đơn - khách vẫn thấy QR bình thường.
    try {
        if (sent?.id) await orderService.attachMessageId(result.order.reference, sent.id);
    } catch (err) {
        console.error(`[Order] Không lưu được message_id cho ${result.order.reference}:`, err.message);
    }
    return sent;
}

// ═══════════════════════════════════════════════════
// HỦY ĐƠN
// ═══════════════════════════════════════════════════
async function cancelOrder(interaction, reference) {
    await interaction.deferUpdate();
    const result = await orderService.cancelOrder(reference, interaction.user.id);
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
function backRow(customId, label) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(ButtonStyle.Secondary)
    );
}

function paymentEmbed(order, qrUrl) {
    return new EmbedBuilder()
        .setTitle('💳 THÔNG TIN THANH TOÁN')
        .setDescription(
            `Cảm ơn bạn đã đặt hàng! Quét mã QR bên dưới để thanh toán.\n\n` +
            `🛒 **Sản phẩm:** \`${order.product_name}\`\n` +
            `📝 **Số lượng:** \`${order.quantity}\`\n` +
            `🏷️ **Mã đơn:** \`${order.reference}\`\n\n` +
            `⚠️ **LƯU Ý:**\n` +
            `> Bạn **BẮT BUỘC** chuyển **ĐÚNG SỐ TIỀN** dưới đây (kể cả số lẻ).\n` +
            `> KHÔNG cần ghi nội dung chuyển khoản.\n` +
            `> Hệ thống tự động duyệt & giao hàng qua tin nhắn riêng (DM).\n\n` +
            `💰 **Số tiền cần chuyển:** \`${order.amount.toLocaleString('vi-VN')} VNĐ\``
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
    // BUTTONS
    if (interaction.isButton()) {
        const id = interaction.customId;
        if (id === 'open_shop_menu' || id === 'mcats') { await showCategories(interaction); return true; }
        if (id.startsWith('mcat_')) { await showGroups(interaction, parseInt(id.slice(5))); return true; }
        if (id.startsWith('mgrp_')) { await showVariants(interaction, parseInt(id.slice(5)), 1); return true; }
        if (id.startsWith('mvpg_')) {
            const [, gid, page] = id.split('_');
            await showVariants(interaction, parseInt(gid), parseInt(page)); return true;
        }
        if (id.startsWith('mcancel_')) { await cancelOrder(interaction, id.slice(8)); return true; }
        return false;
    }

    // SELECT MENUS
    if (interaction.isStringSelectMenu()) {
        const id = interaction.customId;
        if (id.startsWith('mvsel_')) { await showDetail(interaction, parseInt(interaction.values[0])); return true; }
        if (id.startsWith('mqty_')) {
            const repId = parseInt(id.slice(5));
            await createOrderAndShowQR(interaction, repId, parseInt(interaction.values[0])); return true;
        }
        return false;
    }

    return false;
}

module.exports = { route, showCategories };
