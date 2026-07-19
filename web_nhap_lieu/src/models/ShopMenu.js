const mongoose = require('mongoose');

const shopMenuSchema = new mongoose.Schema({
    title: { type: String, required: true },
    productIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    channelId: { type: String, default: '' },
    messageId: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ShopMenu', shopMenuSchema);
