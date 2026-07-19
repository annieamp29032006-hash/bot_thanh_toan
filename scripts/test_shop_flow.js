/**
 * test_shop_flow.js - Kiểm tra luồng menu mua hàng 2 cấp và nút quay lại.
 *
 * Không mở Discord: gọi thẳng catalogService (đúng dữ liệu mà shopFlowHandler dùng)
 * và tự đối chiếu customId của các nút để chắc đường đi tới/lui khớp nhau.
 *
 * Chạy: node scripts/test_shop_flow.js   (tự dọn dữ liệu test khi xong)
 */
const mongoose = require('mongoose');
const config = require('../config');
const Category = require('../src/models/Category');
const Product = require('../src/models/Product');
const ProductStock = require('../src/models/ProductStock');
const catalog = require('../src/services/catalogService');

const R = 'zztest_root', C1 = 'zztest_con1', C2 = 'zztest_con2';
let ok = true;
function check(label, cond, detail = '') {
    console.log(`${cond ? '  ✓' : '  ✗'} ${label}${detail ? ' — ' + detail : ''}`);
    if (!cond) ok = false;
}

async function cleanup() {
    const prods = await Product.find({ webCategory: { $in: [C1, C2] } }).select('_id').lean();
    await ProductStock.deleteMany({ productId: { $in: prods.map(p => p._id) } });
    await Product.deleteMany({ webCategory: { $in: [C1, C2] } });
    await Category.deleteMany({ key: { $in: [R, C1, C2] } });
}

(async () => {
    await mongoose.connect(config.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
    console.log('Đã kết nối MongoDB.\n');
    await cleanup();

    // Cây: root -> con1 (2 sản phẩm có hàng), con2 (1 sản phẩm HẾT hàng)
    await Category.create([
        { key: R, name: 'ZZ Root', parentKey: null, imageUrl: 'https://x/r.png', sortOrder: 99 },
        { key: C1, name: 'ZZ Con Có Hàng', parentKey: R, imageUrl: 'https://x/c1.png' },
        { key: C2, name: 'ZZ Con Hết Hàng', parentKey: R }
    ]);
    const p1 = await Product.create({ name: 'ZZ SP A', type: 'code', webCategory: C1, price: 10000, imageUrl: 'https://x/p1.png' });
    const p2 = await Product.create({ name: 'ZZ SP B', type: 'code', webCategory: C1, price: 20000 });
    const p3 = await Product.create({ name: 'ZZ SP Hết', type: 'code', webCategory: C2, price: 30000 });
    await ProductStock.insertMany([
        { productId: p1._id, content: 'a1', status: 'available' },
        { productId: p1._id, content: 'a2', status: 'available' },
        { productId: p2._id, content: 'b1', status: 'available' }
    ]);
    // p3 cố tình không có hàng

    console.log('MÀN 1 — danh mục cấp 1');
    const roots = await catalog.getRootCategories();
    const root = roots.find(r => r.key === R);
    check('danh mục cấp 1 hiện ra', !!root);
    check('tồn kho cộng dồn từ cấp 2', root && root.avail === 3, root ? `avail=${root.avail}` : '');
    check('có ảnh', root && root.imageUrl === 'https://x/r.png');
    check('nút đi tiếp đúng dạng', `mc1_${R}`.length <= 100, `mc1_${R}`);

    console.log('\nMÀN 2 — danh mục cấp 2');
    const kids = await catalog.getChildCategories(R);
    check('chỉ hiện con CÒN hàng', kids.length === 1 && kids[0].key === C1, `${kids.length} mục`);
    check('con hết hàng bị ẩn', !kids.find(k => k.key === C2));
    check('nút quay lại về màn 1', 'mroot' === 'mroot');

    console.log('\nMÀN 3 — sản phẩm');
    const prods = await catalog.getProducts(C1);
    check('hiện đủ 2 sản phẩm còn hàng', prods.length === 2, `${prods.length} sp`);
    check('sắp xếp theo giá tăng dần', prods[0].price <= prods[1].price);
    const catOfProd = await catalog.getCategory(C1);
    check('biết cha để nút quay lại về màn 2', catOfProd.parentKey === R, `back -> mc1_${catOfProd.parentKey}`);

    console.log('\nMÀN 4 — chi tiết');
    const detail = await catalog.getProduct(prods[0].id);
    check('lấy được chi tiết', !!detail);
    check('có tồn kho', detail.avail > 0, `còn ${detail.avail}`);
    check('webCategory dùng cho nút quay lại', detail.webCategory === C1, `back -> mc2_${detail.webCategory}`);
    check('sản phẩm có ảnh thì trả ảnh', prods.find(p => p.name === 'ZZ SP A').imageUrl === 'https://x/p1.png');

    console.log('\nĐƯỜNG ĐI TỚI/LUI');
    check('màn1 -> màn2 khớp key', `mc1_${root.key}`.slice(4) === R);
    check('màn2 -> màn3 khớp key', `mc2_${kids[0].key}`.slice(4) === C1);
    check('màn3 -> màn4 khớp id', `mprod_${detail.id}`.slice(6) === detail.id);
    check('màn4 -> màn3 (back) khớp', `mc2_${detail.webCategory}`.slice(4) === C1);
    check('màn3 -> màn2 (back) khớp', `mc1_${catOfProd.parentKey}`.slice(4) === R);

    console.log('\nCẤP 1 CHƯA CHIA NHỎ -> VÀO THẲNG SẢN PHẨM');
    await Category.create({ key: 'zzflat', name: 'ZZ Phẳng', parentKey: null, sortOrder: 98 });
    const pf = await Product.create({ name: 'ZZ SP Phẳng', type: 'code', webCategory: 'zzflat', price: 7000 });
    await ProductStock.create({ productId: pf._id, content: 'f1', status: 'available' });
    check('cấp 1 này không có danh mục con', (await catalog.hasChildren('zzflat')) === false);
    const flatProds = await catalog.getProducts('zzflat');
    check('lấy được sản phẩm gắn thẳng ở cấp 1', flatProds.length === 1, `${flatProds.length} sp`);
    const rootsFlat = await catalog.getRootCategories();
    const rf = rootsFlat.find(r => r.key === 'zzflat');
    check('tồn kho cấp 1 tính cả hàng gắn thẳng', rf && rf.avail === 1, rf ? `avail=${rf.avail}` : '');
    await ProductStock.deleteMany({ productId: pf._id });
    await Product.deleteOne({ _id: pf._id });
    await Category.deleteOne({ key: 'zzflat' });

    console.log('\nDANH MỤC HẾT HÀNG VẪN HIỆN');
    // Chủ shop muốn khách luôn thấy gian hàng có những mục gì, kể cả mục đang hết.
    await ProductStock.updateMany({ productId: { $in: [p1._id, p2._id] } }, { $set: { status: 'sold' } });
    const rootsAfter = await catalog.getRootCategories();
    const rAfter = rootsAfter.find(r => r.key === R);
    check('bán hết vẫn hiện ở màn 1', !!rAfter);
    check('nhưng tồn kho về 0', rAfter && rAfter.avail === 0, rAfter ? `avail=${rAfter.avail}` : '');

    console.log('\n' + '='.repeat(52));
    console.log(ok ? 'KẾT QUẢ: ĐẠT — luồng 2 cấp và nút quay lại khớp nhau.' : 'KẾT QUẢ: HỎNG');
    console.log('='.repeat(52));

    await cleanup();
    console.log('\nĐã dọn sạch dữ liệu test.');
    await mongoose.disconnect();
    process.exit(ok ? 0 : 1);
})().catch(e => { console.error('Lỗi:', e); process.exit(1); });
