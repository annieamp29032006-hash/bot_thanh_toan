/**
 * mariadb.js - Kết nối MariaDB (nguồn sản phẩm + đơn hàng bot)
 * Thay thế cho MongoDB.
 */
const mysql = require('mysql2/promise');
const config = require('../../config');

let pool = null;

function getPool() {
    if (!pool) {
        pool = mysql.createPool({
            host: config.DB_HOST,
            port: config.DB_PORT,
            user: config.DB_USER,
            password: config.DB_PASS,
            database: config.DB_NAME,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0,
            charset: 'utf8mb4',
            timezone: '+07:00'
        });
    }
    return pool;
}

/**
 * Query trả về mảng rows
 */
async function query(sql, params = []) {
    const [rows] = await getPool().execute(sql, params);
    return rows;
}

/**
 * Kiểm tra kết nối lúc khởi động
 */
async function connect() {
    const rows = await query('SELECT 1 AS ok');
    if (rows[0] && rows[0].ok === 1) {
        console.log(`✅ Đã kết nối MariaDB: ${config.DB_NAME}@${config.DB_HOST}`);
        return true;
    }
    throw new Error('Không kết nối được MariaDB');
}

async function close() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}

module.exports = { getPool, query, connect, close };
