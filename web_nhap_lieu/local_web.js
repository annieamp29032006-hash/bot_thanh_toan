require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const mongoose = require('mongoose');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

// MongoDB Models
const Product = require('./src/models/Product');
const ProductStock = require('./src/models/ProductStock');
const Order = require('./src/models/Order');
const Category = require('./src/models/Category');

const app = express();
const port = 3000;

// CORS chỉ cho chính domain này. Trước đây mở cho mọi origin, nghĩa là bất kỳ
// trang web nào cũng gọi được API quản trị bằng phiên đăng nhập của bạn.
app.use(cors({ origin: false, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const upload = multer({ dest: 'uploads/' });

// ═══════════════════════════════════════════════════
// ĐĂNG NHẬP
// Phiên ký bằng HMAC trong cookie httpOnly - không cần store, restart vẫn còn hiệu lực.
// ═══════════════════════════════════════════════════
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS_HASH = process.env.ADMIN_PASS_HASH || ''; // sha256 của mật khẩu
const SESSION_HOURS = 12;
const COOKIE = 'kaiz_session';

if (!SESSION_SECRET || !ADMIN_PASS_HASH) {
    console.error('❌ Thiếu SESSION_SECRET hoặc ADMIN_PASS_HASH trong .env - từ chối khởi động.');
    process.exit(1);
}

const sha256 = v => crypto.createHash('sha256').update(String(v)).digest('hex');

function signSession(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    return `${body}.${sig}`;
}

function verifySession(token) {
    if (!token || !token.includes('.')) return null;
    const [body, sig] = token.split('.');
    const expect = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    // timingSafeEqual để so sánh chữ ký không bị đoán qua thời gian phản hồi
    const a = Buffer.from(sig || ''), b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
        const data = JSON.parse(Buffer.from(body, 'base64url').toString());
        if (!data.exp || Date.now() > data.exp) return null;
        return data;
    } catch { return null; }
}

// Chặn dò mật khẩu: quá 8 lần sai trong 15 phút thì khoá theo IP
const failed = new Map();
function tooManyAttempts(ip) {
    const rec = failed.get(ip);
    if (!rec) return false;
    if (Date.now() - rec.first > 15 * 60 * 1000) { failed.delete(ip); return false; }
    return rec.count >= 8;
}
function noteFailure(ip) {
    const rec = failed.get(ip);
    if (!rec || Date.now() - rec.first > 15 * 60 * 1000) failed.set(ip, { count: 1, first: Date.now() });
    else rec.count++;
}

function requireAuth(req, res, next) {
    if (verifySession(req.cookies[COOKIE])) return next();
    // API trả JSON để frontend biết mà chuyển về trang đăng nhập
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Chưa đăng nhập' });
    return res.redirect('/login');
}

app.get('/login', (req, res) => {
    if (verifySession(req.cookies[COOKIE])) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', (req, res) => {
    const ip = req.ip || 'unknown';
    if (tooManyAttempts(ip)) {
        return res.status(429).json({ error: 'Sai quá nhiều lần. Vui lòng thử lại sau 15 phút.' });
    }
    const { username, password } = req.body || {};
    const okUser = String(username || '') === ADMIN_USER;
    const okPass = sha256(password || '') === ADMIN_PASS_HASH;
    if (!okUser || !okPass) {
        noteFailure(ip);
        return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu' });
    }
    failed.delete(ip);
    const token = signSession({ u: ADMIN_USER, exp: Date.now() + SESSION_HOURS * 3600 * 1000 });
    res.cookie(COOKIE, token, {
        httpOnly: true,                             // JS của trang không đọc được -> chống XSS lấy phiên
        secure: true,                               // chỉ gửi qua HTTPS
        sameSite: 'lax',                            // chống CSRF cơ bản
        maxAge: SESSION_HOURS * 3600 * 1000
    });
    res.json({ success: true });
});

app.post('/api/logout', (req, res) => {
    res.clearCookie(COOKIE);
    res.json({ success: true });
});

app.get('/api/me', requireAuth, (req, res) => {
    res.json({ user: verifySession(req.cookies[COOKIE]).u });
});

// TỪ ĐÂY TRỞ XUỐNG BẮT BUỘC ĐĂNG NHẬP.
// Đặt trước express.static để index.html (bảng quản trị) cũng được bảo vệ.
app.use(requireAuth);
app.use(express.static('public'));

// Kết nối MongoDB thay vì MySQL
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Web Admin đã kết nối MongoDB thành công!'))
    .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// UPLOAD TÀI KHOẢN/CODE
app.post('/api/upload', upload.array('images', 100), async (req, res) => {
    try {
        const { group_id, batch_data, price, description } = req.body;
        const files = req.files;
        
        if (!group_id || !batch_data || !files || files.length === 0) {
            if (files) files.forEach(f => { if(fs.existsSync(f.path)) fs.unlinkSync(f.path); });
            return res.status(400).json({ success: false, message: 'Vui lòng điền đủ thông tin và chọn ít nhất 1 ảnh!' });
        }
        
        // Tìm Product trong MongoDB
        const product = await Product.findById(group_id);
        if (!product) {
            if (files) files.forEach(f => { if(fs.existsSync(f.path)) fs.unlinkSync(f.path); });
            return res.status(404).json({ success: false, message: 'Không tìm thấy sản phẩm trong hệ thống Bot!' });
        }
        const itemType = product.type;
        
        // 1. Upload ảnh lên Discord Webhook
        let webhookUrl = process.env.DISCORD_WEBHOOK_URL;
        if (!webhookUrl) {
            files.forEach(f => { if(fs.existsSync(f.path)) fs.unlinkSync(f.path); });
            return res.status(500).json({ success: false, message: 'Chưa cấu hình DISCORD_WEBHOOK_URL trong .env!' });
        }
        
        if (!webhookUrl.includes('?wait=true')) {
            webhookUrl += '?wait=true';
        }
        
        const imageUrls = [];
        try {
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                const form = new FormData();
                form.append('file', fs.createReadStream(f.path), f.originalname);
                
                const discordRes = await axios.post(webhookUrl, form, { headers: form.getHeaders() });
                if (discordRes.data && discordRes.data.attachments && discordRes.data.attachments.length > 0) {
                    imageUrls.push(discordRes.data.attachments[0].url);
                } else {
                    throw new Error("Không nhận được link ảnh cho " + f.originalname);
                }
                fs.unlinkSync(f.path);
            }
        } catch (e) {
            files.forEach(f => { if(fs.existsSync(f.path)) fs.unlinkSync(f.path); });
            return res.status(500).json({ success: false, message: 'Lỗi tải ảnh lên Discord: ' + e.message });
        }
        
        // Cập nhật giá và mô tả cho danh mục (nếu có)
        const updateData = {};
        if (price) updateData.price = Number(price) || 0;
        if (description) updateData.description = description;
        if (imageUrls.length > 0) updateData.imageUrl = imageUrls[0];
        if (Object.keys(updateData).length > 0) {
            await Product.findByIdAndUpdate(group_id, updateData);
        }

        // 2. Lưu vào MongoDB ProductStock
        let lines = [];
        if (batch_data.includes('!')) {
            lines = batch_data.split('!').map(l => l.trim()).filter(l => l.length > 0);
        } else {
            lines = batch_data.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        }
        
        let uploadedCount = 0;
        const docs = [];
        
        for (let i = 0; i < lines.length; i++) {
            const parts = lines[i].split('|').map(p => p.trim());
            let currentUsr = 'CODE';
            let currentPass = '';
            
            if (itemType === 'account') {
                if (parts.length >= 2) {
                    currentUsr = parts[0];
                    currentPass = parts[1];
                } else {
                    currentUsr = parts[0];
                }
            } else {
                currentUsr = parts[0]; // code content
            }
            
            if (!currentUsr) continue;
            
            const lineImage = imageUrls[i] || imageUrls[imageUrls.length - 1]; // Trải đều ảnh nếu thiếu

            docs.push({
                productId: product._id,
                content: currentUsr,
                password: currentPass,
                imageUrl: lineImage,
                status: 'available'
            });
            uploadedCount++;
        }
        
        if (docs.length > 0) {
            await ProductStock.insertMany(docs);
        }
        
        res.json({ success: true, message: `Đã tải lên thành công ${uploadedCount} tài khoản/code vào kho của Bot!`, data: { count: uploadedCount, image: imageUrls[0] } });
    } catch (error) {
        console.error(error);
        if (req.files) req.files.forEach(f => { if(fs.existsSync(f.path)) fs.unlinkSync(f.path); });
        res.status(500).json({ success: false, message: error.message });
    }
});

// API THỐNG KÊ (Từ MongoDB Orders)
app.get('/api/stats', async (req, res) => {
    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const [todayAgg] = await Order.aggregate([
            { $match: { status: 'delivered', paidAt: { $gte: startOfDay } } },
            { $group: { _id: null, total: { $sum: "$totalAmount" } } }
        ]);

        const [monthAgg] = await Order.aggregate([
            { $match: { status: 'delivered', paidAt: { $gte: startOfMonth } } },
            { $group: { _id: null, total: { $sum: "$totalAmount" } } }
        ]);

        const [allAgg] = await Order.aggregate([
            { $match: { status: 'delivered' } },
            { $group: { _id: null, total: { $sum: "$totalAmount" } } }
        ]);
        
        const recentOrders = await Order.find({ status: 'delivered' }).sort({ createdAt: -1 }).limit(20);
        
        res.json({
            success: true,
            data: {
                today: todayAgg ? todayAgg.total : 0,
                month: monthAgg ? monthAgg.total : 0,
                all: allAgg ? allAgg.total : 0,
                recentOrders: recentOrders.map(o => ({
                    order_code: o.reference,
                    discord_tag: `<@${o.userId}>`,
                    product_type: o.productType,
                    qty: o.quantity,
                    amount: o.totalAmount,
                    created_at: o.createdAt
                }))
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// API QUẢN LÝ TỒN KHO
app.get('/api/inventory', async (req, res) => {
    try {
        const { group_id } = req.query;
        let query = {};
        if (group_id) {
            query.productId = group_id;
        }
        
        const stocks = await ProductStock.find(query).sort({ status: 1, createdAt: -1 }).limit(500).populate('productId');
        
        const mapped = stocks.map(s => ({
            id: s._id,
            code: s.productId ? s.productId.name : 'N/A',
            username: s.content,
            password: s.password,
            status: s.status === 'available' ? 0 : 1,
            buyer_name: s.soldTo,
            buyer_code: '',
            created_at: s.createdAt,
            price: s.productId ? s.productId.price : 0,
            extra_data: ''
        }));
        
        res.json({ success: true, data: mapped });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.put('/api/inventory/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { username, password } = req.body;
        await ProductStock.findByIdAndUpdate(id, { content: username, password: password });
        res.json({ success: true, message: 'Đã cập nhật sản phẩm' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.delete('/api/inventory/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await ProductStock.findByIdAndDelete(id);
        res.json({ success: true, message: 'Đã xóa sản phẩm khỏi kho' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// API QUẢN LÝ MẶT HÀNG (Ánh xạ MongoDB Product sang category format cho frontend)
app.get('/api/groups', async (req, res) => {
    try {
        // Dựng theo danh mục ĐỘNG trong DB, không hardcode 4 cái cũ - nếu hardcode thì
        // mặt hàng thuộc danh mục mới tạo sẽ vô hình ở tab Quản Lý Mặt Hàng.
        const [products, cats] = await Promise.all([
            Product.find({ isActive: true }).lean(),
            Category.find().sort({ sortOrder: 1 }).lean()
        ]);

        const data = {};
        for (const c of cats) data[c.key] = [];

        for (const p of products) {
            const k = p.webCategory || 'khac';
            if (!data[k]) data[k] = []; // sản phẩm trỏ vào danh mục đã bị xoá -> vẫn hiện để còn dọn
            data[k].push({ id: p._id.toString(), name: p.name, type: p.type });
        }

        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/groups', async (req, res) => {
    try {
        const { category, name } = req.body;
        if (!name) return res.status(400).json({ error: 'Thiếu tên mặt hàng' });
        if (!category) return res.status(400).json({ error: 'Chưa chọn danh mục' });

        // Mặt hàng gắn được vào cả cấp 1 lẫn cấp 2. Bot tự xử: cấp 1 nào chưa có
        // danh mục con thì bấm vào ra thẳng sản phẩm.
        const cat = await Category.findOne({ key: category });
        if (!cat) return res.status(400).json({ error: `Không tìm thấy danh mục "${category}"` });

        // Kiểu bán SUY TỪ DANH MỤC, không cho chọn riêng ở đây nữa - để hai chỗ cùng
        // cấu hình thì sớm muộn cũng lệch nhau, mà lệch thì hàng bày sai kiểu.
        // 'specific' -> account: nạp kho dạng user|pass, bày tách từng cái.
        // 'quantity' -> code:    nạp kho mỗi dòng một mã, bày gộp theo số lượng.
        const type = cat.sellMode === 'specific' ? 'account' : 'code';

        const newProduct = await Product.create({
            name: name,
            type: type,
            webCategory: category,
            price: 0, // Frontend không có price, đặt mặc định 0, user phải set lại qua Discord
            description: 'Tạo từ Web Admin'
        });
        
        res.json({ success: true, message: 'Đã thêm mặt hàng (Hãy dùng lệnh /product edit trên Discord để đặt giá!)', data: { id: newProduct._id.toString(), name, type } });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/groups/:category/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await Product.findByIdAndDelete(id);
        await ProductStock.deleteMany({ productId: id });
        res.json({ success: true, message: 'Đã xóa mặt hàng và kho liên quan' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════
// DANH MỤC SẢN PHẨM (Category) - bot dùng ảnh này để hiển thị
// Ảnh CHỈ lưu link. Có thể dán link sẵn, hoặc up file để lấy link từ Discord.
// ═══════════════════════════════════════════════════
app.get('/api/categories', async (req, res) => {
    try {
        const cats = await Category.find().sort({ sortOrder: 1, name: 1 }).lean();
        const counts = await Product.aggregate([
            { $match: { isActive: true } },
            { $group: { _id: '$webCategory', n: { $sum: 1 } } }
        ]);
        const map = new Map(counts.map(c => [c._id, c.n]));

        const shape = c => ({
            key: c.key, name: c.name, parentKey: c.parentKey || null,
            level: c.parentKey ? 2 : 1,
            description: c.description || '', imageUrl: c.imageUrl || '',
            sellMode: c.sellMode || 'quantity',
            sortOrder: c.sortOrder, isActive: c.isActive,
            productCount: map.get(c.key) || 0
        });

        const all = cats.map(shape);

        // ?flat=1 -> danh sách phẳng (dùng cho dropdown). Mặc định trả dạng cây.
        if (req.query.flat) return res.json(all);

        const roots = all.filter(c => c.level === 1);
        const byParent = new Map();
        for (const c of all.filter(x => x.level === 2)) {
            if (!byParent.has(c.parentKey)) byParent.set(c.parentKey, []);
            byParent.get(c.parentKey).push(c);
        }
        res.json(roots.map(r => ({
            ...r,
            children: byParent.get(r.key) || [],
            // Danh mục cha không gắn sản phẩm trực tiếp -> đếm gộp từ các con
            productCount: (byParent.get(r.key) || []).reduce((s, c) => s + c.productCount, 0)
        })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/categories', async (req, res) => {
    try {
        const { key, name, description, imageUrl, sortOrder, parentKey, sellMode } = req.body;
        if (!key || !name) return res.status(400).json({ error: 'Thiếu mã hoặc tên danh mục' });

        // key đi vào customId của nút Discord (mc1_<key>) nên phải sạch và ngắn
        const cleanKey = String(key).trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (!cleanKey) return res.status(400).json({ error: 'Mã chỉ được dùng chữ thường, số và dấu _' });
        if (cleanKey.length > 32) return res.status(400).json({ error: 'Mã tối đa 32 ký tự' });

        if (await Category.findOne({ key: cleanKey })) {
            return res.status(409).json({ error: `Mã "${cleanKey}" đã tồn tại` });
        }

        // Chỉ cho 2 cấp: cha phải tồn tại và bản thân cha không được là danh mục con
        let parent = null;
        if (parentKey) {
            parent = await Category.findOne({ key: parentKey });
            if (!parent) return res.status(400).json({ error: `Không tìm thấy danh mục cha "${parentKey}"` });
            if (parent.parentKey) {
                return res.status(400).json({ error: 'Chỉ hỗ trợ 2 cấp - không thể tạo con của một danh mục con' });
            }
        }

        const cat = await Category.create({
            key: cleanKey, name, parentKey: parentKey || null,
            sellMode: sellMode === 'specific' ? 'specific' : 'quantity',
            description: description || '',
            imageUrl: imageUrl || '', sortOrder: Number(sortOrder) || 0
        });
        res.json({
            success: true,
            message: `Đã tạo danh mục ${parent ? `"${name}" trong "${parent.name}"` : `cấp 1 "${name}"`}`,
            data: cat
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/categories/:key', async (req, res) => {
    try {
        const key = req.params.key;
        const cat = await Category.findOne({ key });
        if (!cat) return res.status(404).json({ error: 'Không tìm thấy danh mục' });

        // CỐ Ý không xoá theo kiểu dây chuyền: xoá danh mục mà cuốn theo danh mục con,
        // sản phẩm và kho hàng là mất dữ liệu bán được. Bắt dọn trước.
        const childCount = await Category.countDocuments({ parentKey: key });
        if (childCount > 0) {
            return res.status(409).json({
                error: `Danh mục còn ${childCount} danh mục con. Hãy xoá các danh mục con trước, ` +
                       `hoặc tắt hiển thị thay vì xoá.`
            });
        }

        const n = await Product.countDocuments({ webCategory: key });
        if (n > 0) {
            return res.status(409).json({
                error: `Danh mục còn ${n} mặt hàng. Hãy chuyển hoặc xoá số mặt hàng đó trước, ` +
                       `hoặc tắt hiển thị danh mục thay vì xoá.`
            });
        }

        await Category.deleteOne({ key });
        res.json({ success: true, message: `Đã xoá danh mục "${cat.name}"` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/categories/:key', async (req, res) => {
    try {
        const { name, description, imageUrl, sortOrder, isActive, sellMode } = req.body;
        const update = {};
        if (name !== undefined) update.name = name;
        if (description !== undefined) update.description = description;
        if (imageUrl !== undefined) update.imageUrl = imageUrl;   // chỉ là link
        if (sortOrder !== undefined) update.sortOrder = Number(sortOrder);
        if (sellMode !== undefined) update.sellMode = sellMode === 'specific' ? 'specific' : 'quantity';
        if (isActive !== undefined) update.isActive = !!isActive;

        const cat = await Category.findOneAndUpdate(
            { key: req.params.key }, { $set: update }, { new: true }
        );
        if (!cat) return res.status(404).json({ error: 'Không tìm thấy danh mục' });

        // Đổi kiểu bán thì đồng bộ luôn type của mặt hàng trong danh mục. Không đồng bộ
        // thì danh mục bày kiểu này còn hàng lại giao kiểu kia - lỗi chỉ lộ ra lúc giao hàng.
        let synced = 0;
        if (update.sellMode) {
            const wantType = update.sellMode === 'specific' ? 'account' : 'code';
            const r = await Product.updateMany(
                { webCategory: cat.key, type: { $ne: wantType } },
                { $set: { type: wantType } }
            );
            synced = r.modifiedCount || 0;
        }

        res.json({
            success: true,
            message: 'Đã lưu danh mục' + (synced ? ` (đã đổi kiểu bán cho ${synced} mặt hàng bên trong)` : ''),
            data: cat
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Up 1 ảnh -> đẩy lên Discord -> lấy link -> gán vào danh mục
app.post('/api/categories/:key/image', upload.single('image'), async (req, res) => {
    const f = req.file;
    try {
        if (!f) return res.status(400).json({ error: 'Chưa chọn ảnh' });
        if (!process.env.DISCORD_WEBHOOK_URL) {
            return res.status(500).json({ error: 'Chưa cấu hình DISCORD_WEBHOOK_URL' });
        }

        const form = new FormData();
        form.append('file', fs.createReadStream(f.path), f.originalname);
        const r = await axios.post(process.env.DISCORD_WEBHOOK_URL + '?wait=true', form, {
            headers: form.getHeaders()
        });
        const url = r.data?.attachments?.[0]?.url;
        if (!url) throw new Error('Discord không trả về link ảnh');

        const cat = await Category.findOneAndUpdate(
            { key: req.params.key }, { $set: { imageUrl: url } }, { new: true }
        );
        if (!cat) return res.status(404).json({ error: 'Không tìm thấy danh mục' });

        res.json({ success: true, message: 'Đã cập nhật ảnh danh mục', imageUrl: url });
    } catch (e) {
        res.status(500).json({ error: e.message });
    } finally {
        if (f && fs.existsSync(f.path)) fs.unlinkSync(f.path);
    }
});

app.listen(port, () => {
    console.log(`✅ [Web Admin] Đã khởi chạy tại http://localhost:${port}`);
});

