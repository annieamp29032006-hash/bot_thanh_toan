require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const mongoose = require('mongoose');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// MongoDB Models
const Product = require('./src/models/Product');
const ProductStock = require('./src/models/ProductStock');
const Order = require('./src/models/Order');
const Category = require('./src/models/Category');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ dest: 'uploads/' });

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
        const products = await Product.find({ isActive: true });
        
        let data = {
            acc_pc: products.filter(p => p.webCategory === 'acc_pc').map(p => ({ id: p._id.toString(), name: p.name, type: p.type })),
            gcoin: products.filter(p => p.webCategory === 'gcoin').map(p => ({ id: p._id.toString(), name: p.name, type: p.type })),
            steam: products.filter(p => p.webCategory === 'steam').map(p => ({ id: p._id.toString(), name: p.name, type: p.type })),
            outfit: products.filter(p => p.webCategory === 'outfit').map(p => ({ id: p._id.toString(), name: p.name, type: p.type }))
        };
        
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/groups', async (req, res) => {
    try {
        const { category, name, type } = req.body;
        if (!name || !type) return res.status(400).json({ error: 'Thiếu thông tin' });
        
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
        const cats = await Category.find().sort({ sortOrder: 1 }).lean();
        const counts = await Product.aggregate([
            { $match: { isActive: true } },
            { $group: { _id: '$webCategory', n: { $sum: 1 } } }
        ]);
        const map = new Map(counts.map(c => [c._id, c.n]));
        res.json(cats.map(c => ({
            key: c.key, name: c.name, description: c.description || '',
            imageUrl: c.imageUrl || '', sortOrder: c.sortOrder, isActive: c.isActive,
            productCount: map.get(c.key) || 0
        })));
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/categories/:key', async (req, res) => {
    try {
        const { name, description, imageUrl, sortOrder, isActive } = req.body;
        const update = {};
        if (name !== undefined) update.name = name;
        if (description !== undefined) update.description = description;
        if (imageUrl !== undefined) update.imageUrl = imageUrl;   // chỉ là link
        if (sortOrder !== undefined) update.sortOrder = Number(sortOrder);
        if (isActive !== undefined) update.isActive = !!isActive;

        const cat = await Category.findOneAndUpdate(
            { key: req.params.key }, { $set: update }, { new: true }
        );
        if (!cat) return res.status(404).json({ error: 'Không tìm thấy danh mục' });
        res.json({ success: true, message: 'Đã lưu danh mục', data: cat });
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

