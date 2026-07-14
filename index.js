/**
 * index.js - Entry point cho Kaiz Store Bot
 * 
 * Kiến trúc: Module-based, MongoDB, Discord.js v14
 * Chống bán trùng: Atomic MongoDB operations
 * Thanh toán: Web2M API Polling
 */
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const config = require('./config');
const db = require('./src/utils/database');
const logService = require('./src/services/logService');
const paymentService = require('./src/services/paymentService');
const interactionHandler = require('./src/events/interactionCreate');
const readyHandler = require('./src/events/ready');
const messageHandler = require('./src/events/messageCreate');
const autoImporter = require('./src/utils/autoImporter');
const statsService = require('./src/services/statsService');
const fs = require('fs');

// Watch .env for changes to support hot-reloading banks
fs.watchFile('.env', (curr, prev) => {
    if (curr.mtime !== prev.mtime) {
        console.log('[System] Đã tự động cập nhật cấu hình Ngân hàng mới từ .env!');
        config.reload();
    }
});

// ═══════════════════════════════════════════════════
// 1. KHỞI TẠO DISCORD CLIENT
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
// 2. KẾT NỐI MONGODB
// ═══════════════════════════════════════════════════
async function start() {
    // Kết nối MongoDB trước
    await db.connect();

    // Inject client vào các service cần dùng
    logService.setClient(client);
    paymentService.setClient(client);
    statsService.setClient(client);

    // ═══════════════════════════════════════
    // 3. SỰ KIỆN DISCORD & TÁC VỤ NGẦM
    // ═══════════════════════════════════════
    client.once('ready', async () => {
        await readyHandler.handle(client);
        // Bắt đầu quét thư mục auto-import
        autoImporter.start();
        // Bắt đầu cập nhật thống kê doanh thu
        statsService.start();
    });

    client.on('interactionCreate', async (interaction) => {
        await interactionHandler.handle(interaction);
    });

    client.on('messageCreate', async (message) => {
        await messageHandler.handle(message);
    });

    // ═══════════════════════════════════════
    // 4. XỬ LÝ LỖI TOÀN CỤC
    // ═══════════════════════════════════════
    client.on('error', (err) => {
        console.error('[Discord] Client error:', err);
        logService.error('discord_client', err.message);
    });

    process.on('unhandledRejection', (err) => {
        console.error('[Process] Unhandled rejection:', err);
        logService.error('unhandled_rejection', err.message || String(err));
    });

    process.on('uncaughtException', (err) => {
        console.error('[Process] Uncaught exception:', err);
        logService.error('uncaught_exception', err.message);
    });

    // ═══════════════════════════════════════
    // 5. ĐĂNG NHẬP
    // ═══════════════════════════════════════
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
