/**
 * account.js - Lệnh /account add|import|stock
 */
const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const productService = require('../services/productService');
const stockService = require('../services/stockService');
const imageUploader = require('../utils/imageUploader');
const https = require('https');
const http = require('http');
const csv = require('csv-parser');
const { Readable } = require('stream');

const command = new SlashCommandBuilder()
    .setName('account')
    .setDescription('Quản lý kho account (Chỉ Admin)')
    .addSubcommand(sub => sub
        .setName('add')
        .setDescription('Thêm 1 account vào kho')
        .addStringOption(opt => opt.setName('product_id').setDescription('ID sản phẩm account').setRequired(true))
        .addStringOption(opt => opt.setName('username').setDescription('Tên đăng nhập').setRequired(true))
        .addStringOption(opt => opt.setName('password').setDescription('Mật khẩu').setRequired(true))
        .addAttachmentOption(opt => opt.setName('image').setDescription('Ảnh account (nếu có)').setRequired(false))
    )
    .addSubcommand(sub => sub
        .setName('import')
        .setDescription('Import account từ CSV')
        .addStringOption(opt => opt.setName('product_id').setDescription('ID sản phẩm account').setRequired(true))
        .addAttachmentOption(opt => opt.setName('csv').setDescription('File CSV (username,password,imageUrl)').setRequired(true))
    )
    .addSubcommand(sub => sub
        .setName('stock')
        .setDescription('Xem tồn kho account')
        .addStringOption(opt => opt.setName('product_id').setDescription('ID sản phẩm').setRequired(true))
    )
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator);

async function execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
        await interaction.deferReply({ ephemeral: true });
        const productId = interaction.options.getString('product_id');
        const username = interaction.options.getString('username');
        const password = interaction.options.getString('password');
        const attachment = interaction.options.getAttachment('image');

        const product = await productService.getById(productId);
        if (!product) return interaction.editReply('❌ Không tìm thấy sản phẩm.');
        if (product.type !== 'account') return interaction.editReply('❌ Sản phẩm này không phải loại Account.');

        let imageUrl = '';
        if (attachment) {
            imageUrl = await imageUploader.upload(interaction.client, attachment.url);
        }

        await stockService.addOne(productId, username, password, imageUrl);
        const count = await stockService.countAvailable(productId);
        return interaction.editReply(`✅ Đã thêm account \`${username}\` vào kho **${product.name}**. Tồn kho: ${count}`);
    }

    if (sub === 'import') {
        await interaction.deferReply({ ephemeral: true });
        const productId = interaction.options.getString('product_id');
        const csvFile = interaction.options.getAttachment('csv');

        const product = await productService.getById(productId);
        if (!product) return interaction.editReply('❌ Không tìm thấy sản phẩm.');
        if (product.type !== 'account') return interaction.editReply('❌ Sản phẩm này không phải loại Account.');

        try {
            const csvData = await fetchFile(csvFile.url);
            const items = await parseCSV(csvData);

            if (items.length === 0) return interaction.editReply('❌ File CSV trống.');

            const result = await stockService.bulkImport(productId, items);
            return interaction.editReply(`✅ Đã import **${result.length}** accounts vào kho **${product.name}**.`);
        } catch (err) {
            return interaction.editReply(`❌ Lỗi: ${err.message}`);
        }
    }

    if (sub === 'stock') {
        await interaction.deferReply({ ephemeral: true });
        const productId = interaction.options.getString('product_id');
        const product = await productService.getById(productId);
        if (!product) return interaction.editReply('❌ Không tìm thấy sản phẩm.');

        const available = await stockService.countAvailable(productId);
        const ProductStock = require('../models/ProductStock');
        const sold = await ProductStock.countDocuments({ productId, status: 'sold' });

        return interaction.editReply(
            `🎮 **Tồn kho Account: ${product.name}**\n` +
            `✅ Còn hàng: \`${available}\`\n` +
            `🔴 Đã bán: \`${sold}\`\n` +
            `📊 Tổng: \`${available + sold}\``
        );
    }
}

// Helpers
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

function parseCSV(csvString) {
    return new Promise((resolve, reject) => {
        const items = [];
        Readable.from(csvString)
            .pipe(csv())
            .on('data', (row) => {
                const item = {
                    content: row.username || row.Username || '',
                    password: row.password || row.Password || '',
                    imageUrl: row.imageUrl || row.image || ''
                };
                if (item.content.trim()) items.push(item);
            })
            .on('end', () => resolve(items))
            .on('error', reject);
    });
}

module.exports = { command, execute };
