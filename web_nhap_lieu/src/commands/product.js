/**
 * product.js - Lệnh /product add|edit|delete|import|stock
 */
const { SlashCommandBuilder, PermissionsBitField, AttachmentBuilder, ChannelType } = require('discord.js');
const productService = require('../services/productService');
const stockService = require('../services/stockService');
const imageUploader = require('../utils/imageUploader');
const embeds = require('../utils/embedBuilder');
const fileParser = require('../utils/fileParser');
const { Readable } = require('stream');
const https = require('https');
const http = require('http');

const command = new SlashCommandBuilder()
    .setName('product')
    .setDescription('Quản lý sản phẩm (Chỉ Admin)')
    .addSubcommand(sub => sub
        .setName('add')
        .setDescription('Thêm sản phẩm mới')
        .addStringOption(opt => opt.setName('name').setDescription('Tên sản phẩm').setRequired(true))
        .addStringOption(opt => opt
            .setName('type')
            .setDescription('Loại sản phẩm')
            .setRequired(true)
            .addChoices(
                { name: 'Code (Key)', value: 'code' },
                { name: 'VIP (Bảo hành dài)', value: 'vip' },
                { name: 'Tài khoản (Acc)', value: 'account' }
            )
        )
        .addIntegerOption(opt => opt.setName('price').setDescription('Giá (VNĐ)').setRequired(true))
        .addStringOption(opt => opt.setName('code').setDescription('Mã sản phẩm ngắn gọn (VD: VALO-01) để nạp auto').setRequired(false))
        .addStringOption(opt => opt.setName('description').setDescription('Mô tả ngắn gọn').setRequired(false))
        .addAttachmentOption(opt => opt.setName('image').setDescription('Ảnh sản phẩm').setRequired(false))
        .addChannelOption(opt => opt.setName('channel').setDescription('Kênh hiển thị sản phẩm này (tùy chọn)').addChannelTypes(ChannelType.GuildText).setRequired(false))
    )
    .addSubcommand(sub => sub
        .setName('edit')
        .setDescription('Sửa sản phẩm')
        .addStringOption(opt => opt.setName('id').setDescription('ID sản phẩm (MongoDB ObjectId)').setRequired(true))
        .addStringOption(opt => opt.setName('name').setDescription('Tên mới').setRequired(false))
        .addStringOption(opt => opt.setName('code').setDescription('Mã sản phẩm mới (SKU)').setRequired(false))
        .addIntegerOption(opt => opt.setName('price').setDescription('Giá mới').setRequired(false))
        .addStringOption(opt => opt.setName('description').setDescription('Mô tả mới').setRequired(false))
        .addAttachmentOption(opt => opt.setName('image').setDescription('Ảnh mới').setRequired(false))
        .addChannelOption(opt => opt.setName('channel').setDescription('Kênh hiển thị mới').addChannelTypes(ChannelType.GuildText).setRequired(false))
    )
    .addSubcommand(sub => sub
        .setName('delete')
        .setDescription('Xóa sản phẩm')
        .addStringOption(opt => opt.setName('id').setDescription('ID sản phẩm').setRequired(true))
    )
    .addSubcommand(sub => sub
        .setName('import')
        .setDescription('Import code/account từ file CSV')
        .addStringOption(opt => opt.setName('id').setDescription('ID hoặc Mã sản phẩm để import vào').setRequired(true))
        .addAttachmentOption(opt => opt.setName('csv').setDescription('File CSV (code hoặc username,password,imageUrl)').setRequired(true))
    )
    .addSubcommand(sub => sub
        .setName('stock')
        .setDescription('Xem tồn kho sản phẩm')
        .addStringOption(opt => opt.setName('id').setDescription('ID sản phẩm').setRequired(true))
    )
    .addSubcommand(sub => sub
        .setName('list')
        .setDescription('Liệt kê tất cả sản phẩm')
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);

