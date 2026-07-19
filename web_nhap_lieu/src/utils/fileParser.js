/**
 * fileParser.js - Xử lý bóc tách dữ liệu từ file Text hoặc CSV
 */

function parseCSV(fileString) {
    return new Promise((resolve) => {
        const items = [];
        const lines = fileString.split(/\r?\n/);
        
        let startIndex = 0;
        // Bỏ qua dòng tiêu đề nếu có
        if (lines[0] && (lines[0].toLowerCase().includes('code') || lines[0].toLowerCase().includes('username'))) {
            startIndex = 1;
        }

        for (let i = startIndex; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            let parts;
            if (line.includes('|')) {
                parts = line.split('|');
            } else if (line.includes(',')) {
                parts = line.split(',');
            } else {
                parts = [line];
            }

            const item = {
                content: parts[0]?.trim() || '',
                password: parts[1]?.trim() || '',
                imageUrl: parts[2]?.trim() || ''
            };
            
            if (item.content) {
                items.push(item);
            }
        }
        resolve(items);
    });
}

module.exports = { parseCSV };
