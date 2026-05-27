const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public', 'style.css');
let content = fs.readFileSync(filePath, 'utf8');

const target = '@page { size: A4 portrait; margin: 8mm 10mm; }';
const replacement = `@page { size: A4 portrait; margin: 8mm 10mm; }
    @page A3-landscape { size: A3 landscape; margin: 10mm; }
    .print-landscape-mode { page: A3-landscape; }`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log("STYLE SUCCESS");
} else {
    console.log("STYLE FAILED to find target");
}
