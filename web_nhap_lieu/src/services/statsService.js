/**
 * statsService.js - Dịch vụ thống kê doanh thu tự động
 */
const Order = require('../models/Order');
const settings = require('../models/Setting');
const embeds = require('../utils/embedBuilder');

let discordClient = null;

function setClient(client) {
    discordClient = client;
}

/**
 * Tính toán thống kê doanh thu trong N ngày qua
 */
async function calculateStats(days) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Tìm tất cả đơn hàng đã giao thành công trong khoảng thời gian
    const orders = await Order.find({
        status: 'delivered',
        createdAt: { $gte: startDate }
    });

    let totalRevenue = 0;
    const userStats = {};

    orders.forEach(order => {
        totalRevenue += order.totalAmount;
        
        if (!userStats[order.userId]) {
            userStats[order.userId] = { totalSpent: 0, orderCount: 0 };
        }
        userStats[order.userId].totalSpent += order.totalAmount;
        userStats[order.userId].orderCount += 1;
    });

    // Lọc ra Top 5 đại gia
    const topBuyers = Object.keys(userStats)
        .map(userId => ({
            _id: userId,
            totalSpent: userStats[userId].totalSpent,
            orderCount: userStats[userId].orderCount
        }))
        .sort((a, b) => b.totalSpent - a.totalSpent)
        .slice(0, 5);

    return {
        totalRevenue,
        totalOrders: orders.length,
        topBuyers
    };
}

/**
 * Cập nhật tin nhắn thống kê trên Discord
 */
async function updateStatsEmbed(channelId, messageId, title, days) {
    if (!discordClient || !channelId || !messageId) return;

    try {
        const channel = discordClient.channels.cache.get(channelId);
        if (!channel) return;

        const msg = await channel.messages.fetch(messageId).catch(() => null);
        if (!msg) return;

        const stats = await calculateStats(days);
        const embed = embeds.revenueStatsEmbed(title, stats.totalRevenue, stats.totalOrders, stats.topBuyers);

        await msg.edit({ embeds: [embed] });
    } catch (err) {
        console.error(`[StatsService] Lỗi cập nhật ${title}:`, err.message);
    }
}

/**
 * Tác vụ chạy ngầm cập nhật tự động
 */
async function runUpdateCycle() {
    console.log('[StatsService] Đang cập nhật bảng thống kê doanh thu...');
    const ch24h = await settings.get('ch_stats_24h');
    const msg24h = await settings.get('msg_stats_24h');
    const ch30d = await settings.get('ch_stats_30d');
    const msg30d = await settings.get('msg_stats_30d');

    if (ch24h && msg24h) {
        await updateStatsEmbed(ch24h, msg24h, 'DOANH THU 24 GIỜ QUA', 1);
    }
    if (ch30d && msg30d) {
        await updateStatsEmbed(ch30d, msg30d, 'DOANH THU 30 NGÀY QUA', 30);
    }
}

function start() {
    console.log('[StatsService] Đã kích hoạt vòng lặp cập nhật thống kê (10 phút / lần)');
    // Chạy lần đầu sau 5 giây
    setTimeout(runUpdateCycle, 5000);
    // Chạy lặp lại mỗi 10 phút (600,000 ms)
    setInterval(runUpdateCycle, 10 * 60 * 1000);
}

module.exports = {
    setClient,
    start,
    runUpdateCycle
};
