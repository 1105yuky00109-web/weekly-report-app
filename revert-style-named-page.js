const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'style.css');
let content = fs.readFileSync(filePath, 'utf8');

const targetStr = `@page { size: A4 portrait; margin: 8mm 10mm; }
    @page A3-landscape { size: A3 landscape; margin: 10mm; }
    .print-landscape-mode { page: A3-landscape; }`;

const replacementStr = `@page { size: A4 portrait; margin: 8mm 10mm; }`;

if (content.includes(targetStr)) {
    content = content.replace(targetStr, replacementStr);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log("STYLE REVERT SUCCESS");
} else {
    // 改行コード正規化して再テスト
    const contentNorm = content.split('\r\n').join('\n');
    const targetNorm = targetStr.split('\r\n').join('\n');
    if (contentNorm.includes(targetNorm)) {
        const updated = contentNorm.replace(targetNorm, replacementStr);
        fs.writeFileSync(filePath, updated, 'utf8');
        console.log("STYLE REVERT SUCCESS (Norm)");
    } else {
        console.log("STYLE REVERT FAILED");
    }
}
