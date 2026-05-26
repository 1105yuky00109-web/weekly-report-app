const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const needed = [
    'days-container','task-row-template','report-status-badge','week-total-hours',
    'print-area','print-details-container','print-dynamic-style','print-gantt-title',
    'print-summary-title','reports-tbody','personal-summary-container',
    'qualifications-summary-container','member-list-tbody','employee-list-tbody',
    'emp-count-badge','project-suggestions','summary-filter-month','summary-table',
    'summary-tbody','summary-thead','copy-past-report-select','btn-copy-past-report',
    'btn-export','btn-export-gantt','btn-export-summary','btn-export-weekly',
    'btn-print','btn-print-gantt','btn-print-summary','btn-print-weekly',
    'edit-modal-overlay','filter-month','filter-author',
    'employee-quota-info','sched-address','member-list-container',
    'report-list-container','summary-container','employee-list-container',
    'qual-summary-area'
];
const missing = needed.filter(id => !html.includes('id="' + id + '"'));
console.log('不足しているID:');
missing.forEach(id => console.log(' -', id));
console.log('合計:', missing.length, '件');
