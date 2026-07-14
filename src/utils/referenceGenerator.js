/**
 * referenceGenerator.js - Tạo mã tham chiếu duy nhất: KZ-XXXXXXX
 */
const Order = require('../models/Order');
const config = require('../../config');

function generateRandomChars(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

async function generate() {
    let isUnique = false;
    let ref = '';
    while (!isUnique) {
        const randomStr = generateRandomChars(7);
        ref = `KZ-${randomStr}`;
        // Since Order is a Mongoose model, we check for uniqueness directly.
        // In this case, Order is exported from Order.js as the default export.
        // Note: Order.js has `module.exports = mongoose.model('Order', orderSchema);`
        const existing = await Order.findOne({ reference: ref });
        if (!existing) {
            isUnique = true;
        }
    }
    return ref;
}

module.exports = { generate };
