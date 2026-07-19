/**
 * imageUploader.js - Upload ảnh vào kênh image-storage và lấy CDN URL
 */
const settings = require('../models/Setting');
const config = require('../../config');

/**
 * Upload ảnh vào kênh image-storage
 * @param {Client} client - Discord client
 * @param {string} imageUrl - URL ảnh gốc (từ attachment)
 * @returns {string} Discord CDN URL
 */
async function upload(client, imageUrl) {
    try {
        const channelId = config.CHANNELS.IMAGE_STORAGE || await settings.get('ch_image_storage');
        if (!channelId) {
            console.warn('⚠️ Chưa cấu hình kênh image-storage. Dùng URL gốc.');
            return imageUrl;
        }

        const channel = client.channels.cache.get(channelId);
        if (!channel) {
            console.warn('⚠️ Không tìm thấy kênh image-storage.');
            return imageUrl;
        }

        const msg = await channel.send({ files: [imageUrl] });
        if (msg.attachments.size > 0) {
            return msg.attachments.first().url;
        }
        return imageUrl;
    } catch (err) {
        console.error('❌ Lỗi upload ảnh:', err.message);
        return imageUrl;
    }
}

module.exports = { upload };
