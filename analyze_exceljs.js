const ExcelJS = require('exceljs');

async function main() {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile('public/template-weekly.xlsx');
    const sheet = workbook.worksheets[0];
    console.log(`Sheet Name: ${sheet.name}`);
    
    console.log("\nMerged Cells in ExcelJS:");
    // ExcelJSの結合セルをダンプ
    sheet.eachRow((row, rowNumber) => {
        row.eachCell((cell, colNumber) => {
            if (cell.isMerged && cell.address === cell.master.address) {
                // 結合セルのマスターセル（左上）とその範囲を表示
                // ExcelJSの結合セル範囲の取得
                console.log(`Master Cell: ${cell.address}, Value: '${cell.value || ''}'`);
            }
        });
    });
}

main().catch(console.error);
