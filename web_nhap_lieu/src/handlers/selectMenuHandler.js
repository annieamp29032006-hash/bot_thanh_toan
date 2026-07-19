/**
 * selectMenuHandler.js - Xử lý Select Menu (chọn số lượng)
 */
const buttonHandler = require('./buttonHandler');

async function handle(interaction) {
    const id = interaction.customId;

    // ═══════════════════════════════════════
    // SELECT SỐ LƯỢNG MUA
    // ═══════════════════════════════════════
    if (id.startsWith('qty_')) {
        const productId = id.replace('qty_', '');
        const quantity = parseInt(interaction.values[0], 10);
        return buttonHandler.handleBuyConfirm(interaction, productId, quantity, interaction.token);
    }

    // ═══════════════════════════════════════
    // SELECT SẢN PHẨM (TỪ SHOP MENU GỘP)
    // ═══════════════════════════════════════
    if (id === 'select_product_menu') {
        const productId = interaction.values[0];
        return buttonHandler.handleBuyClick(interaction, productId);
    }
}

module.exports = { handle };
