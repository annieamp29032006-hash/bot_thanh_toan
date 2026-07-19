/**
 * Payment.js - Lịch sử thanh toán Web2M
 */
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    reference: { type: String, required: true, index: true },  // Nội dung CK = mã tham chiếu
    amount: { type: Number, required: true },
    bankTransactionId: { type: String, default: '' },
    status: {
        type: String,
        enum: ['waiting', 'confirmed', 'expired'],
        default: 'waiting',
        index: true
    },
    web2mData: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
    confirmedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true }
});

// TTL index: tự xóa records expired sau 24h
paymentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('Payment', paymentSchema);
