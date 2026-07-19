const mysql = require('mysql2/promise');
const dbConfig = { host: 'localhost', user: 'root', password: '123456', database: 'bot_thanh_toan' };

async function setup() {
    const connection = await mysql.createConnection(dbConfig);
    try {
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS bot_transactions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                order_code VARCHAR(50) NOT NULL,
                user_id VARCHAR(50) NOT NULL,
                discord_tag VARCHAR(100) NOT NULL,
                product_type VARCHAR(50) NOT NULL,
                qty INT NOT NULL,
                amount INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("✅ Tạo bảng bot_transactions thành công!");
    } catch (err) {
        console.error("Lỗi:", err);
    } finally {
        await connection.end();
    }
}
setup();
