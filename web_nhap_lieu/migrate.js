require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const Product = require('./src/models/Product');

async function migrate() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB.');

        const data = JSON.parse(fs.readFileSync('groups.json', 'utf8'));
        let count = 0;

        for (const category in data) {
            for (const group of data[category]) {
                const existing = await Product.findOne({ name: group.name });
                if (!existing) {
                    let pType = group.type === 'account' ? 'account' : 'code';
                    await Product.create({
                        name: group.name,
                        type: pType,
                        price: 0,
                        description: 'Được di chuyển từ danh mục cũ'
                    });
                    console.log(`Migrated: ${group.name}`);
                    count++;
                }
            }
        }
        
        console.log(`\n✅ Migration hoàn tất. Đã chuyển ${count} danh mục cũ vào MongoDB.`);
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        mongoose.connection.close();
    }
}

migrate();
