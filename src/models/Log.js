/**
 * Log.js - System log schema
 */
const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['system', 'code_sale', 'vip_sale', 'account_sale', 'error', 'import', 'product_change'],
        required: true,
        index: true
    },
    action: { type: String, default: '' },      // "add", "edit", "delete", "sell", "deliver", etc.
    message: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    userId: { type: String, default: '' },       // Admin hoặc User thực hiện
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Log', logSchema);
