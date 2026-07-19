const fs = require('fs');
let code = fs.readFileSync('D.js', 'utf8');

const helper = `
async function replyEphemeral(interaction, content) {
    try {
        await interaction.reply({ content: content, ephemeral: true });
        setTimeout(() => {
            interaction.deleteReply().catch(() => {});
        }, 5000);
    } catch (e) {}
}
`;

code = code.replace(/return interaction\.reply\(\{ content: ([^,]+), ephemeral: true \}\);/g, "return replyEphemeral(interaction, $1);");
code = code.replace(/try \{ await interaction\.reply\(\{ content: '❌ Lỗi hệ thống\.', ephemeral: true \}\); \} catch\(e\)\{\}/g, "await replyEphemeral(interaction, '❌ Lỗi hệ thống.');");
code = code.replace('function generateUniqueAmount', helper + '\nfunction generateUniqueAmount');

fs.writeFileSync('D.js', code);
