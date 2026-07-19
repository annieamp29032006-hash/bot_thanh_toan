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
const shopFlowHandler = require('../handlers/shopFlowHandler');
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
        // AUTOCOMPLETE (gợi ý khi đang gõ lệnh)
        // Phải xử lý TRƯỚC và trả nhanh - Discord chỉ chờ 3 giây.
        // ═══════════════════════════════════════
        if (interaction.isAutocomplete()) {
            const handler = commandMap[interaction.commandName];
            if (handler && typeof handler.autocomplete === 'function') {
                try {
                    return await handler.autocomplete(interaction);
                } catch (err) {
                    console.error('[Autocomplete] Lỗi:', err.message);
                    // Trả danh sách rỗng còn hơn để Discord treo
                    if (!interaction.responded) await interaction.respond([]).catch(() => {});
                }
            }
            return;
        }

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
            // Ưu tiên luồng shop mới (MariaDB); nếu không khớp thì rơi xuống handler cũ
            if (await shopFlowHandler.route(interaction)) return;
            return await buttonHandler.handle(interaction);
        }

        // ═══════════════════════════════════════
        // SELECT MENUS
        // ═══════════════════════════════════════
        if (interaction.isStringSelectMenu()) {
            if (await shopFlowHandler.route(interaction)) return;
            return await selectMenuHandler.handle(interaction);
        }

        // ═══════════════════════════════════════
        // MODALS
        // ═══════════════════════════════════════
        if (interaction.isModalSubmit()) {
            // Ưu tiên luồng shop (ô nhập số lượng), không khớp thì rơi xuống handler cũ
            if (await shopFlowHandler.routeModal(interaction)) return;
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
