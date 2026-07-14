/**
 * dev.js - Các lệnh hỗ trợ Test/Dev (Tạo dữ liệu ảo, Fake thanh toán)
 */
const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const productService = require('../services/productService');
const stockService = require('../services/stockService');
const paymentService = require('../services/paymentService');
const Payment = require('../models/Payment');

const command = new SlashCommandBuilder()
    .setName('dev')
    .setDescription('Công cụ Test dành cho Admin')
    .addSubcommand(sub => sub
        .setName('seed')
        .setDescription('Tự động tạo các sản phẩm ảo (Code, VIP, Acc) kèm kho hàng để test')
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);

async function execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ═══════════════════════════════════════
    // /dev seed - TẠO SẢN PHẨM ẢO
    // ═══════════════════════════════════════
    if (sub === 'seed') {
        await interaction.deferReply({ ephemeral: true });

        try {
            // Lấy ID các kênh nếu có
            const channels = interaction.guild.channels.cache;
            const getId = (name) => {
                const c = channels.find(ch => ch.name.includes(name));
                return c ? c.id : '';
            };

            // Hàm tạo mảng data mẫu
            const makeAccs = (prefix) => Array.from({length: 200}, (_, i) => ({ content: `${prefix}_${i+1}`, password: 'pass' }));
            const makeCodes = (prefix) => Array.from({length: 200}, (_, i) => ({ content: `${prefix}-${i+1}-XYZ` }));

            // 1. Acc Vé Chợ Đen
            const accChoDen = await productService.create({
                name: 'Acc Vé Chợ Đen', type: 'account', price: 200000,
                description: 'Tài khoản có sẵn vé chợ đen giá trị cao', imageUrl: 'https://i.imgur.com/9Q2vY83.png',
                displayChannelId: getId('acc-ve-cho-den')
            });
            await stockService.bulkImport(accChoDen._id, makeAccs('acc_choden'));

            // 2. Acc Bán
            const accBan = await productService.create({
                name: 'Acc Bán Thường', type: 'account', price: 50000,
                description: 'Tài khoản cấp 30', imageUrl: 'https://i.imgur.com/9Q2vY83.png',
                displayChannelId: getId('acc-ban')
            });
            await stockService.bulkImport(accBan._id, makeAccs('acc_thuong'));

            // 3. Code Gcoin
            const codeGcoin = await productService.create({
                name: 'Code 1000 Gcoin', type: 'code', price: 100000,
                description: 'Nạp ngay 1000 Gcoin vào tài khoản', imageUrl: 'https://i.imgur.com/8Q9Q2vY.png',
                displayChannelId: getId('code-gcoin')
            });
            await stockService.bulkImport(codeGcoin._id, makeCodes('GCOIN-1000'));

            // 4. Code Steam
            const codeSteam = await productService.create({
                name: 'Code Steam Wallet 5$', type: 'code', price: 125000,
                description: 'Nạp 5$ vào Steam Wallet', imageUrl: 'https://i.imgur.com/8Q9Q2vY.png',
                displayChannelId: getId('code-steam')
            });
            await stockService.bulkImport(codeSteam._id, makeCodes('STEAM-5USD'));

            // 5. Code Trang Phục
            const codeTrangPhuc = await productService.create({
                name: 'Code Skin Hiếm', type: 'code', price: 300000,
                description: 'Trang phục siêu cấp vũ trụ', imageUrl: 'https://i.imgur.com/8Q9Q2vY.png',
                displayChannelId: getId('code-trang-phuc')
            });
            await stockService.bulkImport(codeTrangPhuc._id, makeCodes('SKIN-RARE'));

            // 6. Code Random
            const codeRandom = await productService.create({
                name: 'Code Random Trúng Thưởng', type: 'code', price: 15000,
                description: 'Cơ hội trúng siêu hũ', imageUrl: 'https://i.imgur.com/8Q9Q2vY.png',
                displayChannelId: getId('code-random')
            });
            await stockService.bulkImport(codeRandom._id, makeCodes('RND-LUCKY'));

            // 7. Gói VIP
            const vipCode = await productService.create({
                name: 'Code VIP Hàng Tháng', type: 'vip', price: 500000,
                description: 'Kích hoạt VIP đặc quyền 30 ngày', imageUrl: 'https://i.imgur.com/3YQ2vY8.png',
                displayChannelId: getId('vip-code')
            });

            return interaction.editReply(
                `✅ **Đã tạo thành công 7 sản phẩm ảo cho 7 gian hàng!**\n\n` +
                `1. ${accChoDen.name}\n2. ${accBan.name}\n3. ${codeGcoin.name}\n4. ${codeSteam.name}\n5. ${codeTrangPhuc.name}\n6. ${codeRandom.name}\n7. ${vipCode.name}\n\n` +
                `👉 Hãy dùng lệnh \`/shop post_all\` để đăng chúng ra kênh bán hàng và bấm nút MUA HÀNG để test!`
            );
        } catch (err) {
            return interaction.editReply(`❌ Lỗi tạo dữ liệu: ${err.message}`);
        }
    }

}

module.exports = { command, execute };
