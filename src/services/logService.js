/**
 * logService.js - Log ra console + (tùy chọn) gửi vào kênh Discord.
 * Đã bỏ phụ thuộc MongoDB. Giữ nguyên API để các module khác không phải sửa.
 */
const config = require('../../config');
const { EmbedBuilder } = require('discord.js');

let _client = null;
function setClient(client) { _client = client; }

async function system(action, message) {
    console.log(`[System:${action}] ${message}`);
    await sendToChannel('SYSTEM_LOG', '⚙️ ' + message, '#95A5A6');
}

async function error(action, message) {
    console.error(`[Error:${action}] ${message}`);
    await sendToChannel('SYSTEM_LOG', '❌ ' + message, '#E74C3C');
}

async function codeSale(order, embed) { await sendEmbedToChannel('LOG_CODE', embed); }
async function vipSale(order, embed) { await sendEmbedToChannel('LOG_VIP', embed); }
async function accountSale(order, embed) { await sendEmbedToChannel('LOG_ACCOUNT', embed); }
async function sendToVipLog(embed, components = []) { await sendEmbedToChannel('LOG_VIP', embed, components); }

async function bankTransfer(order, tx) {
    const amount = parseInt(tx.amount || tx.value || tx.money || 0);
    const txId = tx.id || tx.transactionId || tx.tid || tx.tranId || '';
    console.log(`[Bank] +${amount}đ (GD ${txId}) khớp đơn ${order.reference || ''}`);
    const embed = new EmbedBuilder()
        .setTitle('🏦 CHUYỂN KHOẢN THÀNH CÔNG')
        .setDescription(
            `✅ Nhận ${amount.toLocaleString('vi-VN')} VNĐ (Mã GD: \`${txId}\`)\n` +
            `🔗 Khớp đơn: \`${order.reference || ''}\``
        )
        .setColor('#2ECC71')
        .setTimestamp();
    await sendEmbedToChannel('SYSTEM_LOG', embed);
}

// ── Helpers gửi kênh Discord (chỉ dùng config.CHANNELS) ──
function getChannelId(channelKey) {
    return config.CHANNELS[channelKey] || '';
}

async function sendToChannel(channelKey, message, color = '#95A5A6') {
    if (!_client) return;
    try {
        const channelId = getChannelId(channelKey);
        if (!channelId) return;
        const channel = _client.channels.cache.get(channelId);
        if (!channel) return;
        const embed = new EmbedBuilder().setDescription(message).setColor(color).setTimestamp();
        await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error(`[LogService] Lỗi gửi kênh ${channelKey}:`, err.message);
    }
}

async function sendEmbedToChannel(channelKey, embed, components = []) {
    if (!_client) return;
    try {
        const channelId = getChannelId(channelKey);
        if (!channelId) return;
        const channel = _client.channels.cache.get(channelId);
        if (!channel) return;
        await channel.send({ embeds: [embed], components });
    } catch (err) {
        console.error(`[LogService] Lỗi gửi embed kênh ${channelKey}:`, err.message);
    }
}

module.exports = {
    setClient, system, error, codeSale, vipSale, accountSale,
    bankTransfer, sendToChannel, sendEmbedToChannel, sendToVipLog
};
