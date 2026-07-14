/**
 * interactionCreate.js - Router cho tất cả Discord interactions
 */
const setupCmd = require('../commands/setup');
const productCmd = require('../commands/product');
const accountCmd = require('../commands/account');
const orderCmd = require('../commands/order');
const shopCmd = require('../commands/shop');
const setupShopCmd = require('../commands/setup_shop');
const devCmd = require('../commands/dev');
const buttonHandler = require('../handlers/buttonHandler');
const selectMenuHandler = require('../handlers/selectMenuHandler');
const modalHandler = require('../handlers/modalHandler');
const logService = require('../services/logService');

// Map tên lệnh -> handler
const commandMap = {
    'setup': setupCmd,
    'product': productCmd,
    'account': accountCmd,
    'order': orderCmd,
    'shop': shopCmd,
    'setup_shop': setupShopCmd,
    'dev': devCmd
};

async function handle(interaction) {
    try {
        // ═══════════════════════════════════════
        // SLASH COMMANDS
        // ═══════════════════════════════════════
        if (interaction.isChatInputCommand()) {
            const handler = commandMap[interaction.commandName];
            if (handler) {
                return await handler.execute(interaction);
            }
        }

        // ═══════════════════════════════════════
        // BUTTONS
        // ═══════════════════════════════════════
        if (interaction.isButton()) {
            return await buttonHandler.handle(interaction);
        }

        // ═══════════════════════════════════════
        // SELECT MENUS
        // ═══════════════════════════════════════
        if (interaction.isStringSelectMenu()) {
            return await selectMenuHandler.handle(interaction);
        }

        // ═══════════════════════════════════════
        // MODALS
        // ═══════════════════════════════════════
        if (interaction.isModalSubmit()) {
            return await modalHandler.handle(interaction);
        }
    } catch (error) {
        console.error('[InteractionCreate] Lỗi:', error);
        await logService.error('interaction', `Lỗi xử lý interaction: ${error.message}`, { stack: error.stack });

        const content = '❌ Có lỗi xảy ra trong quá trình xử lý. Vui lòng thử lại!';
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content, ephemeral: true });
            } else {
                await interaction.reply({ content, ephemeral: true });
            }
        } catch (e) { /* Interaction đã hết hạn */ }
    }
}

module.exports = { handle, commandMap };
