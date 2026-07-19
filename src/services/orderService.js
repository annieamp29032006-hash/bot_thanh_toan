/**
 * orderService.js - Tạo đơn, xác nhận thanh toán, giao hàng
 */
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Product = require('../models/Product');
const refGen = require('../utils/referenceGenerator');
const stockService = require('./stockService');
const logService = require('./logService');
const embeds = require('../utils/embedBuilder');
const config = require('../../config');

/**
 * Tạo đơn hàng + Payment record
 * Chú ý: KHÔNG giữ trước stock. Chỉ tạo record chờ thanh toán.
 */
async function createOrder(userId, username, productId, quantity = 1, interactionToken = '') {
    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
        return { success: false, message: 'Sản phẩm không tồn tại hoặc ngừng bán.' };
    }

    // Kiểm tra chống spam (giới hạn tối đa 2 đơn pending)
    const pendingCount = await Order.countDocuments({ userId, status: 'pending' });
    if (pendingCount >= 2) {
        return { success: false, message: 'Bạn đang có 2 giao dịch chưa thanh toán. Vui lòng thanh toán hoặc "Hủy giao dịch" cũ trước khi mua tiếp!' };
    }

    // VIP chỉ cho mua 1
    if (product.type === 'vip') quantity = 1;

    let baseAmount = product.price * quantity;
    let totalAmount = baseAmount;
    
    // Tạo số lẻ ngẫu nhiên (1 - 999) để dễ kiểm tra
    let randomSuffix = 0;
    let attempts = 0;
    let uniqueAmountFound = false;

    while (attempts < 50 && !uniqueAmountFound) {
        randomSuffix = Math.floor(Math.random() * 999) + 1;
        totalAmount = baseAmount + randomSuffix;
        
        // Kiểm tra xem có đơn nào đang chờ với số tiền này chưa
        const existing = await Payment.findOne({ amount: totalAmount, status: 'waiting' });
        if (!existing) {
            uniqueAmountFound = true;
        }
        attempts++;
    }

    if (!uniqueAmountFound) {
        // Fallback: cứ dùng baseAmount nếu không tìm được (rất hiếm khi xảy ra)
        totalAmount = baseAmount;
    }

    const reference = await refGen.generate();

    // THỰC HIỆN KHÓA HÀNG (Inventory Reservation)
    let lockedStockIds = [];
    if (product.type !== 'vip') {
        // Tạo ObjectId tạm cho order (để lưu vào lockedForOrder)
        const mongoose = require('mongoose');
        const orderId = new mongoose.Types.ObjectId();
        
        const lockResult = await stockService.lockStock(product._id, quantity, orderId);
        if (!lockResult.success) {
            return { success: false, message: lockResult.message };
        }
        
        lockedStockIds = lockResult.locked.map(s => s._id);

        const order = await Order.create({
            _id: orderId,
            reference,
            userId,
            username,
            productId: product._id,
            productName: product.name,
            productType: product.type,
            quantity,
            totalAmount,
            status: 'pending',
            interactionToken,
            stockIds: lockedStockIds
        });

        // Tạo Payment chờ xác nhận
        const expiresAt = new Date(Date.now() + config.PAYMENT_TIMEOUT * 60 * 1000);
        const payment = await Payment.create({
            orderId: order._id,
            reference,
            amount: totalAmount,
            status: 'waiting',
            expiresAt
        });

        order.paymentId = payment._id;
        await order.save();

        const qrUrl = `https://img.vietqr.io/image/${config.BANK_ID}-${config.BANK_ACCOUNT}-compact2.png?amount=${totalAmount}&accountName=${encodeURIComponent(config.BANK_NAME)}`;
        return { success: true, order, payment, qrUrl };
    } else {
        // VIP Order
        const order = await Order.create({
            reference,
            userId,
            username,
            productId: product._id,
            productName: product.name,
            productType: product.type,
            quantity,
            totalAmount,
            status: 'pending',
            interactionToken
        });

        const expiresAt = new Date(Date.now() + config.PAYMENT_TIMEOUT * 60 * 1000);
        const payment = await Payment.create({
            orderId: order._id,
            reference,
            amount: totalAmount,
            status: 'waiting',
            expiresAt
        });

        order.paymentId = payment._id;
        await order.save();

        const qrUrl = `https://img.vietqr.io/image/${config.BANK_ID}-${config.BANK_ACCOUNT}-compact2.png?amount=${totalAmount}&accountName=${encodeURIComponent(config.BANK_NAME)}`;
        return { success: true, order, payment, qrUrl };
    }
}

/**
 * Tạo đơn hàng cho 1 tài khoản đích danh
 */
