/**
 * config.js - Tải cấu hình từ .env và cung cấp giá trị mặc định
 */
const dotenv = require('dotenv');
dotenv.config();

const config = {
    // Discord
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    CLIENT_ID: process.env.CLIENT_ID,
    GUILD_ID: process.env.GUILD_ID || '',

    // Bot phụ chuyên trách kênh xét duyệt hàng đặc biệt. Bắt buộc phải là client
    // riêng: Discord gửi sự kiện bấm nút về đúng application đã đăng tin nhắn đó.
    // Bỏ trống thì bot chính tự lo luôn phần xét duyệt.
    APPROVAL_BOT_TOKEN: process.env.APPROVAL_BOT_TOKEN || '',

    // MongoDB - nguồn dữ liệu duy nhất (Category -> Product -> ProductStock -> Order/Payment)
    MONGO_URI: process.env.MONGO_URI || '',

    // Web2M Payment
    WEB2M_API_KEY: process.env.WEB2M_API_KEY || '',
    WEB2M_API_NAME: process.env.WEB2M_API_NAME || 'historyapimbv3',
    WEB2M_ACCOUNT_PASSWORD: process.env.WEB2M_ACCOUNT_PASSWORD || '',
    PAYMENT_POLL_INTERVAL: parseInt(process.env.PAYMENT_POLL_INTERVAL) || 30, // giây
    PAYMENT_TIMEOUT: parseInt(process.env.PAYMENT_TIMEOUT) || 15, // phút

    // Webhook Web2M (phương án chính - Web2M tự đẩy giao dịch sang)
    WEBHOOK_PORT: parseInt(process.env.WEBHOOK_PORT) || 3002,
    WEBHOOK_PATH: process.env.WEBHOOK_PATH || '/webhook/web2m',
    WEB2M_WEBHOOK_TOKEN: process.env.WEB2M_WEBHOOK_TOKEN || '',

    // Bank QR
    BANK_ID: process.env.BANK_ID || '970422',
    BANK_ACCOUNT: process.env.BANK_ACCOUNT || '',
    BANK_NAME: process.env.BANK_NAME || '',

    // Prefix mã tham chiếu
    REF_PREFIX: process.env.REF_PREFIX || 'KZ',

    // Kênh Discord
    CHANNELS: {
        IMAGE_STORAGE: process.env.CH_IMAGE_STORAGE || '',
        SYSTEM_LOG: process.env.CH_SYSTEM_LOG || '',
        LOG_CODE: process.env.CH_LOG_CODE || '',
        LOG_VIP: process.env.CH_LOG_VIP || '',
        LOG_ACCOUNT: process.env.CH_LOG_ACCOUNT || '',
        APPROVAL: process.env.CH_APPROVAL || '',   // kênh xét duyệt hàng đặc biệt
        STATS_24H: process.env.CH_STATS_24H || '',
        MSG_STATS_24H: process.env.MSG_STATS_24H || '',
        STATS_30D: process.env.CH_STATS_30D || '',
        MSG_STATS_30D: process.env.MSG_STATS_30D || '',
    }
};

config.reload = function() {
    dotenv.config({ override: true });
    
    // Update config values from new process.env
    config.DISCORD_TOKEN = process.env.DISCORD_TOKEN;
    config.CLIENT_ID = process.env.CLIENT_ID;
    config.GUILD_ID = process.env.GUILD_ID || '';
    config.MONGO_URI = process.env.MONGO_URI || '';
    config.WEB2M_API_KEY = process.env.WEB2M_API_KEY || '';
    config.WEB2M_API_NAME = process.env.WEB2M_API_NAME || 'historyapimbv3';
    config.WEB2M_ACCOUNT_PASSWORD = process.env.WEB2M_ACCOUNT_PASSWORD || '';
    config.PAYMENT_POLL_INTERVAL = parseInt(process.env.PAYMENT_POLL_INTERVAL) || 30;
    config.PAYMENT_TIMEOUT = parseInt(process.env.PAYMENT_TIMEOUT) || 15;
    config.WEB2M_WEBHOOK_TOKEN = process.env.WEB2M_WEBHOOK_TOKEN || '';
    config.BANK_ID = process.env.BANK_ID || '970422';
    config.BANK_ACCOUNT = process.env.BANK_ACCOUNT || '';
    config.BANK_NAME = process.env.BANK_NAME || '';
    config.REF_PREFIX = process.env.REF_PREFIX || 'KZ';
    
    config.CHANNELS.IMAGE_STORAGE = process.env.CH_IMAGE_STORAGE || '';
    config.CHANNELS.SYSTEM_LOG = process.env.CH_SYSTEM_LOG || '';
    config.CHANNELS.LOG_CODE = process.env.CH_LOG_CODE || '';
    config.CHANNELS.LOG_VIP = process.env.CH_LOG_VIP || '';
    config.CHANNELS.LOG_ACCOUNT = process.env.CH_LOG_ACCOUNT || '';
    config.CHANNELS.APPROVAL = process.env.CH_APPROVAL || '';
    config.CHANNELS.STATS_24H = process.env.CH_STATS_24H || '';
    config.CHANNELS.MSG_STATS_24H = process.env.MSG_STATS_24H || '';
    config.CHANNELS.STATS_30D = process.env.CH_STATS_30D || '';
    config.CHANNELS.MSG_STATS_30D = process.env.MSG_STATS_30D || '';
};

module.exports = config;
