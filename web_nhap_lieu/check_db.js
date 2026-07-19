const mysql = require('mysql2/promise');
async function run() {
    const conn = await mysql.createConnection({ host: '127.0.0.1', user: 'root', password: '123456', database: 'bot_thanh_toan' });
    const [cols] = await conn.execute('SHOW COLUMNS FROM list_items');
    console.log(cols);
    process.exit();
}
run();
