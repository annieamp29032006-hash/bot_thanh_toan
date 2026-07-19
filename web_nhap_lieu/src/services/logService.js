/**
 * logService.js - Ghi log vào DB + gửi vào kênh Discord tương ứng
 */
const Log = require('../models/Log');
const settings = require('../models/Setting');
const config = require('../../config');
const { EmbedBuilder } = require('discord.js');

let _client = null;

function setClient(client) {
    _client = client;
}

/**
 * Ghi log hệ thống
 */
async function system(action, message, data = {}, userId = '') {
    try {
        await Log.create({ type: 'system', action, message, data, userId });
        await sendToChannel('SYSTEM_LOG', '⚙️ ' + message, '#95A5A6');
    } catch (err) {
        console.error('[LogService] Lỗi ghi system log:', err.message);
    }
}

/**
 * Ghi log lỗi
 */
async function error(action, message, data = {}) {
    try {
        await Log.create({ type: 'error', action, message, data });
        await sendToChannel('SYSTEM_LOG', '❌ ' + message, '#E74C3C');
    } catch (err) {
        console.error('[LogService] Lỗi ghi error log:', err.message);
    }
}

/**
 * Ghi log bán code thường
 */
async function codeSale(order, embed) {
    try {
        await Log.create({
            type: 'code_sale',
            action: 'sell',
            message: `Bán ${order.quantity}x ${order.productName} cho user ${order.userId}`,
            data: { reference: order.reference, amount: order.totalAmount },
            userId: order.userId,
            orderId: order._id
        });
        await sendEmbedToChannel('LOG_CODE', embed);
    } catch (err) {
        console.error('[LogService] Lỗi ghi code sale log:', err.message);
    }
}

/**
 * Ghi log bán VIP
 */
async function vipSale(order, embed) {
    try {
        await Log.create({
            type: 'vip_sale',
            action: 'sell',
            message: `Bán VIP ${order.productName} cho user ${order.userId}`,
            data: { reference: order.reference, amount: order.totalAmount, deliveredBy: order.deliveredBy },
            userId: order.userId,
            orderId: order._id
        });
        await sendEmbedToChannel('LOG_VIP', embed);
    } catch (err) {
        console.error('[LogService] Lỗi ghi vip sale log:', err.message);
    }
}

/**
 * Ghi log bán account
 */
async function accountSale(order, embed) {
    try {
        await Log.create({
            type: 'account_sale',
            action: 'sell',
            message: `Bán account ${order.productName} cho user ${order.userId}`,
            data: { reference: order.reference, amount: order.totalAmount },
            userId: order.userId,
            orderId: order._id
        });
        await sendEmbedToChannel('LOG_ACCOUNT', embed);
    } catch (err) {
        console.error('[LogService] Lỗi ghi account sale log:', err.message);
    }
}

// ──────────────────────────────────────────────
// Helpers gửi vào kênh Discord
// ──────────────────────────────────────────────

async function getChannelId(channelKey) {
    // Ưu tiên .env, fallback sang DB settings
    const envId = config.CHANNELS[channelKey];
    if (envId) return envId;
    return await settings.get(`ch_${channelKey.toLowerCase()}`);
}

async function sendToChannel(channelKey, message, color = '#95A5A6') {
    if (!_client) return;
    try {
        const channelId = await getChannelId(channelKey);
        if (!channelId) return;
        const channel = _client.channels.cache.get(channelId);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setDescription(message)
            .setColor(color)
            .setTimestamp();
        await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error(`[LogService] Lỗi gửi vào kênh ${channelKey}:`, err.message);
    }
}

async function sendEmbedToChannel(channelKey, embed, components = []) {
    if (!_client) return;
    try {
        const channelId = await getChannelId(channelKey);
        if (!channelId) return;
        const channel = _client.channels.cache.get(channelId);
        if (!channel) return;
        await channel.send({ embeds: [embed], components });
    } catch (err) {
        console.error(`[LogService] Lỗi gửi embed vào kênh ${channelKey}:`, err.message);
    }
}

async function sendToVipLog(embed, components = []) {
    await sendEmbedToChannel('LOG_VIP', embed, components);
}

/**
 * Ghi log chuyển khoản thành công
 */
async function bankTransfer(payment, tx) {
    try {
        const amount = parseInt(tx.amount || tx.value || tx.money || 0);
        const txId = tx.id || tx.transactionId || tx.tid || tx.tranId || '';
        const content = tx.description || tx.content || tx.addInfo || tx.comment || 'Không có nội dung';

        await Log.create({ 
            type: 'bank_transfer', 
            action: 'deposit', 
            message: `Nhận ${amount} VNĐ (Mã GD: ${txId}) khớp với đơn ${payment.reference}`, 
            data: { reference: payment.reference, amount, txId, content } 
        });

        const embed = new EmbedBuilder()
            .setTitle('🏦 CHUYỂN KHOẢN THÀNH CÔNG')
            .setDescription(
                `✅ Đã nhận được tiền qua hệ thống Bank/Momo!\n\n` +
                `**Mã GD:** \`${txId}\`\n` +
                `**Số tiền:** \`${amount.toLocaleString()} VNĐ\`\n` +
                `**Nội dung CK:** \`${content}\`\n\n` +
                `🔗 **Khớp với đơn hàng:** \`${payment.reference}\``
            )
            .setColor('#2ECC71')
            .setTimestamp();

        await sendEmbedToChannel('SYSTEM_LOG', embed);
    } catch (err) {
        console.error('[LogService] Lỗi ghi bank transfer log:', err.message);
    }
}

module.exports = {
    setClient,
    system,
    error,
    codeSale,
    vipSale,
    accountSale,
    bankTransfer,
    sendToChannel,
    sendEmbedToChannel,
    sendToVipLog
};
