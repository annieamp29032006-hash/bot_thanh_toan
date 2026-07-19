const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const productsPath = path.join(__dirname, '..', 'database', 'products.json');

// --- HÀM ĐỌC / GHI JSON ---
function readJSON(filePath) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } 
    catch { return { groups: [], accounts: [] }; }
}
function writeJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// --- BỘ NHỚ LƯU TRỮ ĐƠN HÀNG TẠM THỜI (PENDING ORDERS) ---
const pendingOrdersPath = path.join(__dirname, '..', 'database', 'pending_orders.json');

// Khởi tạo file nếu chưa có
if (!fs.existsSync(pendingOrdersPath)) {
    writeJSON(pendingOrdersPath, {});
}

// Dọn dẹp đơn hàng rác (quá 24 giờ không thanh toán)
setInterval(() => {
    const now = Date.now();
    let pendingOrders = {};
    try { pendingOrders = JSON.parse(fs.readFileSync(pendingOrdersPath, 'utf-8')); } catch (e) {}

    let changed = false;
    for (const [amountKey, order] of Object.entries(pendingOrders)) {
        if (now - order.timestamp > 15 * 60 * 1000) { // Hủy đơn sau 15 phút
            delete pendingOrders[amountKey];
            changed = true;
            console.log(`[Hệ thống] Hủy đơn hàng hết hạn với giá tiền lẻ: ${amountKey}đ`);
        }
    }
    
    if (changed) {
        writeJSON(pendingOrdersPath, pendingOrders);
    }
}, 5 * 60 * 1000); // Check mỗi 5 phút

// --- CÁC HÀM XỬ LÝ SẢN PHẨM ---

async function getCategories() {
    const db = readJSON(productsPath);
    return db.groups || [];
}

async function getAvailableProducts(groupId) {
    const db = readJSON(productsPath);
    let pendingOrders = {};
    try { pendingOrders = JSON.parse(fs.readFileSync(pendingOrdersPath, 'utf-8')); } catch (e) {}

    // Lấy những acc chưa bán (status = 0) và hiện không nằm trong đơn hàng chờ nào
    const pendingProductIds = Object.values(pendingOrders).map(o => o.productId);
    return (db.accounts || []).filter(a => a.groups == groupId && a.status === 0 && !pendingProductIds.includes(String(a.id)));
}

async function getProduct(productId) {
    const db = readJSON(productsPath);
    return db.accounts.find(a => String(a.id) === String(productId)) || null;
}

// Lưu ID tin nhắn Discord vào sản phẩm để sau này xóa
async function updateProductMessage(productId, channelId, messageId) {
    const db = readJSON(productsPath);
    const account = db.accounts.find(a => String(a.id) === String(productId));
    if (account) {
        account.discordChannelId = channelId;
        account.discordMessageId = messageId;
        writeJSON(productsPath, db);
    }
}

/**
 * Khách hàng chọn mua -> Tạo mã Đơn hàng (VD: DH 1234)
 */
async function createOrder(productId, discordUserId) {
    const db = readJSON(productsPath);
    const account = db.accounts.find(a => String(a.id) === String(productId) && a.status === 0);

    if (!account) return { success: false, message: 'Sản phẩm không tồn tại hoặc đã bị mua.' };
    
    let pendingOrders = {};
    try { pendingOrders = JSON.parse(fs.readFileSync(pendingOrdersPath, 'utf-8')); } catch (e) {}

    // Kiểm tra xem acc này có đang bị người khác "giữ chỗ" không
    const isPending = Object.values(pendingOrders).some(o => o.productId === String(productId));
    if (isPending) return { success: false, message: 'Sản phẩm đang được người khác chờ thanh toán. Vui lòng chọn sản phẩm khác!' };

    // Tạo mã đơn ngẫu nhiên và duy nhất (Mã tham chiếu sổ sách)
    const randomHex = crypto.randomBytes(6).toString('hex').toUpperCase();
    const orderCode = `W2M-${randomHex}`;

    // Tạo giá tiền lẻ độc nhất
    const basePrice = parseInt(account.price) || 0;
    let finalPrice;
    
    // Tìm một số ngẫu nhiên từ 1 đến 999 sao cho finalPrice chưa bị trùng
    let attempts = 0;
    while (attempts < 2000) { // Lặp tối đa 2000 lần để tránh sập CPU
        const randomFraction = Math.floor(Math.random() * 999) + 1; // Từ 1 đến 999
        finalPrice = basePrice + randomFraction;
        
        // Nếu số tiền này chưa có ai đang chờ thanh toán thì chọn luôn
        if (!pendingOrders[finalPrice]) {
            break;
        }
        attempts++;
    }

    // Chốt chặn chống sập: Đã xài hết 999 số
    if (attempts >= 2000) {
        return { success: false, message: '🔥 Hệ thống đang quá tải (vượt quá 999 đơn chờ). Vui lòng quay lại sau ít phút!' };
    }
    
    pendingOrders[finalPrice] = {
        productId: String(productId),
        discordUserId: discordUserId,
        orderCode: orderCode,
        timestamp: Date.now()
    };
    
    writeJSON(pendingOrdersPath, pendingOrders);

    return { 
        success: true, 
        finalPrice: finalPrice,
        orderCode: orderCode,
        productName: `Mã số #${account.id}`
    };
}

/**
 * Mua Số Lượng Lớn (Mua Sỉ)
 */
