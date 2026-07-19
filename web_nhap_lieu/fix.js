const fs = require('fs');

let buttonHandler = fs.readFileSync('src/handlers/buttonHandler.js', 'utf8');

// Replace deferUpdate with safe check
buttonHandler = buttonHandler.replace(/await interaction\.deferUpdate\(\);/g, `if (interaction.message?.flags?.has(64)) {
        await interaction.deferUpdate();
    } else {
        await interaction.deferReply({ ephemeral: true });
    }`);

// For error messages and replies that used interaction.update
buttonHandler = buttonHandler.replace(/return interaction\.update\(\{ content: '(❌.*?)', embeds: \[\], components: \[\] \}\);/g, 
`if (interaction.message?.flags?.has(64)) return interaction.update({ content: '$1', embeds: [], components: [] });
        else return interaction.reply({ content: '$1', ephemeral: true });`);

buttonHandler = buttonHandler.replace(/return interaction\.update\(\{ content: '', embeds: \[embed\], components: \[buyRow\] \}\);/g,
`if (interaction.message?.flags?.has(64)) return interaction.update({ content: '', embeds: [embed], components: [buyRow] });
        else return interaction.reply({ embeds: [embed], components: [buyRow], ephemeral: true });`);

fs.writeFileSync('src/handlers/buttonHandler.js', buttonHandler);
console.log('Fixed buttonHandler.js');
