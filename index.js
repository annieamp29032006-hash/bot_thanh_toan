/**
 * index.js - Entry point cho Kaiz Store Bot
 *
 * Kiến trúc: Discord.js v14 + MariaDB (đọc sản phẩm trực tiếp từ web shop).
 * Chống bán trùng: khóa list_items atomic (status 2).
 * Thanh toán: Vietcombank QR + Web2M Poller (khớp số tiền lẻ độc nhất).
 */
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const config = require('./config');
const db = require('./src/utils/mariadb');
const logService = require('./src/services/logService');
const paymentService = require('./src/services/mariaPaymentService');
const vcbPoller = require('./src/utils/vcbPoller');
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

    client.once('ready', async () => {
        await readyHandler.handle(client);
        // Poller VCB: dò thanh toán + tự hủy đơn hết hạn
        vcbPoller.start();
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
}

start().catch(err => {
    console.error('❌ Lỗi khởi động bot:', err);
    process.exit(1);
});

module.exports = { client };
