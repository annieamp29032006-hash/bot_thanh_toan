/**
 * paymentService.js - Xử lý thanh toán + giao hàng sau khi Web2M xác nhận
 */
const orderService = require('./orderService');
const logService = require('./logService');
const embeds = require('../utils/embedBuilder');
const ProductStock = require('../models/ProductStock');

let _client = null;

function setClient(client) {
    _client = client;
}

/**
 * Xử lý khi Web2M Poller tìm thấy giao dịch khớp
 */
async function handlePaymentConfirmed(paymentId, web2mData) {
    const result = await orderService.confirmPayment(paymentId, web2mData);
    if (!result) return;

    const { order, product, type } = result;

    if (!result.success) {
        // Hết hàng sau khi thanh toán
        await logService.error('out_of_stock', 
            `Đơn ${order.reference}: Đã thanh toán nhưng hết hàng! ${result.message}`
        );

        // DM khách báo lỗi
        try {
            const user = await _client.users.fetch(order.userId);
            if (user) {
                const { EmbedBuilder } = require('discord.js');
                const embed = new EmbedBuilder()
                    .setTitle('⚠️ ĐƠN HÀNG GẶP SỰ CỐ')
                    .setDescription(
                        `Đơn hàng **${order.reference}** đã nhận thanh toán nhưng kho hàng không đủ.\n` +
                        `Admin sẽ xử lý trong thời gian sớm nhất. Xin lỗi bạn vì sự bất tiện!`
                    )
                    .setColor('#E74C3C')
                    .setTimestamp();
                await user.send({ embeds: [embed] });
            }
        } catch (err) { /* Khách tắt DM */ }
        return;
    }

    // ═══════════════════════════════════════════════════
    // GIAO HÀNG THÀNH CÔNG
    // ═══════════════════════════════════════════════════

    if (type === 'vip') {
        // VIP: Chờ admin giao → Báo khách + Báo admin
        await handleVipPaid(order);
    } else {
        // Code / Account: Giao tự động
        await handleAutoDelivery(order, result.items);
    }
}

/**
 * Giao hàng tự động (Code + Account)
 */
async function handleAutoDelivery(order, items) {
    // 1. DM khách
    let dmSent = false;
    try {
        const user = await _client.users.fetch(order.userId);
        if (user) {
            const embed = embeds.deliveryEmbed(order, items);
            await user.send({ embeds: [embed] });
            dmSent = true;
        }
    } catch (err) {
        console.error(`[PaymentService] Không thể DM user ${order.userId}:`, err.message);
    }

    // 2. Cập nhật dmSent
    order.dmSent = dmSent;
    await order.save();

    // 3. Log theo loại
    const logEmbed = embeds.saleLogEmbed(order, order.userId, 
        order.productType === 'code' ? 'code_sale' : 'account_sale'
    );

    if (order.productType === 'code') {
        await logService.codeSale(order, logEmbed);
    } else {
        await logService.accountSale(order, logEmbed);
    }

    console.log(`[PaymentService] ✅ Giao hàng tự động: ${order.reference} (${items.length} items)`);
}

/**
 * Xử lý VIP đã thanh toán (chờ admin giao)
 */
async function handleVipPaid(order) {
    // 1. DM khách: "Chờ admin giao"
    let dmSent = false;
    try {
        const user = await _client.users.fetch(order.userId);
        if (user) {
            const embed = embeds.vipWaitingEmbed(order);
            await user.send({ embeds: [embed] });
            dmSent = true;
        }
    } catch (err) { /* Khách tắt DM */ }

    order.dmSent = dmSent;
    await order.save();

    // 2. Báo admin ở kênh log-vip
    const alertEmbed = embeds.vipAdminAlertEmbed(order, order.userId);
    const deliverBtn = embeds.vipDeliverButton(order.reference);
    await logService.sendToVipLog(alertEmbed, [deliverBtn]);

    console.log(`[PaymentService] ⭐ VIP đã thanh toán, chờ admin: ${order.reference}`);
}

/**
 * Gửi lại DM (khi khách bật lại DM)
 */
async function resendDelivery(reference) {
    const order = await orderService.findByReference(reference);
    if (!order) return { success: false, message: 'Không tìm thấy đơn hàng.' };
    if (order.status !== 'delivered') return { success: false, message: 'Đơn hàng chưa được giao.' };

    try {
        const user = await _client.users.fetch(order.userId);
        if (!user) return { success: false, message: 'Không tìm thấy người dùng.' };

        let embed;
        if (order.productType === 'vip') {
            embed = embeds.deliveryEmbed(order, []);
        } else {
            const items = await ProductStock.find({ _id: { $in: order.stockIds } });
            embed = embeds.deliveryEmbed(order, items);
        }

        await user.send({ embeds: [embed] });
        order.dmSent = true;
        await order.save();

        return { success: true };
    } catch (err) {
        return { success: false, message: 'Không thể gửi DM. Khách có thể đang tắt DMs.' };
    }
}

module.exports = {
    setClient,
    handlePaymentConfirmed,
    handleAutoDelivery,
    handleVipPaid,
    resendDelivery
};
