/**
 * Order.js - Schema đơn hàng
 */
const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    reference: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    username: { type: String, default: '' },
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, default: '' },
    productType: { 
        type: String, 
        enum: ['code', 'vip', 'account'], 
        required: true 
    },
    quantity: { type: Number, default: 1, min: 1 },
    totalAmount: { type: Number, required: true },
    status: {
        type: String,
        enum: ['pending', 'paid', 'delivered', 'cancelled', 'out_of_stock', 'refunded'],
        default: 'pending',
        index: true
    },
    stockIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProductStock' }],
    interactionToken: { type: String, default: '' },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
    
    // Chỉ dành cho VIP (Admin giao thủ công)
    deliveryContent: { type: String, default: '' },
    deliveredBy: { type: String, default: '' },
    deliveredAt: { type: Date, default: null },
    
    dmSent: { type: Boolean, default: false },
    paymentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Payment', default: null },
    
    createdAt: { type: Date, default: Date.now },
    paidAt: { type: Date, default: null }
});

module.exports = mongoose.model('Order', orderSchema);

// Counter schema cho auto-increment reference
const counterSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0 }
});

const Counter = mongoose.model('Counter', counterSchema);
module.exports.Counter = Counter;
