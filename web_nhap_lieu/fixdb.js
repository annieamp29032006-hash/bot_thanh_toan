const mysql = require('mysql2/promise');

async function run() {
    const conn = await mysql.createConnection({host: '127.0.0.1', user: 'root', password: '123456', database: 'bot_thanh_toan'});
    await conn.execute("ALTER TABLE list_items MODIFY COLUMN extra_data TEXT");
    await conn.execute("UPDATE list_items SET extra_data = CONCAT(extra_data, ' | ', description), description = '' WHERE description LIKE '%@%'");
    console.log('Fixed DB');
    await conn.end();
}

run();