async function createSpecificOrder(userId, username, productId, stockId, interactionToken = '') {
    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
        return { success: false, message: 'Sản phẩm không tồn tại hoặc ngừng bán.' };
    }

    // Kiểm tra chống spam (giới hạn tối đa 2 đơn pending)
    const pendingCount = await Order.countDocuments({ userId, status: 'pending' });
    if (pendingCount >= 2) {
        return { success: false, message: 'Bạn đang có 2 giao dịch chưa thanh toán. Vui lòng thanh toán hoặc "Hủy giao dịch" cũ trước khi mua tiếp!' };
    }

    let baseAmount = product.price;
    let totalAmount = baseAmount;
    
    // Tạo số lẻ ngẫu nhiên (1 - 999) để dễ kiểm tra
    let randomSuffix = 0;
    let attempts = 0;
    let uniqueAmountFound = false;

    while (attempts < 50 && !uniqueAmountFound) {
        randomSuffix = Math.floor(Math.random() * 999) + 1;
        totalAmount = baseAmount + randomSuffix;
        
        const existing = await Payment.findOne({ amount: totalAmount, status: 'waiting' });
        if (!existing) uniqueAmountFound = true;
        attempts++;
    }

    if (!uniqueAmountFound) totalAmount = baseAmount;

    const reference = await refGen.generate();

    const mongoose = require('mongoose');
    const orderId = new mongoose.Types.ObjectId();
    
    const lockResult = await stockService.lockSpecificStock(stockId, orderId);
    if (!lockResult.success) {
        return { success: false, message: lockResult.message };
    }
    
    const lockedStockIds = lockResult.locked.map(s => s._id);

    const order = await Order.create({
        _id: orderId,
        reference,
        userId,
        username,
        productId: product._id,
        productName: product.name,
        productType: product.type,
        quantity: 1,
        totalAmount,
        status: 'pending',
        interactionToken,
        stockIds: lockedStockIds
    });

    const expiresAt = new Date(Date.now() + config.PAYMENT_TIMEOUT * 60 * 1000);
    const payment = await Payment.create({
        orderId: order._id,
        reference,
        amount: totalAmount,
        status: 'waiting',
        expiresAt
    });

    order.paymentId = payment._id;
    await order.save();

    const qrUrl = `https://img.vietqr.io/image/${config.BANK_ID}-${config.BANK_ACCOUNT}-compact2.png?amount=${totalAmount}&accountName=${encodeURIComponent(config.BANK_NAME)}`;
    return { success: true, order, payment, qrUrl };
}

/**
 * Xác nhận thanh toán (được gọi bởi Web2M Poller)
 * QUAN TRỌNG: Chống bán trùng bằng atomic operations
 */
async function confirmPayment(paymentId, web2mData = {}) {
    const payment = await Payment.findById(paymentId);
    if (!payment || payment.status !== 'waiting') return null;

    const order = await Order.findById(payment.orderId);
    if (!order || order.status !== 'pending') return null;

    const product = await Product.findById(order.productId);
    if (!product) return null;

    // VIP: không cần lấy stock, chỉ đổi status sang "paid"
    if (product.type === 'vip') {
        order.status = 'paid';
        order.paidAt = new Date();
        await order.save();

        payment.status = 'confirmed';
        payment.confirmedAt = new Date();
        // Lưu mã giao dịch ngân hàng: vừa để đối soát, vừa để webhook gửi lại
        // cùng một giao dịch thì nhận ra mà bỏ qua.
        if (web2mData.bankTransactionId) payment.bankTransactionId = String(web2mData.bankTransactionId);
        payment.web2mData = web2mData;
        await payment.save();
        
        await updateEphemeralMessage(order, 'success');
        return { success: true, order, product, type: 'vip' };
    }

    // Code + Account: Đã khóa hàng ở bước createOrder, giờ chỉ cần đổi sang sold
    const claimedItems = await stockService.confirmSold(order._id, order.userId);

    // Giao hàng thành công
    order.status = 'delivered';
    order.paidAt = new Date();
    order.stockIds = claimedItems.map(s => s._id);
    order.dmSent = false; // Sẽ cập nhật sau khi gửi DM
    await order.save();

    payment.status = 'confirmed';
    payment.confirmedAt = new Date();
    // Lưu mã giao dịch ngân hàng: vừa để đối soát, vừa để webhook gửi lại
    // cùng một giao dịch thì nhận ra mà bỏ qua.
    if (web2mData.bankTransactionId) payment.bankTransactionId = String(web2mData.bankTransactionId);
    payment.web2mData = web2mData;
    await payment.save();

    await updateEphemeralMessage(order, 'success');

    // NẾU LÀ ACCOUNT VÀ HẾT HÀNG -> XÓA BÀI ĐĂNG
    if (product.type === 'account') {
        const remainingStock = await stockService.countAvailable(product._id);
        if (remainingStock === 0) {
            product.isActive = false;
            await product.save();
            
            // Xóa tin nhắn trên Discord
            if (product.displayChannelId && product.messageId) {
                try {
                    const { Client } = require('discord.js');
                    const client = require('../../index').client; // Giả sử client được export từ index.js
                    if (client) {
                        const channel = await client.channels.fetch(product.displayChannelId);
                        if (channel) {
                            const msg = await channel.messages.fetch(product.messageId);
                            if (msg) await msg.delete();
                            console.log(`[OrderService] Đã xóa bài đăng account ${product.name} vì đã bán hết.`);
                        }
                    }
                } catch (err) {
                    console.error(`[OrderService] Không thể xóa bài đăng của account ${product.name}:`, err.message);
                }
            }
        }
    }

    return { success: true, order, product, items: claimedItems, type: product.type };
}

