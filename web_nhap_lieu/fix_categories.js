require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const Product = require('./src/models/Product');

async function fix() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB.');

        const data = JSON.parse(fs.readFileSync('groups.json', 'utf8'));
        let count = 0;

        for (const category in data) { // 'acc_pc', 'gcoin', 'steam', 'outfit'
            for (const group of data[category]) {
                const updated = await Product.findOneAndUpdate(
                    { name: group.name },
                    { webCategory: category }
                );
                if (updated) {
                    console.log(`Updated ${group.name} -> ${category}`);
                    count++;
                }
            }
        }
        
        console.log(`\n✅ Đã fix xong ${count} danh mục cũ.`);
    } catch (e) {
        console.error('Fix failed:', e);
    } finally {
        mongoose.connection.close();
    }
}

fix();
