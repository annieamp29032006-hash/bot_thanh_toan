/**
 * Setting.js - Cấu hình động (channel IDs, roles, etc.)
 */
const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    updatedAt: { type: Date, default: Date.now }
});

const Setting = mongoose.model('Setting', settingSchema);

/**
 * Lấy giá trị setting theo key
 */
async function get(key, defaultValue = null) {
    const setting = await Setting.findOne({ key });
    return setting ? setting.value : defaultValue;
}

/**
 * Lưu setting
 */
async function set(key, value) {
    await Setting.findOneAndUpdate(
        { key },
        { value, updatedAt: new Date() },
        { upsert: true }
    );
}

module.exports = { Setting, get, set };
