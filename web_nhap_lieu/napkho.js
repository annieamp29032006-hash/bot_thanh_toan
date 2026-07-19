/**
 * napkho.js - Công cụ nạp kho siêu tốc qua dòng lệnh CLI
 * Cú pháp: node napkho.js <ID_Sản_Phẩm> <đường_dẫn_file.txt>
 */
require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');
const db = require('./src/utils/database');
const stockService = require('./src/services/stockService');
const productService = require('./src/services/productService');
const fileParser = require('./src/utils/fileParser');

const idOrCode = process.argv[2];
const filePath = process.argv[3];

if (!idOrCode || !filePath) {
    console.error('❌ LỖI: Vui lòng nhập đúng cú pháp.');
    console.log('👉 Cú pháp chuẩn: node napkho.js <ID_SẢN_PHẨM_HOẶC_MÃ> <tên_file.txt>');
    process.exit(1);
}

if (!fs.existsSync(filePath)) {
    console.error(`❌ LỖI: Không tìm thấy file "${filePath}". Vui lòng kiểm tra lại đường dẫn!`);
    process.exit(1);
}

async function run() {
    try {
        console.log('🔄 Đang kết nối Database...');
        await db.connect();

        const product = await productService.findByIdOrCode(idOrCode);
        if (!product) {
            console.error(`❌ LỖI: Không tìm thấy Sản phẩm nào có ID hoặc Mã là ${idOrCode}`);
            process.exit(1);
        }

        console.log(`📦 Đã tìm thấy sản phẩm: ${product.name}`);
        console.log('🔄 Đang đọc file và bóc tách dữ liệu...');

        const fileContent = fs.readFileSync(filePath, 'utf-8');
        const items = await fileParser.parseCSV(fileContent);

        if (items.length === 0) {
            console.error('❌ LỖI: File rỗng hoặc sai định dạng.');
            process.exit(1);
        }

        console.log(`🚀 Bắt đầu nạp ${items.length} items vào Database...`);
        const result = await stockService.bulkImport(product._id, items);

        console.log(`\n✅ THÀNH CÔNG! Đã bơm ${result.length} items vào kho của [${product.name}].`);
    } catch (err) {
        console.error('\n❌ LỖI BẤT NGỜ:', err);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Đã ngắt kết nối Database.');
        process.exit(0);
    }
}

run();
