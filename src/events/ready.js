/**
 * ready.js - Sự kiện Bot đã sẵn sàng
 */
const { REST, Routes } = require('discord.js');
const config = require('../../config');
const logService = require('../services/logService');

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

    // Poller VCB (dò thanh toán + hủy đơn hết hạn) được khởi động ở index.js.

    await logService.system('start', `Bot ${client.user.tag} đã khởi động.`);
}

module.exports = { handle };
