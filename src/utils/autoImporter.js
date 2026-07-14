/**
 * autoImporter.js - Quét thư mục imports và nạp kho tự động
 */
const fs = require('fs');
const path = require('path');
const fileParser = require('./fileParser');
const stockService = require('../services/stockService');
const productService = require('../services/productService');
const logService = require('../services/logService');

const IMPORTS_DIR = path.join(__dirname, '../../imports');
const DONE_DIR = path.join(__dirname, '../../imports/done');

let isScanning = false;

async function scanImports() {
    if (isScanning) return;
    isScanning = true;

    try {
        if (!fs.existsSync(IMPORTS_DIR)) fs.mkdirSync(IMPORTS_DIR, { recursive: true });
        if (!fs.existsSync(DONE_DIR)) fs.mkdirSync(DONE_DIR, { recursive: true });

        const files = fs.readdirSync(IMPORTS_DIR);

        for (const file of files) {
            const filePath = path.join(IMPORTS_DIR, file);
            
            // Bỏ qua thư mục (như done)
            if (fs.statSync(filePath).isDirectory()) continue;
            
            // Chỉ xử lý .txt và .csv
            if (!file.endsWith('.txt') && !file.endsWith('.csv')) continue;

            // Tên file có thể là ID 24 ký tự hoặc Mã SP (Code)
            const idOrCode = file.replace(/\.(txt|csv)$/i, '');

            const product = await productService.findByIdOrCode(idOrCode);
            if (!product) {
                console.warn(`[AutoImport] Không tìm thấy sản phẩm với ID hoặc Mã: ${idOrCode} cho file ${file}`);
                continue;
            }

            console.log(`[AutoImport] Phát hiện file nạp kho cho: ${product.name} (${file}). Đang xử lý...`);
            
            try {
                const fileContent = fs.readFileSync(filePath, 'utf-8');
                const items = await fileParser.parseCSV(fileContent);

                if (items.length > 0) {
                    const result = await stockService.bulkImport(product._id, items);
                    
                    const msg = `✅ Đã nạp thành công **${result.length}** sản phẩm vào kho **${product.name}** thông qua Auto-Import (File: ${file}).`;
                    console.log(`[AutoImport] ${msg}`);
                    await logService.info('system', msg);
                } else {
                    console.log(`[AutoImport] File ${file} rỗng hoặc định dạng không đúng.`);
                }

                // Chuyển file sang thư mục done
                const donePath = path.join(DONE_DIR, `${Date.now()}_${file}`);
                fs.renameSync(filePath, donePath);
            } catch (err) {
                console.error(`[AutoImport] Lỗi khi xử lý file ${file}:`, err);
                
                // Đổi đuôi thành .err để không xử lý lại
                const errPath = path.join(IMPORTS_DIR, `${file}.err`);
                fs.renameSync(filePath, errPath);
            }
        }
    } catch (error) {
        console.error('[AutoImport] Lỗi tổng thể:', error);
    } finally {
        isScanning = false;
    }
}

function start() {
    console.log('[AutoImport] Trình theo dõi thư mục imports/ đã khởi động...');
    // Quét mỗi 5 giây
    setInterval(scanImports, 5000);
}

module.exports = { start, scanImports };
