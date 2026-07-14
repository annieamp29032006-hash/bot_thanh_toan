/**
 * shop.js - Lệnh /shop (đăng embed sản phẩm lên kênh)
 */
const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const productService = require('../services/productService');
const stockService = require('../services/stockService');
const embeds = require('../utils/embedBuilder');
const Product = require('../models/Product');
const ShopMenu = require('../models/ShopMenu');
const imageUploader = require('../utils/imageUploader');
const { ChannelType } = require('discord.js');

const command = new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Đăng sản phẩm lên kênh hiện tại (Chỉ Admin)')
    .addSubcommand(sub => sub
        .setName('post')
        .setDescription('Đăng 1 sản phẩm cụ thể')
        .addStringOption(opt => opt.setName('id').setDescription('ID sản phẩm').setRequired(true))
    )
    .addSubcommand(sub => sub
        .setName('post_all')
        .setDescription('Đăng tất cả sản phẩm theo loại')
        .addStringOption(opt => opt
            .setName('type')
            .setDescription('Loại sản phẩm')
            .setRequired(true)
            .addChoices(
                { name: '📦 Code Thường', value: 'code' },
                { name: '⭐ Code VIP', value: 'vip' },
                { name: '🎮 Account', value: 'account' }
            )
        )
    )
    .addSubcommand(sub => sub
        .setName('refresh')
        .setDescription('Cập nhật tồn kho trên embed đã đăng')
        .addStringOption(opt => opt.setName('id').setDescription('ID sản phẩm (bỏ trống = tất cả)').setRequired(false))
    )
    .addSubcommand(sub => sub
        .setName('sell_account')
        .setDescription('Đăng bán 1 tài khoản (1-step)')
        .addStringOption(opt => opt.setName('title').setDescription('Tiêu đề bài đăng (VD: Acc Liên Quân VIP)').setRequired(true))
        .addIntegerOption(opt => opt.setName('price').setDescription('Giá bán (VNĐ)').setRequired(true))
        .addStringOption(opt => opt.setName('username').setDescription('Tên đăng nhập').setRequired(true))
        .addStringOption(opt => opt.setName('password').setDescription('Mật khẩu').setRequired(true))
        .addChannelOption(opt => opt.setName('channel').setDescription('Kênh sẽ đăng lên').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addAttachmentOption(opt => opt.setName('image').setDescription('Ảnh minh họa (tùy chọn)').setRequired(false))
        .addStringOption(opt => opt.setName('description').setDescription('Mô tả thêm (tùy chọn)').setRequired(false))
    )
    .addSubcommand(sub => sub
        .setName('create_menu')
        .setDescription('Gộp nhiều sản phẩm thành 1 bài đăng Menu (Dropdown)')
        .addStringOption(opt => opt.setName('title').setDescription('Tiêu đề Menu').setRequired(true))
        .addStringOption(opt => opt.setName('ids').setDescription('Các Mã/ID sản phẩm, cách nhau bằng phẩy (VD: GC100, GC500)').setRequired(true))
        .addChannelOption(opt => opt.setName('channel').setDescription('Kênh đăng lên').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption(opt => opt.setName('description').setDescription('Mô tả thêm (tùy chọn)').setRequired(false))
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);

async function execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ═══════════════════════════════════════
    // /shop post <id>
    // ═══════════════════════════════════════
    if (sub === 'post') {
        await interaction.deferReply({ ephemeral: true });
        const id = interaction.options.getString('id');
        const data = await productService.getWithStock(id);
        if (!data) return interaction.editReply('❌ Không tìm thấy sản phẩm.');

        const embed = embeds.productEmbed(data, data.stockCount);
        const row = embeds.buyButton(data._id);

        const msg = await interaction.channel.send({ embeds: [embed], components: [row] });

        // Lưu channelId + messageId để cập nhật sau
        await productService.update(id, {
            channelId: interaction.channel.id,
            messageId: msg.id
        });

        return interaction.editReply(`✅ Đã đăng sản phẩm **${data.name}** lên kênh.`);
    }

    // ═══════════════════════════════════════
    // /shop post_all <type>
    // ═══════════════════════════════════════
    if (sub === 'post_all') {
        await interaction.deferReply({ ephemeral: true });
        const type = interaction.options.getString('type');
        const products = await productService.getAllWithStock({ type });

        if (products.length === 0) {
            return interaction.editReply(`📦 Không có sản phẩm loại **${type}** nào.`);
        }

        if (type === 'account') {
            // Đăng từng Acc rời rạc (Để hiện ảnh)
            let count = 0;
            for (const p of products) {
                const embed = embeds.productEmbed(p, p.stockCount);
                const row = embeds.buyButton(p._id);

                let targetChannel = interaction.channel;
                if (p.displayChannelId) {
                    const fetchedChannel = interaction.client.channels.cache.get(p.displayChannelId);
                    if (fetchedChannel) targetChannel = fetchedChannel;
                }

                const msg = await targetChannel.send({ embeds: [embed], components: [row] });

                await productService.update(p._id, {
                    channelId: targetChannel.id,
                    messageId: msg.id
                });
                count++;
            }
            return interaction.editReply(`✅ Đã đăng **${count}** tài khoản ra kênh bán hàng!`);
        } else {
            // Đăng dạng Menu gộp (Cho Code và VIP)
            const titleMap = {
                code: '🛒 CỬA HÀNG CODE & KEY',
                vip: '⭐ CỬA HÀNG GÓI VIP'
            };
            const title = titleMap[type] || '🛒 CỬA HÀNG SẢN PHẨM';
            const description = `Vui lòng chọn mặt hàng bạn muốn mua từ Menu bên dưới.\n*(Mỗi mặt hàng đều có giá tiền và tồn kho hiển thị rõ ràng)*`;

            try {
                const stockMap = {};
                for (const p of products) {
                    stockMap[p._id.toString()] = p.stockCount;
                }

                const menu = new ShopMenu({
                    title,
                    description,
                    productIds: products.map(p => p._id),
                    channelId: interaction.channel.id
                });

                const embed = embeds.shopMenuEmbed(title, description);
                const row = embeds.shopMenuSelect(products, stockMap);

                const msg = await interaction.channel.send({ embeds: [embed], components: [row] });

                menu.messageId = msg.id;
                await menu.save();

                return interaction.editReply(`✅ Đã gộp toàn bộ **${products.length}** sản phẩm loại **${type}** thành 1 Menu Sổ Xuống và đăng lên kênh này!`);
            } catch (err) {
                console.error('Lỗi post_all menu:', err);
                return interaction.editReply(`❌ Có lỗi khi tạo Menu gộp: ${err.message}`);
            }
        }
    }

    // ═══════════════════════════════════════
    // /shop refresh
    // ═══════════════════════════════════════
    if (sub === 'refresh') {
        await interaction.deferReply({ ephemeral: true });
        const id = interaction.options.getString('id');

        let updated = 0;

        // 1. Refresh Products bình thường
        let products;
        if (id) {
            const p = await productService.getWithStock(id);
            products = p ? [p] : [];
        } else {
            products = await productService.getAllWithStock();
        }

        for (const p of products) {
            if (!p.channelId || !p.messageId) continue;
            try {
                const channel = interaction.client.channels.cache.get(p.channelId);
                if (!channel) continue;
                const msg = await channel.messages.fetch(p.messageId).catch(() => null);
                if (!msg) continue;

                const embed = embeds.productEmbed(p, p.stockCount);
                const row = embeds.buyButton(p._id);
                await msg.edit({ embeds: [embed], components: [row] });
                updated++;
            } catch (err) {
                console.error(`Lỗi refresh embed ${p._id}:`, err.message);
            }
        }

        // 2. Refresh Shop Menus
        const menus = await ShopMenu.find({}).populate('productIds');
        for (const m of menus) {
            if (!m.channelId || !m.messageId) continue;
            try {
                const channel = interaction.client.channels.cache.get(m.channelId);
                if (!channel) continue;
                const msg = await channel.messages.fetch(m.messageId).catch(() => null);
                if (!msg) continue;

                // Tính toán stock cho từng sản phẩm trong menu
                const stockMap = {};
                for (const p of m.productIds) {
                    stockMap[p._id.toString()] = await stockService.countAvailable(p._id);
                }

                const embed = embeds.shopMenuEmbed(m.title, m.description);
                const row = embeds.shopMenuSelect(m.productIds, stockMap);
                await msg.edit({ embeds: [embed], components: [row] });
                updated++;
            } catch (err) {
                console.error(`Lỗi refresh menu ${m._id}:`, err.message);
            }
        }

        return interaction.editReply(`✅ Đã cập nhật **${updated}** bài đăng (bao gồm Menu).`);
    }

    // ═══════════════════════════════════════
    // /shop sell_account
    // ═══════════════════════════════════════
    if (sub === 'sell_account') {
        await interaction.deferReply({ ephemeral: true });

        const title = interaction.options.getString('title');
        const price = interaction.options.getInteger('price');
        const username = interaction.options.getString('username');
        const password = interaction.options.getString('password');
        const targetChannel = interaction.options.getChannel('channel');
        const attachment = interaction.options.getAttachment('image');
        const description = interaction.options.getString('description') || '';

        try {
            let imageUrl = '';
            if (attachment) {
                imageUrl = await imageUploader.upload(interaction.client, attachment.url);
            }

            // 1. Tạo Product
            const product = await productService.create({
                name: title,
                type: 'account',
                price,
                description,
                imageUrl,
                displayChannelId: targetChannel.id
            });

            // 2. Tạo Stock (1 chiếc)
            await stockService.addOne(product._id, username, password, imageUrl);

            // 3. Đăng lên kênh
            const embed = embeds.productEmbed(product, 1);
            const row = embeds.buyButton(product._id);

            const msg = await targetChannel.send({ embeds: [embed], components: [row] });

            // 4. Cập nhật messageId
            await productService.update(product._id, {
                channelId: targetChannel.id,
                messageId: msg.id
            });

            return interaction.editReply(`✅ Đã tự động đăng bán **${title}** lên kênh <#${targetChannel.id}>!\n*(Bài đăng sẽ tự động biến mất khi có người mua thành công)*`);
        } catch (err) {
            console.error('Lỗi sell_account:', err);
            return interaction.editReply(`❌ Có lỗi xảy ra: ${err.message}`);
        }
    }

    // ═══════════════════════════════════════
    // /shop create_menu
    // ═══════════════════════════════════════
    if (sub === 'create_menu') {
        await interaction.deferReply({ ephemeral: true });

        const title = interaction.options.getString('title');
        const idsStr = interaction.options.getString('ids');
        const targetChannel = interaction.options.getChannel('channel');
        const description = interaction.options.getString('description') || '';

        const idsOrCodes = idsStr.split(',').map(id => id.trim()).filter(id => id.length > 0);
        
        if (idsOrCodes.length === 0) {
            return interaction.editReply('❌ Danh sách không hợp lệ. Vui lòng nhập các Mã Sản Phẩm cách nhau bằng dấu phẩy.');
        }

        try {
            // Tìm theo ID 24 ký tự HOẶC tìm theo Mã (Code)
            const validMongoIds = idsOrCodes.filter(id => id.length === 24);
            const products = await Product.find({
                $or: [
                    { _id: { $in: validMongoIds } },
                    { code: { $in: idsOrCodes } }
                ]
            });

            if (products.length === 0) {
                return interaction.editReply('❌ Không tìm thấy sản phẩm nào khớp với các Mã/ID trên.');
            }

            const stockMap = {};
            for (const p of products) {
                stockMap[p._id.toString()] = await stockService.countAvailable(p._id);
            }

            const menu = new ShopMenu({
                title,
                description,
                productIds: products.map(p => p._id),
                channelId: targetChannel.id
            });

            const embed = embeds.shopMenuEmbed(title, description);
            const row = embeds.shopMenuSelect(products, stockMap);

            const msg = await targetChannel.send({ embeds: [embed], components: [row] });

            menu.messageId = msg.id;
            await menu.save();

            return interaction.editReply(`✅ Đã tạo Menu Gộp **${title}** với ${products.length} mặt hàng thành công lên kênh <#${targetChannel.id}>!`);
        } catch (err) {
            console.error('Lỗi create_menu:', err);
            return interaction.editReply(`❌ Lỗi: ${err.message}`);
        }
    }
}

module.exports = { command, execute };
