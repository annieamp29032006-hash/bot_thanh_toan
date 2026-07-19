const mongoose = require('mongoose');
const config = require('../../config');
const fs = require('fs');
const path = require('path');

let isConnected = false;

async function connect() {
    if (isConnected) return;

    try {
        await mongoose.connect(config.MONGO_URI, {
            serverSelectionTimeoutMS: 2000 // Thử kết nối nhanh
        });
        isConnected = true;
        console.log('✅ Đã kết nối MongoDB thành công (Local/Atlas).');
    } catch (err) {
        console.log('⚠️ Không tìm thấy MongoDB đang chạy. Bot sẽ tự động tải và chạy MongoDB cục bộ...');
        
        try {
            const { MongoMemoryReplSet } = require('mongodb-memory-server');
            
            // Tạo thư mục lưu data
            const dbPath = path.join(__dirname, '..', '..', 'database', 'mongo_data');
            if (!fs.existsSync(dbPath)) fs.mkdirSync(dbPath, { recursive: true });

            const replSet = await MongoMemoryReplSet.create({
                replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' },
                instanceOpts: [{ port: 27017, dbPath: dbPath }]
            });
            
            const uri = replSet.getUri();
            console.log(`✅ Đã khởi động MongoDB Replica Set tự động tại: ${uri}`);
            
            await mongoose.connect(config.MONGO_URI);
            isConnected = true;
        } catch (memErr) {
            console.error('❌ Lỗi tự động chạy MongoDB:', memErr.message);
            process.exit(1);
        }
    }

    mongoose.connection.on('error', (err) => {
        console.error('❌ MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
        console.warn('⚠️ MongoDB bị ngắt kết nối.');
        isConnected = false;
    });
}

module.exports = { connect };
