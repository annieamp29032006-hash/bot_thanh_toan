/**
 * ready.js - Sự kiện Bot đã sẵn sàng
 */
const { REST, Routes } = require('discord.js');
const config = require('../../config');
const { commandMap } = require('./interactionCreate');
const logService = require('../services/logService');
const web2mPoller = require('../utils/web2mPoller');
const orderService = require('../services/orderService');

async function handle(client) {
    console.log(`✅ Bot đã đăng nhập: ${client.user.tag}`);

    // ═══════════════════════════════════════
    // 1. Đăng ký Slash Commands
    // ═══════════════════════════════════════
    try {
        const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);
        const commandsJSON = [];

        // Lấy tất cả command definitions từ các module
        const setupCmd = require('../commands/setup');
        const productCmd = require('../commands/product');
        const accountCmd = require('../commands/account');
        const orderCmd = require('../commands/order');
        const shopCmd = require('../commands/shop');
        const devCmd = require('../commands/dev');

        const allCmds = [setupCmd, productCmd, accountCmd, orderCmd, shopCmd, devCmd];
        for (const cmd of allCmds) {
            commandsJSON.push(cmd.command.toJSON());
        }

        console.log('🔄 Đăng ký slash commands...');

        if (config.GUILD_ID) {
            // Guild-specific (nhanh hơn cho dev)
            await rest.put(
                Routes.applicationGuildCommands(config.CLIENT_ID, config.GUILD_ID),
                { body: [] }
            );
        } else {
            await rest.put(
                Routes.applicationCommands(config.CLIENT_ID),
                { body: [] }
            );
        }

        console.log(`✅ Đã đăng ký ${commandsJSON.length} slash commands.`);
    } catch (err) {
        console.error('❌ Lỗi đăng ký commands:', err);
    }

    // ═══════════════════════════════════════
    // 2. Khởi động Web2M Poller
    // ═══════════════════════════════════════
    web2mPoller.start();

    // ═══════════════════════════════════════
    // 3. Cron: Hủy đơn hết hạn (mỗi phút)
    // ═══════════════════════════════════════
    setInterval(async () => {
        try {
            const count = await orderService.expirePendingOrders();
            if (count > 0) {
                console.log(`[Cron] Đã hủy ${count} đơn hàng hết hạn.`);
            }
        } catch (err) {
            console.error('[Cron] Lỗi hủy đơn hết hạn:', err.message);
        }
    }, 60 * 1000); // Mỗi phút

    // ═══════════════════════════════════════
    // 4. Log hệ thống
    // ═══════════════════════════════════════
    await logService.system('start', `Bot ${client.user.tag} đã khởi động.`);
}

module.exports = { handle };
