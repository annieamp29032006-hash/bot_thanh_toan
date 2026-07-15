/**
 * catalogService.js - Đọc sản phẩm TRỰC TIẾP từ MariaDB (web shop)
 *
 * Cấu trúc web:  categories -> groups -> list_items (từng acc/code)
 *   list_items.status: 0 = còn hàng | 1 = đã bán | 2 = đang khoá chờ thanh toán (bot đặt)
 *
 * Vì trong 1 group có nhiều acc TRÙNG HỆT nhau (cùng tên + giá) nên bot gom
 * chúng thành "variant" (biến thể). Khách chọn variant + số lượng, hệ thống tự
 * cấp phát N acc còn trống trong pool đó.
 */
const db = require('../utils/mariadb');
const config = require('../../config');

const PRICE_MIN = config.MIN_VALID_PRICE;
const PRICE_MAX = config.MAX_VALID_PRICE;

// Điều kiện 1 acc "còn bán được"
const AVAIL = `status = 0 AND price BETWEEN ${PRICE_MIN} AND ${PRICE_MAX}`;

// ═══════════════════════════════════════════════════
// PARSERS
// ═══════════════════════════════════════════════════
function buildImageUrl(pathOrJson) {
    if (!pathOrJson) return '';
    let p = pathOrJson;
    if (typeof p === 'string' && p.trim().startsWith('[')) {
        try {
            const arr = JSON.parse(p);
            p = Array.isArray(arr) && arr.length > 0 ? arr[0] : '';
        } catch { p = ''; }
    }
    if (!p) return '';
    if (p.startsWith('http')) return p;
    return config.IMAGE_BASE_URL.replace(/\/$/, '') + '/' + String(p).replace(/^\//, '');
}

function parseHighlights(raw) {
    if (!raw) return [];
    try {
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        return arr
            .filter(h => h && h.value !== undefined && h.value !== null && String(h.value).trim() !== '')
            .map(h => {
                const name = (h.name || '').toString().trim();
                const value = h.value.toString().trim();
                return name ? `${name}: ${value}` : value;
            });
    } catch {
        return [];
    }
}

function stripHtml(html) {
    if (!html) return '';
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function descLinesOf(row) {
    const highlights = parseHighlights(row.highlights);
    if (highlights.length > 0) return highlights;
    if (row.description) {
        return stripHtml(row.description).split('\n').map(s => s.trim()).filter(Boolean);
    }
    return [];
}

// ═══════════════════════════════════════════════════
// DANH MỤC (category)
// ═══════════════════════════════════════════════════
async function getCategories() {
    const rows = await db.query(
        `SELECT g.category_id AS id, g.category_name AS name, COUNT(li.id) AS avail
         FROM \`groups\` g
         JOIN list_items li ON li.group_id = g.id AND li.${AVAIL}
         GROUP BY g.category_id, g.category_name
         HAVING avail > 0
         ORDER BY avail DESC`
    );
    return rows.map(r => ({ id: r.id, name: r.name, avail: Number(r.avail) }));
}

// ═══════════════════════════════════════════════════
// NHÓM SẢN PHẨM (group) trong 1 danh mục
// ═══════════════════════════════════════════════════
async function getGroups(categoryId) {
    const rows = await db.query(
        `SELECT g.id, g.name, g.image, g.category_id, g.category_name,
                COUNT(li.id) AS avail, MIN(li.price) AS min_price
         FROM \`groups\` g
         JOIN list_items li ON li.group_id = g.id AND li.${AVAIL}
         WHERE g.category_id = ?
         GROUP BY g.id
         HAVING avail > 0
         ORDER BY g.priority ASC, g.id ASC`,
        [categoryId]
    );
    return rows.map(r => ({
        id: r.id,
        name: r.name,
        categoryId: r.category_id,
        categoryName: r.category_name,
        image: buildImageUrl(r.image),
        avail: Number(r.avail),
        minPrice: Number(r.min_price)
    }));
}

async function getGroup(groupId) {
    const rows = await db.query(
        `SELECT id, name, image, category_id, category_name FROM \`groups\` WHERE id = ?`,
        [groupId]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
        id: r.id, name: r.name, categoryId: r.category_id, categoryName: r.category_name,
        image: buildImageUrl(r.image), avail: await countGroupAvailable(groupId)
    };
}

async function countGroupAvailable(groupId) {
    const rows = await db.query(
        `SELECT COUNT(*) AS c FROM list_items WHERE group_id = ? AND ${AVAIL}`, [groupId]
    );
    return Number(rows[0].c);
}

// ═══════════════════════════════════════════════════
// VARIANT (gom acc trùng tên+giá) trong 1 group
// Khoá variant = list_items.id đại diện (MIN id) — ổn định & an toàn cho customId
// ═══════════════════════════════════════════════════
async function countVariants(groupId) {
    const rows = await db.query(
        `SELECT COUNT(*) AS c FROM (
            SELECT 1 FROM list_items WHERE group_id = ? AND ${AVAIL} GROUP BY name, price
         ) t`,
        [groupId]
    );
    return Number(rows[0].c);
}

/**
 * Danh sách variant của 1 group (có phân trang).
 * page bắt đầu từ 1. Trả về { items, total, totalPages }.
 */
async function getVariants(groupId, page = 1, limit = 25) {
    const offset = (page - 1) * limit;
    const total = await countVariants(groupId);
    const rows = await db.query(
        `SELECT MIN(id) AS rep_id, name, price,
                COUNT(*) AS qty,
                SUBSTRING_INDEX(GROUP_CONCAT(highlights ORDER BY id SEPARATOR '\\n<<>>\\n'), '\\n<<>>\\n', 1) AS highlights,
                SUBSTRING_INDEX(GROUP_CONCAT(list_image ORDER BY id SEPARATOR '\\n<<>>\\n'), '\\n<<>>\\n', 1) AS list_image
         FROM list_items
         WHERE group_id = ? AND ${AVAIL}
         GROUP BY name, price
         ORDER BY price ASC
         LIMIT ? OFFSET ?`,
        [groupId, limit, offset]
    );
    return {
        items: rows.map(r => ({
            repId: r.rep_id,
            name: r.name || 'Sản phẩm',
            price: Number(r.price),
            qty: Number(r.qty),
            descLines: descLinesOf(r),
            imageUrl: buildImageUrl(r.list_image)
        })),
        total,
        totalPages: Math.max(1, Math.ceil(total / limit))
    };
}

/**
 * Giải mã variant từ rep_id (id đại diện). Đọc được kể cả rep item đã bị bán,
 * rồi đếm lại số còn trống theo (group, name, price).
 */
async function getVariantByRep(repId) {
    const rows = await db.query(
        `SELECT id, group_id, name, price, highlights, list_image, description FROM list_items WHERE id = ?`,
        [repId]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    const cnt = await db.query(
        `SELECT COUNT(*) AS c FROM list_items WHERE group_id = ? AND name = ? AND price = ? AND ${AVAIL}`,
        [r.group_id, r.name, r.price]
    );
    return {
        repId: r.id,
        groupId: r.group_id,
        name: r.name || 'Sản phẩm',
        price: Number(r.price),
        qty: Number(cnt[0].c),
        descLines: descLinesOf(r),
        imageUrl: buildImageUrl(r.list_image)
    };
}

// ═══════════════════════════════════════════════════
// KHOÁ / NHẢ / BÁN (atomic chống bán trùng)
// ═══════════════════════════════════════════════════

/**
 * Khoá N acc của 1 variant (group+name+price): status 0 -> 2.
 * Dùng transaction + SELECT ... FOR UPDATE để chống 2 khách giành cùng lúc.
 * Trả về { success, lockedIds, message }.
 */
async function lockVariantStock(groupId, name, price, quantity) {
    const conn = await db.getPool().getConnection();
    try {
        await conn.beginTransaction();
        const [rows] = await conn.query(
            `SELECT id FROM list_items
             WHERE group_id = ? AND name = ? AND price = ? AND ${AVAIL}
             ORDER BY id ASC LIMIT ? FOR UPDATE`,
            [groupId, name, price, quantity]
        );
        if (rows.length < quantity) {
            await conn.rollback();
            return {
                success: false,
                lockedIds: [],
                message: `Chỉ còn ${rows.length}/${quantity} sản phẩm trong kho (hoặc có người đang giao dịch). Vui lòng giảm số lượng hoặc thử lại sau.`
            };
        }
        const ids = rows.map(r => r.id);
        await conn.query(
            `UPDATE list_items SET status = 2 WHERE id IN (${ids.map(() => '?').join(',')})`,
            ids
        );
        await conn.commit();
        return { success: true, lockedIds: ids, message: '' };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Nhả acc đang khoá về còn hàng (huỷ / hết hạn): status 2 -> 0
 */
async function releaseStock(ids) {
    if (!ids || ids.length === 0) return;
    await db.query(
        `UPDATE list_items SET status = 0 WHERE status = 2 AND id IN (${ids.map(() => '?').join(',')})`,
        ids
    );
}

/**
 * Xác nhận đã bán N acc: status -> 1 + thông tin người mua
 */
async function markSold(ids, buyerName, buyerCode, amount) {
    if (!ids || ids.length === 0) return;
    await db.query(
        `UPDATE list_items
         SET status = 1, buyer_name = ?, buyer_code = ?, buyer_paym = ?, buyer_date = NOW()
         WHERE id IN (${ids.map(() => '?').join(',')})`,
        [buyerName || '', buyerCode || '', amount || 0, ...ids]
    );
}

/**
 * Lấy user/pass của các acc theo id (để giao hàng) - bất kể trạng thái
 */
async function getItemsByIds(ids) {
    if (!ids || ids.length === 0) return [];
    const rows = await db.query(
        `SELECT id, name, code, price, username, password FROM list_items
         WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids
    );
    return rows.map(r => ({
        id: r.id, name: r.name, code: r.code, price: Number(r.price),
        username: r.username || '', password: r.password || ''
    }));
}

module.exports = {
    getCategories,
    getGroups,
    getGroup,
    countGroupAvailable,
    countVariants,
    getVariants,
    getVariantByRep,
    lockVariantStock,
    releaseStock,
    markSold,
    getItemsByIds,
    buildImageUrl,
    parseHighlights,
    stripHtml
};
