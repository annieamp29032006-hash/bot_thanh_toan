/**
 * approvalBot.js - Bot phụ chuyên trách kênh xét duyệt hàng đặc biệt.
 *
 * VÌ SAO PHẢI LÀ CLIENT RIÊNG, không dùng lại bot chính:
 * Discord gửi sự kiện bấm nút / submit modal về đúng application đã ĐĂNG tin nhắn
 * chứa nút đó. Bot chính sẽ không bao giờ nhận được nút do bot này đăng, nên bot
 * này buộc phải tự cầm một kết nối gateway để bắt tương tác.
 *
 * DM báo hàng cho khách vẫn do BOT CHÍNH gửi (xem modalHandler.setDmClient):
 * khách mua hàng với bot chính mà nhận hàng từ một bot lạ thì rất khó hiểu.
 *
 * Không đặt APPROVAL_BOT_TOKEN thì module này nằm im, bot chính tự lo phần duyệt.
 */
const { Client, GatewayIntentBits } = require('discord.js');
const config = require('../../config');
const settings = require('../models/Setting');

let client = null;
let isReady = false;

/**
 * Đăng nhập bot phụ. Trả về null nếu không cấu hình token.
 */
async function start() {
    if (!config.APPROVAL_BOT_TOKEN) {
        console.log('ℹ️ Chưa đặt APPROVAL_BOT_TOKEN → bot chính sẽ tự lo kênh xét duyệt.');
        return null;
    }

    // Chỉ cần Guilds: bot này không đọc tin nhắn, chỉ đăng embed và nhận tương tác.
    client = new Client({ intents: [GatewayIntentBits.Guilds] });

    client.once('ready', () => {
        isReady = true;
        console.log(`✅ Bot xét duyệt đã đăng nhập: ${client.user.tag}`);
    });

    // Nút duyệt + modal do chính bot này đăng nên tương tác về đây. Đẩy thẳng sang
    // handler dùng chung, khỏi phải viết lại logic lần hai.
    client.on('interactionCreate', async (interaction) => {
        try {
            if (interaction.isButton()) {
                const buttonHandler = require('../handlers/buttonHandler');
                return await buttonHandler.handle(interaction);
            }
            if (interaction.isModalSubmit()) {
                const modalHandler = require('../handlers/modalHandler');
                return await modalHandler.handle(interaction);
            }
        } catch (err) {
            console.error('[ApprovalBot] Lỗi xử lý tương tác:', err.message);
        }
    });

    client.on('error', (err) => console.error('[ApprovalBot] Client error:', err.message));

    await client.login(config.APPROVAL_BOT_TOKEN);
    return client;
}

/**
 * Kênh xét duyệt: ưu tiên cấu hình riêng, không có thì dùng tạm kênh log-vip
 * để thông báo không bị rơi vào hư không.
 */
async function resolveChannelId() {
    return config.CHANNELS.APPROVAL
        || await settings.get('ch_approval')
        || config.CHANNELS.LOG_VIP
        || await settings.get('ch_log_vip')
        || '';
}

function isActive() {
    return Boolean(client && isReady);
}

/**
 * Đăng thông báo xét duyệt. Trả về false nếu không gửi được để bên gọi còn
 * biết đường fallback sang bot chính.
 */
async function sendApproval(embed, components = []) {
    if (!isActive()) return false;

    const channelId = await resolveChannelId();
    if (!channelId) {
        console.warn('[ApprovalBot] Chưa cấu hình kênh xét duyệt (CH_APPROVAL hoặc ch_approval).');
        return false;
    }

    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) {
            console.warn(`[ApprovalBot] Không tìm thấy kênh ${channelId}.`);
            return false;
        }
        await channel.send({ embeds: [embed], components });
        return true;
    } catch (err) {
        console.error('[ApprovalBot] Không gửi được thông báo duyệt:', err.message);
        return false;
    }
}

module.exports = { start, sendApproval, isActive, resolveChannelId };
