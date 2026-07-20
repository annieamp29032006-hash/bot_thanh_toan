/**
 * index.js - Entry point cho Kaiz Store Bot
 *
 * Kiến trúc: Discord.js v14 + MongoDB (Category -> Product -> ProductStock).
 * Chống bán trùng: khóa ProductStock atomic trong transaction (cần replica set).
 * Thanh toán: QR ngân hàng + Webhook Web2M (khớp số tiền lẻ độc nhất).
 */
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const config = require('./config');
const db = require('./src/utils/database');
const logService = require('./src/services/logService');
const paymentService = require('./src/services/paymentService');
const orderExpiry = require('./src/utils/orderExpiry');
const webhookServer = require('./src/utils/webhookServer');
const approvalBot = require('./src/utils/approvalBot');
const modalHandler = require('./src/handlers/modalHandler');
const interactionHandler = require('./src/events/interactionCreate');
const readyHandler = require('./src/events/ready');
const messageHandler = require('./src/events/messageCreate');
const fs = require('fs');

// Hot-reload cấu hình ngân hàng khi .env đổi
fs.watchFile('.env', (curr, prev) => {
    if (curr.mtime !== prev.mtime) {
        console.log('[System] Đã tự động cập nhật cấu hình từ .env!');
        config.reload();
    }
});

// ═══════════════════════════════════════════════════
// 1. DISCORD CLIENT
// ═══════════════════════════════════════════════════
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message]
});

// ═══════════════════════════════════════════════════
// 2. KHỞI ĐỘNG
// ═══════════════════════════════════════════════════
async function start() {
    // Kết nối MariaDB
    await db.connect();

    // Inject client vào service cần gửi Discord
    logService.setClient(client);
    paymentService.setClient(client);
    // Hàng duyệt xong vẫn phải do bot chính DM cho khách, kể cả khi nút duyệt
    // được bấm ở bot phụ.
    modalHandler.setDmClient(client);

    client.once('ready', async () => {
        await readyHandler.handle(client);
        // Webhook: Web2M tự đẩy giao dịch sang - gần như tức thì
        webhookServer.start();
        // Dọn đơn quá hạn thanh toán, nhả hàng đang khóa về lại kho
        orderExpiry.start();
    });

    client.on('interactionCreate', async (interaction) => {
        await interactionHandler.handle(interaction);
    });

    client.on('messageCreate', async (message) => {
        await messageHandler.handle(message);
    });

    // ── Xử lý lỗi toàn cục ──
    client.on('error', (err) => {
        console.error('[Discord] Client error:', err);
        logService.error('discord_client', err.message);
    });

    process.on('unhandledRejection', (err) => {
        console.error('[Process] Unhandled rejection:', err);
    });

    process.on('uncaughtException', (err) => {
        console.error('[Process] Uncaught exception:', err);
    });

    if (!config.DISCORD_TOKEN) {
        console.error('❌ Thiếu DISCORD_TOKEN trong .env');
        process.exit(1);
    }

    await client.login(config.DISCORD_TOKEN);

    // Bot phụ chỉ phục vụ kênh xét duyệt. Chết cũng không được kéo bot chính chết
    // theo: cửa hàng vẫn phải bán được, cùng lắm thì thông báo duyệt về bot chính.
    try {
        await approvalBot.start();
    } catch (err) {
        console.error('❌ Bot xét duyệt không đăng nhập được:', err.message);
    }
}

start().catch(err => {
    console.error('❌ Lỗi khởi động bot:', err);
    process.exit(1);
});

module.exports = { client };
