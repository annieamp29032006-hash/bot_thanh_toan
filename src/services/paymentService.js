/**
 * paymentService.js - Xử lý thanh toán + giao hàng sau khi Web2M xác nhận
 */
const orderService = require('./orderService');
const logService = require('./logService');
const embeds = require('../utils/embedBuilder');
const ProductStock = require('../models/ProductStock');
const Product = require('../models/Product');
const approvalBot = require('../utils/approvalBot');

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
    } else if (type === 'special') {
        // Hàng đặc biệt: đã thu tiền nhưng phải chờ admin duyệt mới giao
        await handleSpecialPaid(order, result.items);
    } else {
        // Code / Account: Giao tự động
        await handleAutoDelivery(order, result.items);
    }
}

/**
 * Gửi trọn bộ DM giao hàng: embed tóm tắt -> từng sản phẩm -> lời nhắc cuối.
 * Discord cho tối đa 10 embed mỗi tin nhắn nên gom theo lô 10: vẫn đúng bố cục
 * mỗi món một khối, mà mua số lượng lớn cũng không đụng rate limit.
 */
async function sendDeliveryDM(user, order, items) {
    await user.send({ embeds: [embeds.deliveryEmbed(order, items)] });

    // VIP giao bằng nội dung admin nhập, đã nằm trong embed tóm tắt rồi.
    if (order.productType === 'vip' || !items.length) return;

    // Bảo hành chung của mặt hàng, để đắp cho stock nào không khai riêng.
    const product = await Product.findById(order.productId).select('warranty').lean();

    const itemEmbeds = embeds.deliveryItemEmbeds(order, items, product ? product.warranty : '');
    for (let i = 0; i < itemEmbeds.length; i += 10) {
        await user.send({ embeds: itemEmbeds.slice(i, i + 10) });
    }

    await user.send(embeds.DELIVERY_DONE_NOTE);
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
            await sendDeliveryDM(user, order, items);
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
 * Hàng đặc biệt đã thanh toán → báo khách chờ, đẩy sang kênh xét duyệt.
 * Không duyệt thì đơn cứ nằm ở trạng thái "paid", không tự hủy, không tự giao.
 */
async function handleSpecialPaid(order, items = []) {
    // 1. DM khách: "đã nhận tiền, đang chờ duyệt"
    let dmSent = false;
    try {
        const user = await _client.users.fetch(order.userId);
        if (user) {
            await user.send({ embeds: [embeds.specialWaitingEmbed(order)] });
            dmSent = true;
        }
    } catch (err) { /* Khách tắt DM */ }

    order.dmSent = dmSent;
    await order.save();

    // 2. Đẩy sang kênh xét duyệt kèm nút mở ô nhập nội dung giao.
    // Ưu tiên bot phụ: nút phải do chính bot nào đăng thì bot đó mới nhận được
    // sự kiện bấm. Bot phụ chưa cấu hình hoặc gửi hụt thì bot chính gánh, chứ
    // không để đơn đã thu tiền nằm im mà không ai biết mà duyệt.
    const alertEmbed = embeds.specialAdminAlertEmbed(order, order.userId, items);
    const approveBtn = embeds.specialApproveButton(order.reference);

    const sent = await approvalBot.sendApproval(alertEmbed, [approveBtn]);
    if (!sent) {
        await logService.sendToVipLog(alertEmbed, [approveBtn]);
    }

    console.log(`[PaymentService] ⭐ Hàng đặc biệt chờ duyệt: ${order.reference} (qua ${sent ? 'bot phụ' : 'bot chính'})`);
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

        if (order.needsApproval) {
            // Hàng đặc biệt: khách nhận đúng nội dung admin đã duyệt, không phải
            // dữ liệu kho - gửi lại cũng phải đúng cái đó.
            await user.send({ embeds: [embeds.specialDeliveredEmbed(order)] });
        } else {
            const items = order.productType === 'vip'
                ? []
                : await ProductStock.find({ _id: { $in: order.stockIds } });

            await sendDeliveryDM(user, order, items);
        }
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