/**
 * Admin giao hàng VIP
 */
async function deliverVip(reference, content, adminId) {
    const order = await Order.findOne({ reference });
    if (!order) return { success: false, message: 'Không tìm thấy đơn hàng.' };
    if (order.productType !== 'vip') return { success: false, message: 'Đơn này không phải VIP.' };
    if (order.status !== 'paid') return { success: false, message: `Đơn hàng ở trạng thái "${order.status}", không thể giao.` };

    order.deliveryContent = content;
    order.deliveredBy = adminId;
    order.deliveredAt = new Date();
    order.status = 'delivered';
    await order.save();

    return { success: true, order };
}

/**
 * Tra cứu đơn hàng
 */
async function findByReference(reference) {
    return Order.findOne({ reference }).populate('productId');
}

/**
 * Hủy đơn hàng
 */
async function cancelOrder(reference) {
    const order = await Order.findOne({ reference });
    if (!order) return { success: false, message: 'Không tìm thấy đơn hàng.' };
    if (order.status === 'delivered') return { success: false, message: 'Đơn đã giao, không thể hủy.' };

    // Trả lại stock nếu có (hoặc nhả lock)
    if (order.productType !== 'vip') {
        await stockService.releaseStock([], order._id);
    }

    order.status = 'cancelled';
    await order.save();

    // Hủy payment
    if (order.paymentId) {
        await Payment.findByIdAndUpdate(order.paymentId, { status: 'expired' });
    }

    await logService.system('cancel', `Hủy đơn ${reference}`, { reference });
    return { success: true, order };
}

/**
 * Hoàn tiền (chỉ đổi trạng thái, admin tự hoàn tiền thủ công)
 */
async function refundOrder(reference) {
    const order = await Order.findOne({ reference });
    if (!order) return { success: false, message: 'Không tìm thấy đơn hàng.' };

    // Trả lại stock
    if (order.productType !== 'vip') {
        await stockService.releaseStock([], order._id);
    }

    order.status = 'refunded';
    await order.save();

    await logService.system('refund', `Hoàn tiền đơn ${reference}`, { reference });
    return { success: true, order };
}

/**
 * Hủy đơn hàng hết hạn (chạy bởi cron)
 */
async function expirePendingOrders() {
    const expired = await Payment.find({
        status: 'waiting',
        expiresAt: { $lte: new Date() }
    });

    for (const payment of expired) {
        payment.status = 'expired';
        await payment.save();

        const order = await Order.findById(payment.orderId);
        if (order && order.status === 'pending') {
            order.status = 'cancelled';
            await order.save();
            console.log(`[OrderService] Hủy đơn hết hạn: ${order.reference}`);
            
            if (order.productType !== 'vip') {
                await stockService.releaseStock([], order._id);
            }
            
            await updateEphemeralMessage(order, 'expired');
        }
    }

    return expired.length;
}

module.exports = {
    createOrder,
    createSpecificOrder,
    confirmPayment,
    deliverVip,
    findByReference,
    cancelOrder,
    refundOrder,
    expirePendingOrders
};

/**
 * Cập nhật tin nhắn Ephemeral của người dùng
 */
async function updateEphemeralMessage(order, state, extraMsg = '') {
    if (!order.interactionToken) return;
    try {
        const { WebhookClient, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
        const webhook = new WebhookClient({ id: config.CLIENT_ID, token: order.interactionToken });
        
        let embed = new EmbedBuilder().setTitle(`Đơn hàng ${order.reference}`);
        let components = [];
        
        if (state === 'success') {
            embed.setColor('#2ECC71')
                .setDescription(`✅ **Thanh toán thành công!**\nĐơn hàng của bạn đã được xác nhận.\n\n👉 *Vui lòng kiểm tra Tin Nhắn Riêng (DM) để nhận hàng.*`);
            
            components.push(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('open_shop_menu')
                        .setLabel('🛒 Tiếp tục mua hàng')
                        .setStyle(ButtonStyle.Success)
                )
            );
        } else if (state === 'expired') {
            embed.setColor('#E74C3C')
                .setDescription(`❌ **Thanh toán thất bại / Hết hạn!**\nĐơn hàng này đã bị hủy bỏ do quá thời gian chờ thanh toán (5 phút).`);
        } else if (state === 'failed') {
            embed.setColor('#E74C3C')
                .setDescription(`❌ **Giao hàng thất bại!**\nLỗi: ${extraMsg}\n\n👉 *Vui lòng liên hệ Admin để được hỗ trợ.*`);
        }

        await webhook.editMessage('@original', { embeds: [embed], components });
    } catch (err) {
        console.error(`[OrderService] Không thể update ephemeral message cho đơn ${order.reference}:`, err.message);
    }
}
