const fs = require('fs');
const path = require('path');

const codePath = path.join(__dirname, 'public', 'app-v4.js');
if (!fs.existsSync(codePath)) {
    console.error("app-v4.js not found!");
    process.exit(1);
}

const content = fs.readFileSync(codePath, 'utf8');
const lines = content.split('\n');

const queries = ['days-container', 'day-card', 'morning-project', 'datalist'];

queries.forEach(query => {
    console.log(`=== Matches for "${query}" ===`);
    lines.forEach((line, index) => {
        if (line.includes(query)) {
            console.log(`${index + 1}: ${line.trim()}`);
        }
    });
    console.log('\n');
});