async function createGroupedOrder(templateId, quantity, discordUserId) {
    const db = readJSON(productsPath);
    const template = db.accounts.find(a => String(a.id) === String(templateId));
    if (!template) return { success: false, message: 'Không tìm thấy sản phẩm mẫu.' };

    const availableProducts = await getAvailableProducts(String(template.groups));
    const matches = availableProducts.filter(p => p.price === template.price && p.description === template.description);

    if (matches.length < quantity) {
        return { success: false, message: `Kho chỉ còn ${matches.length} chiếc, không đủ số lượng bạn yêu cầu!` };
    }

    const selectedProducts = matches.slice(0, quantity);
    const productIds = selectedProducts.map(p => String(p.id));
    const basePrice = parseInt(template.price || 0) * quantity;

    let pendingOrders = {};
    try { pendingOrders = JSON.parse(fs.readFileSync(pendingOrdersPath, 'utf-8')); } catch (e) {}

    // Kiểm tra xem các acc này có đang bị "giữ chỗ" không
    const pendingValues = Object.values(pendingOrders);
    for (const id of productIds) {
        const isPending = pendingValues.some(o => (o.productId === id) || (o.productIds && o.productIds.includes(id)));
        if (isPending) return { success: false, message: 'Một số sản phẩm trong giỏ hàng đang được người khác thanh toán. Vui lòng thử lại sau!' };
    }

    const randomHex = crypto.randomBytes(6).toString('hex').toUpperCase();
    const orderCode = `W2M-${randomHex}`;

    let finalPrice;
    let attempts = 0;
    while (attempts < 2000) {
        const randomFraction = Math.floor(Math.random() * 999) + 1; // Từ 1 đến 999
        finalPrice = basePrice + randomFraction;
        if (!pendingOrders[finalPrice]) break;
        attempts++;
    }

    if (attempts >= 2000) {
        return { success: false, message: '🔥 Hệ thống đang quá tải. Vui lòng quay lại sau ít phút!' };
    }
    
    pendingOrders[finalPrice] = {
        productIds: productIds,
        discordUserId: discordUserId,
        orderCode: orderCode,
        timestamp: Date.now()
    };
    
    writeJSON(pendingOrdersPath, pendingOrders);

    return { 
        success: true, 
        finalPrice: finalPrice,
        orderCode: orderCode,
        productName: `Combo ${quantity}x ${template.description || 'Mã số #' + template.id}`
    };
}

/**
 * Webhook gọi hàm này khi nhận được tiền để duyệt đơn bằng SỐ TIỀN
 */
async function fulfillOrder(amountPaid) {
    let pendingOrders = {};
    try { pendingOrders = JSON.parse(fs.readFileSync(pendingOrdersPath, 'utf-8')); } catch (e) {}

    const order = pendingOrders[parseInt(amountPaid)];
    if (!order) return { success: false, message: `Không tìm thấy đơn hàng đang chờ cho số tiền ${amountPaid}đ.` };

    const db = readJSON(productsPath);

    let purchasedAccounts = [];

    // Xử lý giỏ hàng nhiều món (Mua sỉ)
    if (order.productIds && Array.isArray(order.productIds)) {
        for (const pid of order.productIds) {
            const acc = db.accounts.find(a => String(a.id) === pid);
            if (acc && acc.status === 0) {
                acc.status = 1;
                acc.buyer = order.discordUserId;
                purchasedAccounts.push(acc);
            }
        }
        if (purchasedAccounts.length === 0) {
            delete pendingOrders[parseInt(amountPaid)];
            writeJSON(pendingOrdersPath, pendingOrders);
            return { success: false, message: 'Tất cả sản phẩm trong giỏ đã bị bán (Lỗi hệ thống).' };
        }
    } 
    // Xử lý đơn mua 1 món cũ (Tương thích ngược)
    else if (order.productId) {
        const account = db.accounts.find(a => String(a.id) === order.productId);
        if (!account || account.status !== 0) {
            delete pendingOrders[parseInt(amountPaid)];
            writeJSON(pendingOrdersPath, pendingOrders);
            return { success: false, message: 'Sản phẩm đã bị bán từ trước (Lỗi hệ thống).' };
        }
        account.status = 1;
        account.buyer = order.discordUserId;
        purchasedAccounts.push(account);
    }

    writeJSON(productsPath, db);
    
    delete pendingOrders[parseInt(amountPaid)]; // Xóa khỏi hàng chờ
    writeJSON(pendingOrdersPath, pendingOrders);

    return { success: true, accounts: purchasedAccounts, account: purchasedAccounts[0], discordUserId: order.discordUserId, orderCode: order.orderCode };
}

/**
 * Thêm sản phẩm mới vào DB
 */
function addProduct(product) {
    const db = readJSON(productsPath);
    let maxId = 0;
    if (db.accounts && db.accounts.length > 0) {
        maxId = Math.max(...db.accounts.map(a => a.id || 0));
    }
    const newId = maxId + 1;
    product.id = newId;
    product.status = 0; // Chưa bán
    db.accounts.push(product);
    writeJSON(productsPath, db);
    return { success: true, product };
}

/**
 * Cập nhật thông tin kênh và tin nhắn của sản phẩm
 */
function updateProductMsg(productId, channelId, messageId) {
    const db = readJSON(productsPath);
    const account = db.accounts.find(a => String(a.id) === String(productId));
    if (account) {
        account.discordChannelId = channelId;
        account.discordMessageId = messageId;
        writeJSON(productsPath, db);
    }
}

module.exports = {
    getCategories,
    getAvailableProducts,
    getProduct,
    updateProductMessage,
    createOrder,
    createGroupedOrder,
    fulfillOrder,
    addProduct,
    updateProductMsg
};