async function execute(interaction) {
    const sub = interaction.options.getSubcommand();

    // ═══════════════════════════════════════
    // /product add
    // ═══════════════════════════════════════
    if (sub === 'add') {
        await interaction.deferReply({ ephemeral: true });

        const name = interaction.options.getString('name');
        const code = interaction.options.getString('code');
        const type = interaction.options.getString('type');
        const price = interaction.options.getInteger('price');
        const description = interaction.options.getString('description') || '';
        const attachment = interaction.options.getAttachment('image');
        const channel = interaction.options.getChannel('channel');

        let imageUrl = '';
        if (attachment) {
            imageUrl = await imageUploader.upload(interaction.client, attachment.url);
        }

        try {
            const data = { 
                name, type, price, description, imageUrl, 
                displayChannelId: channel ? channel.id : '' 
            };
            if (code) data.code = code;

            const product = await productService.create(data);
            return interaction.editReply(
                `✅ Đã tạo sản phẩm:\n` +
                `**${product.name}** (${product.type}) - ${product.price.toLocaleString()} VNĐ\n` +
                (product.code ? `Mã SP (SKU): \`${product.code}\`\n` : '') +
                `Kênh hiển thị: ${channel ? `<#${channel.id}>` : 'Chưa set'}\n` +
                `ID: \`${product._id}\``
            );
        } catch (err) {
            if (err.code === 11000) return interaction.editReply(`❌ Lỗi: Mã sản phẩm \`${code}\` đã tồn tại! Vui lòng chọn mã khác.`);
            return interaction.editReply(`❌ Lỗi tạo sản phẩm: ${err.message}`);
        }
    }

    // ═══════════════════════════════════════
    // /product edit
    // ═══════════════════════════════════════
    if (sub === 'edit') {
        await interaction.deferReply({ ephemeral: true });
        const id = interaction.options.getString('id');
        const updates = {};

        const name = interaction.options.getString('name');
        const code = interaction.options.getString('code');
        const price = interaction.options.getInteger('price');
        const description = interaction.options.getString('description');
        const attachment = interaction.options.getAttachment('image');
        const channel = interaction.options.getChannel('channel');

        if (name) updates.name = name;
        if (code) updates.code = code;
        if (price) updates.price = price;
        if (description) updates.description = description;
        if (attachment) updates.imageUrl = await imageUploader.upload(interaction.client, attachment.url);
        if (channel) updates.displayChannelId = channel.id;

        if (Object.keys(updates).length === 0) {
            return interaction.editReply('⚠️ Bạn chưa nhập gì để sửa.');
        }

        try {
            const product = await productService.update(id, updates);
            return interaction.editReply(`✅ Đã cập nhật sản phẩm **${product.name}**.`);
        } catch (err) {
            if (err.code === 11000) return interaction.editReply(`❌ Lỗi: Mã sản phẩm \`${code}\` đã tồn tại ở mặt hàng khác!`);
            return interaction.editReply(`❌ ${err.message}`);
        }
    }

    // ═══════════════════════════════════════
    // /product delete
    // ═══════════════════════════════════════
    if (sub === 'delete') {
        await interaction.deferReply({ ephemeral: true });
        const id = interaction.options.getString('id');
        try {
            const product = await productService.remove(id);
            return interaction.editReply(`✅ Đã xóa sản phẩm **${product.name}** và toàn bộ kho.`);
        } catch (err) {
            return interaction.editReply(`❌ ${err.message}`);
        }
    }

    // ═══════════════════════════════════════
    // /product import (CSV)
    // ═══════════════════════════════════════
    if (sub === 'import') {
        await interaction.deferReply({ ephemeral: true });
        const idOrCode = interaction.options.getString('id');
        const csvFile = interaction.options.getAttachment('csv');

        const product = await productService.findByIdOrCode(idOrCode);
        if (!product) return interaction.editReply('❌ Không tìm thấy sản phẩm với ID hoặc Mã này.');

        try {
            // Tải file CSV
            const csvData = await fetchFile(csvFile.url);
            const items = await fileParser.parseCSV(csvData);

            if (items.length === 0) {
                return interaction.editReply('❌ File CSV trống hoặc không hợp lệ.');
            }

            const result = await stockService.bulkImport(product._id, items);
            return interaction.editReply(`✅ Đã import **${result.length}** items vào kho **${product.name}**.`);
        } catch (err) {
            return interaction.editReply(`❌ Lỗi import: ${err.message}`);
        }
    }

    // ═══════════════════════════════════════
    // /product stock
    // ═══════════════════════════════════════
    if (sub === 'stock') {
        await interaction.deferReply({ ephemeral: true });
        const id = interaction.options.getString('id');
        const product = await productService.getById(id);
        if (!product) return interaction.editReply('❌ Không tìm thấy sản phẩm.');

        const available = await stockService.countAvailable(id);
        const sold = await require('../models/ProductStock').countDocuments({ productId: id, status: 'sold' });

        return interaction.editReply(
            `📦 **Tồn kho: ${product.name}**\n` +
            `✅ Còn hàng: \`${available}\`\n` +
            `🔴 Đã bán: \`${sold}\`\n` +
            `📊 Tổng: \`${available + sold}\``
        );
    }

    // ═══════════════════════════════════════
    // /product list
    // ═══════════════════════════════════════
    if (sub === 'list') {
        await interaction.deferReply({ ephemeral: true });
        const products = await productService.getAllWithStock();

        if (products.length === 0) {
            return interaction.editReply('📦 Chưa có sản phẩm nào.');
        }

        const typeEmoji = { code: '📦', vip: '⭐', account: '🎮' };
        const lines = products.map(p =>
            `${typeEmoji[p.type] || '📋'} **${p.name}** - ${p.price.toLocaleString()} VNĐ (Kho: ${p.stockCount})\n` +
            `└ ID: \`${p._id}\` | Mã: \`${p.code || 'Chưa set'}\``
        );

        return interaction.editReply(`**📋 Danh sách sản phẩm:**\n${lines.join('\n\n')}`);
    }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function fetchFile(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
            res.on('error', reject);
        }).on('error', reject);
    });
}

module.exports = { command, execute };
