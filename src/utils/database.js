/**
 * database.js - Kết nối MongoDB.
 *
 * CỐ Ý KHÔNG có fallback sang MongoDB in-memory: bản cũ tự dựng mongodb-memory-server
 * khi không kết nối được, nghĩa là DB thật trục trặc một lát thì bot vẫn chạy tiếp trên
 * một DB rỗng tạm thời - khách đặt đơn, trả tiền, rồi dữ liệu bay mất khi tắt tiến trình.
 * Thà chết hẳn còn hơn bán hàng trên DB ma.
 */
const mongoose = require('mongoose');
const config = require('../../config');

let isConnected = false;

async function connect() {
    if (isConnected) return;

    if (!config.MONGO_URI) {
        console.error('❌ Thiếu MONGO_URI trong .env');
        process.exit(1);
    }

    try {
        await mongoose.connect(config.MONGO_URI, {
            serverSelectionTimeoutMS: 15000 // TLS + remote cần nhiều hơn vài giây
        });
        isConnected = true;
        const { host, name } = mongoose.connection;
        console.log(`✅ Đã kết nối MongoDB: ${name}@${host}`);
    } catch (err) {
        console.error('❌ Không kết nối được MongoDB:', err.message);
        console.error('   Kiểm tra MONGO_URI, firewall (port 27017) và trạng thái mongod trên VPS.');
        process.exit(1);
    }

    mongoose.connection.on('error', (err) => {
        console.error('❌ MongoDB connection error:', err.message);
    });

    mongoose.connection.on('disconnected', () => {
        console.warn('⚠️ MongoDB bị ngắt kết nối - driver sẽ tự kết nối lại.');
        isConnected = false;
    });

    mongoose.connection.on('reconnected', () => {
        console.log('✅ MongoDB đã kết nối lại.');
        isConnected = true;
    });
}

module.exports = { connect };
