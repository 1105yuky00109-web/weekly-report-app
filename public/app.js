const firebaseConfig = {
    apiKey: "AIzaSyBero5buqjW670UPObtf4QiVX-rkhhFfPs",
    authDomain: "weekly-report-93e5f.firebaseapp.com",
    projectId: "weekly-report-93e5f",
    storageBucket: "weekly-report-93e5f.firebasestorage.app",
    messagingSenderId: "905872831436",
    appId: "1:905872831436:web:1367ad0b1d54d9bba7a369",
    measurementId: "G-HC3D9SGNJ0"
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Firebase初期化
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 状態管理
let currentUser = null;
let allReports = [];
let allSchedules = [];

// DOM要素
const loginContainer = document.getElementById('login-container');
const signupContainer = document.getElementById('signup-container');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const btnLogout = document.getElementById('btn-logout');
const linkToSignup = document.getElementById('link-to-signup');
const linkToLogin = document.getElementById('link-to-login');

// 認証状態の監視
onAuthStateChanged(auth, (user) => {
    if (user) {
        // ログイン成功時
        currentUser = user;
        document.getElementById('current-user-email').textContent = user.email;
        
        // 担当者入力欄に表示名（氏名）を自動設定（未設定の場合はメールアドレスの@より前を使用）
        const nameDisplay = user.displayName || user.email.split('@')[0];
        document.getElementById('author').value = nameDisplay;
        document.getElementById('sched-author').value = nameDisplay;
        
        loginContainer.classList.add('hidden');
        if (signupContainer) signupContainer.classList.add('hidden');
        appContainer.classList.remove('hidden');
        
        // データ初期読み込み
        loadSchedules();
        loadReports(false);
    } else {
        // ログアウト状態
        currentUser = null;
        loginContainer.classList.remove('hidden');
        if (signupContainer) signupContainer.classList.add('hidden');
        appContainer.classList.add('hidden');
    }
});

// ログイン処理
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    const errorMsg = document.getElementById('login-error');
    
    signInWithEmailAndPassword(auth, email, pass)
        .then(() => {
            errorMsg.classList.add('hidden');
        })
        .catch((error) => {
            console.error(error);
            errorMsg.classList.remove('hidden');
            errorMsg.textContent = 'ログインに失敗しました。メールアドレスとパスワードを確認してください。';
        });
});

// 新規アカウント登録処理
if (signupForm) {
    signupForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('signup-name').value.trim();
        const email = document.getElementById('signup-email').value;
        const pass = document.getElementById('signup-password').value;
        const errorMsg = document.getElementById('signup-error');
        const successMsg = document.getElementById('signup-success');
        
        createUserWithEmailAndPassword(auth, email, pass)
            .then((userCredential) => {
                return updateProfile(userCredential.user, {
                    displayName: name
                });
            })
            .then(() => {
                errorMsg.classList.add('hidden');
                successMsg.classList.remove('hidden');
                successMsg.textContent = 'アカウントが作成されました！自動的にログインします。';
                signupForm.reset();
            })
            .catch((error) => {
                console.error(error);
                errorMsg.classList.remove('hidden');
                successMsg.classList.add('hidden');
                if (error.code === 'auth/email-already-in-use') {
                    errorMsg.textContent = 'このメールアドレスはすでに使用されています。';
                } else if (error.code === 'auth/weak-password') {
                    errorMsg.textContent = 'パスワードは6文字以上で設定してください。';
                } else {
                    errorMsg.textContent = '登録に失敗しました。メールアドレスとパスワードを確認してください。';
                }
            });
    });
}

// ログインと新規登録画面の切り替え
if (linkToSignup) {
    linkToSignup.addEventListener('click', (e) => {
        e.preventDefault();
        loginContainer.classList.add('hidden');
        signupContainer.classList.remove('hidden');
    });
}
if (linkToLogin) {
    linkToLogin.addEventListener('click', (e) => {
        e.preventDefault();
        signupContainer.classList.add('hidden');
        loginContainer.classList.remove('hidden');
    });
}

// ログアウト処理
btnLogout.addEventListener('click', () => {
    signOut(auth).catch(err => console.error(err));
});

// ユーティリティ関数
const getDaysOfWeek = (weekStr) => {
    if (!weekStr) return null;
    const parts = weekStr.split('-W');
    if (parts.length !== 2) return null;
    const year = parseInt(parts[0]);
    const week = parseInt(parts[1]);
    const jan4 = new Date(year, 0, 4);
    const dayOfWeekJan4 = jan4.getDay() || 7;
    const firstMonday = new Date(year, 0, 4 - dayOfWeekJan4 + 1);
    const targetMonday = new Date(firstMonday.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
    const days = [];
    for (let i = 0; i < 7; i++) days.push(new Date(targetMonday.getTime() + i * 24 * 60 * 60 * 1000));
    return days;
};
const formatDate = (dateObj) => `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
const formatWeekRange = (weekStr) => {
    const days = getDaysOfWeek(weekStr);
    return days ? `${formatDate(days[0])}〜${formatDate(days[6])}` : weekStr;
};
const getMonthStr = (weekStr) => {
    const days = getDaysOfWeek(weekStr);
    if (!days) return "";
    const d = days[0]; // 月曜日の日付を含む月をその週の「月」とする
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// --- 初期化ロジック群 ---
document.addEventListener('DOMContentLoaded', () => {
    const weekInput = document.getElementById('week');
    const weekDisplayHint = document.getElementById('week-display-hint');
    if (weekInput) {
        weekInput.addEventListener('change', () => {
            weekDisplayHint.textContent = weekInput.value ? formatWeekRange(weekInput.value) + ' の報告' : '';
        });
    }

    // テーマ切り替え初期化
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        if (localStorage.getItem('theme') === 'dark') {
            document.body.classList.add('dark-theme');
        }
        themeToggle.addEventListener('click', () => {
            document.body.classList.toggle('dark-theme');
            const isDark = document.body.classList.contains('dark-theme');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        });
    }

    // 日付ショートカット処理
    document.querySelectorAll('.btn-date-shortcut').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const type = btn.dataset.type;
            const targetInput = document.getElementById(targetId);
            if (!targetInput) return;

            const now = new Date();
            let dateVal = '';

            if (type === 'today') {
                dateVal = now.toISOString().split('T')[0];
            } else if (type === 'tomorrow') {
                now.setDate(now.getDate() + 1);
                dateVal = now.toISOString().split('T')[0];
            } else if (type === 'next-monday') {
                const daysUntilNextMonday = (1 - now.getDay() + 7) % 7 || 7;
                now.setDate(now.getDate() + daysUntilNextMonday);
                dateVal = now.toISOString().split('T')[0];
            }

            targetInput.value = dateVal;
            // 終了日も同じ日に自動設定
            const endInput = document.getElementById('sched-end');
            if (endInput && !endInput.value) {
                endInput.value = dateVal;
            }
        });
    });

    // タブ切り替え
    const tabBtns = document.querySelectorAll('.tab-btn');
    const views = document.querySelectorAll('.view');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            views.forEach(v => v.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.target).classList.add('active');
            
            if (btn.dataset.target === 'gantt-view') {
                document.body.classList.add('print-a3-landscape');
                loadSchedules();
            } else {
                document.body.classList.remove('print-a3-landscape');
                if (btn.dataset.target === 'list-view') loadReports(false);
                if (btn.dataset.target === 'summary-view') loadReports(true);
            }
        });
    });

    // 日別入力枠
    const daysName = ['月', '火', '水', '木', '金', '土', '日'];
    const daysContainer = document.getElementById('days-container');
    const taskRowTemplate = document.getElementById('task-row-template');

    const calculateWeekTotal = () => {
        let weekTotal = 0;
        document.querySelectorAll('.total-hours').forEach(span => {
            const h = parseFloat(span.textContent.replace('計 ', '').replace('H', ''));
            if (!isNaN(h)) weekTotal += h;
        });
        const weekTotalSpan = document.getElementById('week-total-hours');
        if (weekTotalSpan) {
            weekTotalSpan.textContent = `合計: ${weekTotal.toFixed(1)}H`;
        }
    };

    if (daysContainer) {
        daysName.forEach(day => {
            const dayCard = document.createElement('div');
            dayCard.className = 'day-card';
            dayCard.innerHTML = `
                <div class="day-header">
                    <span class="day-label">${day}曜日</span>
                    <span class="total-hours" style="font-size: 0.85rem; font-weight: normal;">計 0.0H</span>
                </div>
                <div class="day-body">
                    <div class="task-list" data-day="${day}"></div>
                    <button type="button" class="btn btn-add-task">＋ 工事・作業を追加</button>
                </div>
            `;
            daysContainer.appendChild(dayCard);
            const taskList = dayCard.querySelector('.task-list');
            
            const calculateTotal = () => {
                let total = 0;
                taskList.querySelectorAll('.task-hours').forEach(sel => {
                    const val = parseFloat(sel.value);
                    if (!isNaN(val)) total += val;
                });
                dayCard.querySelector('.total-hours').textContent = `計 ${total.toFixed(1)}H`;
                calculateWeekTotal();
            };

            const addTaskRow = (projVal = '', detailVal = '', hoursVal = '') => {
                const clone = taskRowTemplate.content.cloneNode(true);
                const row = clone.querySelector('.task-row');
                
                const projInput = row.querySelector('.task-project');
                const detailInput = row.querySelector('.task-detail');
                const hoursSelect = row.querySelector('.task-hours');
                
                if (projVal) projInput.value = projVal;
                if (detailVal) detailInput.value = detailVal;
                if (hoursVal) hoursSelect.value = hoursVal;

                row.querySelector('.remove-task-btn').addEventListener('click', () => { row.remove(); calculateTotal(); });
                hoursSelect.addEventListener('change', calculateTotal);
                taskList.appendChild(row);
                calculateTotal();
            };

            taskList.addTaskRow = addTaskRow;
            taskList.clearAll = () => {
                taskList.innerHTML = '';
                calculateTotal();
            };

            if (['月', '火', '水', '木', '金'].includes(day)) addTaskRow();
            dayCard.querySelector('.btn-add-task').addEventListener('click', () => addTaskRow());
        });
    }

    // 過去日報コピー処理の実装
    const btnCopy = document.getElementById('btn-copy-past-report');
    const copySelect = document.getElementById('copy-past-report-select');
    if (btnCopy && copySelect) {
        btnCopy.addEventListener('click', () => {
            const selectedIdx = copySelect.value;
            if (selectedIdx === '') {
                alert('コピー元の日報を選択してください。');
                return;
            }
            const myReports = JSON.parse(copySelect.dataset.reportsJson || '[]');
            const sourceReport = myReports[selectedIdx];
            if (!sourceReport || !sourceReport.dailyLogs) {
                alert('日報データの読み込みに失敗しました。');
                return;
            }

            if (!confirm('現在入力中の内容をクリアして、選択した過去の日報をコピーしますか？')) {
                return;
            }

            // コピー実行
            daysName.forEach(day => {
                const taskList = document.querySelector(`.task-list[data-day="${day}"]`);
                if (taskList && taskList.clearAll && taskList.addTaskRow) {
                    taskList.clearAll();
                    const tasks = sourceReport.dailyLogs[day] || [];
                    tasks.forEach(t => {
                        taskList.addTaskRow(t.project, t.detail, t.hours);
                    });
                }
            });
            
            // 週次まとめ部分もコピー
            const actual = document.getElementById('actual');
            const plan = document.getElementById('plan');
            const notes = document.getElementById('notes');
            if (actual) actual.value = sourceReport.actual || '';
            if (plan) plan.value = sourceReport.plan || '';
            if (notes) notes.value = sourceReport.notes || '';

            calculateWeekTotal();
            alert('コピーが完了しました！必要に応じて編集してください。');
        });
    }

    // 予定(Schedule)保存 - Firebase Firestore
    const schedForm = document.getElementById('schedule-form');
    if (schedForm) {
        schedForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const schedData = {
                project: document.getElementById('sched-project').value,
                author: document.getElementById('sched-author').value,
                start: document.getElementById('sched-start').value,
                end: document.getElementById('sched-end').value,
                notes: document.getElementById('sched-notes').value,
                timestamp: new Date().toISOString()
            };
            try {
                await addDoc(collection(db, "schedules"), schedData);
                const msg = document.getElementById('sched-submit-message');
                msg.classList.remove('hidden');
                schedForm.reset();
                document.getElementById('sched-author').value = currentUser.email.split('@')[0]; // reset author
                setTimeout(() => msg.classList.add('hidden'), 3000);
            } catch (error) {
                console.error("Error adding document: ", error);
                alert('保存に失敗しました。接続設定を確認してください。');
            }
        });
    }

    // 日報(Report)保存 - Firebase Firestore
    const reportForm = document.getElementById('report-form');
    if (reportForm) {
        reportForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const dailyLogs = {};
            daysName.forEach(day => {
                const rows = document.querySelector(`.task-list[data-day="${day}"]`).querySelectorAll('.task-row');
                const tasks = [];
                rows.forEach(row => {
                    const project = row.querySelector('.task-project').value.trim();
                    const detail = row.querySelector('.task-detail').value.trim();
                    const hours = row.querySelector('.task-hours').value;
                    if (project || detail || hours) tasks.push({ project, detail, hours });
                });
                dailyLogs[day] = tasks;
            });

            const reportData = {
                week: document.getElementById('week').value,
                author: document.getElementById('author').value,
                dailyLogs,
                actual: document.getElementById('actual').value,
                plan: document.getElementById('plan').value,
                notes: document.getElementById('notes').value,
                timestamp: new Date().toISOString()
            };

            try {
                await addDoc(collection(db, "reports"), reportData);
                const msg = document.getElementById('submit-message');
                msg.classList.remove('hidden');
                reportForm.querySelectorAll('input:not([type="week"]):not([id="author"]), textarea, select').forEach(el => el.value = '');
                document.querySelectorAll('.day-card').forEach(card => card.querySelector('.total-hours').textContent = '計 0.0H');
                window.scrollTo(0, 0);
                setTimeout(() => msg.classList.add('hidden'), 3000);
            } catch (error) {
                console.error("Error adding document: ", error);
                alert('保存に失敗しました。');
            }
        });
    }

    // データ読み込み（ガントチャート）
    const ganttMonthInput = document.getElementById('gantt-month');
    const today = new Date();
    ganttMonthInput.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

    window.loadSchedules = async () => {
        try {
            const q = query(collection(db, "schedules"));
            const querySnapshot = await getDocs(q);
            allSchedules = querySnapshot.docs.map(doc => doc.data());
            renderGanttChart();
            updateProjectSuggestions();
        } catch (e) {
            console.error("Error loading schedules: ", e);
        }
    };

    const renderGanttChart = () => {
        const container = document.getElementById('gantt-container');
        const monthStr = ganttMonthInput.value;
        if (!monthStr) return;
        const [year, month] = monthStr.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        const startOfMonth = new Date(year, month - 1, 1).toISOString().split('T')[0];
        const endOfMonth = new Date(year, month, 0).toISOString().split('T')[0];

        const targetSchedules = allSchedules.filter(s => s.start <= endOfMonth && s.end >= startOfMonth);
        const uniqueAuthors = [...new Set(targetSchedules.map(s => s.author))];
        const colors = ['#2563eb', '#16a34a', '#ea580c', '#9333ea', '#db2777', '#0891b2', '#ca8a04', '#4f46e5'];

        let html = `<div class="gantt-grid" style="grid-template-columns: 150px 100px repeat(${daysInMonth}, minmax(25px, 1fr));">`;
        html += `<div class="gantt-cell gantt-header-cell">工事名</div>`;
        html += `<div class="gantt-cell gantt-header-cell">担当者</div>`;
        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(year, month - 1, d);
            const dayOfWeekStr = ['日','月','火','水','木','金','土'][dateObj.getDay()];
            const isWeekend = (dateObj.getDay() === 0 || dateObj.getDay() === 6) ? 'color:red;' : '';
            html += `<div class="gantt-cell gantt-header-cell" style="${isWeekend}">${d}<br><span style="font-size:0.7rem">${dayOfWeekStr}</span></div>`;
        }

        targetSchedules.forEach((s, index) => {
            const rowIndex = index + 2;
            html += `<div class="gantt-cell gantt-proj-cell" style="grid-row: ${rowIndex}; grid-column: 1;">${s.project}</div>`;
            html += `<div class="gantt-cell gantt-author-cell" style="grid-row: ${rowIndex}; grid-column: 2;">${s.author}</div>`;
            for (let d = 1; d <= daysInMonth; d++) {
                html += `<div class="gantt-bar-bg-cell" style="grid-row: ${rowIndex}; grid-column: ${d + 2};"></div>`;
            }
            
            const sStart = new Date(s.start);
            const sEnd = new Date(s.end);
            const mStart = new Date(year, month - 1, 1);
            const mEnd = new Date(year, month, 0);

            let startDay = 1; if (sStart > mStart) startDay = sStart.getDate();
            let endDay = daysInMonth; if (sEnd < mEnd) endDay = sEnd.getDate();

            const gridStart = startDay + 2;
            const gridEnd = endDay + 3;
            const authorColor = colors[uniqueAuthors.indexOf(s.author) % colors.length];

            html += `<div class="gantt-bar" style="grid-row: ${rowIndex}; grid-column: ${gridStart} / ${gridEnd}; margin: 5px 0; background-color: ${authorColor};">
                        ${s.notes || s.project}
                     </div>`;
        });

        if (targetSchedules.length === 0) {
            html += `<div style="grid-column: 1 / -1; padding: 20px; text-align: center;">予定が登録されていません。</div>`;
        }
        html += `</div>`;
        container.innerHTML = html;
        document.getElementById('print-gantt-title').textContent = `${year}年${month}月 作業予定表`;
    };
    ganttMonthInput.addEventListener('change', renderGanttChart);

    // 工事名サジェスト（Datalist）の更新
    const updateProjectSuggestions = () => {
        const suggestions = new Set();
        allSchedules.forEach(s => { if (s.project) suggestions.add(s.project); });
        allReports.forEach(r => {
            if (r.dailyLogs) {
                Object.values(r.dailyLogs).forEach(tasks => {
                    if (Array.isArray(tasks)) {
                        tasks.forEach(t => { if (t.project) suggestions.add(t.project); });
                    }
                });
            }
        });
        const datalist = document.getElementById('project-suggestions');
        if (datalist) {
            datalist.innerHTML = Array.from(suggestions)
                .sort()
                .map(p => `<option value="${p}">`)
                .join('');
        }
    };

    // コピー選択肢の更新
    const updateCopySelect = () => {
        const select = document.getElementById('copy-past-report-select');
        if (!select || !currentUser) return;
        
        const myName = currentUser.email.split('@')[0];
        const myReports = allReports.filter(r => r.author === myName);
        myReports.sort((a, b) => (a.week < b.week ? 1 : -1)); // 降順
        
        select.innerHTML = '<option value="">過去の日報からコピーして作成...</option>';
        myReports.forEach((r, idx) => {
            select.innerHTML += `<option value="${idx}">${r.week} (${formatWeekRange(r.week)})</option>`;
        });
        select.dataset.reportsJson = JSON.stringify(myReports);
    };

    // データ読み込み（日報）
    window.loadReports = async (isSummary = false) => {
        try {
            const q = query(collection(db, "reports"));
            const querySnapshot = await getDocs(q);
            allReports = querySnapshot.docs.map(doc => doc.data());
            
            updateFilterOptions();
            updateCopySelect();
            updateProjectSuggestions();
            if (isSummary) renderSummaryTable();
            else renderTable();
        } catch (e) {
            console.error("Error loading reports: ", e);
        }
    };

    // レンダリング処理
    const updateFilterOptions = () => {
        const months = [...new Set(allReports.map(r => getMonthStr(r.week)))].filter(Boolean).sort().reverse();
        const weeks = [...new Set(allReports.map(r => r.week))].filter(Boolean).sort().reverse();
        const authors = [...new Set(allReports.map(r => r.author))].filter(Boolean).sort();

        const filterMonth = document.getElementById('filter-month');
        if (filterMonth) {
            const cur = filterMonth.value;
            filterMonth.innerHTML = '<option value="">すべての月</option>';
            months.forEach(m => filterMonth.innerHTML += `<option value="${m}">${m.replace('-', '年')}月</option>`);
            filterMonth.value = cur;
        }

        const summaryFilterWeek = document.getElementById('summary-filter-week');
        if (summaryFilterWeek) {
            const cur = summaryFilterWeek.value;
            summaryFilterWeek.innerHTML = '<option value="">すべての週</option>';
            weeks.forEach(w => summaryFilterWeek.innerHTML += `<option value="${w}">${w} (${formatWeekRange(w)})</option>`);
            summaryFilterWeek.value = cur;
        }

        const filterAuthor = document.getElementById('filter-author');
        if (filterAuthor) {
            const cur = filterAuthor.value;
            filterAuthor.innerHTML = '<option value="">すべての担当者</option>';
            authors.forEach(a => filterAuthor.innerHTML += `<option value="${a}">${a}</option>`);
            filterAuthor.value = cur;
        }
    };

    const renderTable = () => {
        const filterMonth = document.getElementById('filter-month').value;
        const filterAuthor = document.getElementById('filter-author').value;
        const tbody = document.getElementById('reports-tbody');
        const printContainer = document.getElementById('print-details-container');
        const personalSummary = document.getElementById('personal-summary-container');

        const filtered = allReports.filter(r => 
            (filterMonth === '' || getMonthStr(r.week) === filterMonth) && 
            (filterAuthor === '' || r.author === filterAuthor)
        );
        filtered.sort((a,b) => (a.week < b.week ? 1 : -1)); // 降順
        
        tbody.innerHTML = ''; printContainer.innerHTML = ''; if(personalSummary) personalSummary.innerHTML = '';

        const authorProjectHours = {};

        filtered.forEach(r => {
            // 集計データの蓄積
            if (!authorProjectHours[r.author]) authorProjectHours[r.author] = {};
            const days = ['月','火','水','木','金','土','日'];
            days.forEach(day => {
                const ts = r.dailyLogs ? r.dailyLogs[day] : [];
                if (ts) ts.forEach(t => {
                    if (t.project) {
                        authorProjectHours[r.author][t.project] = (authorProjectHours[r.author][t.project] || 0) + parseFloat(t.hours || 0);
                    }
                });
            });
            const tr = document.createElement('tr');
            const dates = getDaysOfWeek(r.week);
            const getDayLabel = (idx, name) => dates ? `${formatDate(dates[idx])}<br>(${name})` : name;
            const renderCell = (day) => (r.dailyLogs && r.dailyLogs[day]) ? r.dailyLogs[day].map(t => `<div class="day-summary-cell"><strong>${t.project}</strong>${t.detail} (${parseFloat(t.hours||0).toFixed(1)}H)</div>`).join('') : '-';

            tr.innerHTML = `
                <td>${formatWeekRange(r.week)}</td>
                <td><strong>${r.author || ''}</strong></td>
                <td><div style="font-size:0.75rem; color:#64748b;">${getDayLabel(0, '月')}</div>${renderCell('月')}</td>
                <td><div style="font-size:0.75rem; color:#64748b;">${getDayLabel(1, '火')}</div>${renderCell('火')}</td>
                <td><div style="font-size:0.75rem; color:#64748b;">${getDayLabel(2, '水')}</div>${renderCell('水')}</td>
                <td><div style="font-size:0.75rem; color:#64748b;">${getDayLabel(3, '木')}</div>${renderCell('木')}</td>
                <td><div style="font-size:0.75rem; color:#64748b;">${getDayLabel(4, '金')}</div>${renderCell('金')}</td>
                <td><div style="font-size:0.75rem; color:#64748b;">${getDayLabel(5, '土')}</div>${renderCell('土')}</td>
                <td><div style="font-size:0.75rem; color:#64748b;">${getDayLabel(6, '日')}</div>${renderCell('日')}</td>
            `;
            tbody.appendChild(tr);

            let printTasksHtml = '';
            daysName.forEach((day, idx) => {
                const ts = r.dailyLogs ? r.dailyLogs[day] : [];
                if (ts && ts.length > 0) {
                    ts.forEach(t => {
                        printTasksHtml += `<tr><td>${dates ? formatDate(dates[idx]) : ''}(${day})</td><td>${t.project}</td><td>${t.detail}</td><td>${parseFloat(t.hours||0).toFixed(1)}H</td></tr>`;
                    });
                }
            });

            printContainer.innerHTML += `
                <div class="print-report-card">
                    <div class="print-report-header">対象期間: ${formatWeekRange(r.week)} ｜ 担当者: ${r.author || ''}</div>
                    <div class="print-report-body">
                        <strong>■ 業務実績（日別詳細）</strong>
                        <table class="print-task-table">
                            <thead><tr><th>日付(曜)</th><th>工事名</th><th>作業内容</th><th>時間</th></tr></thead>
                            <tbody>${printTasksHtml || '<tr><td colspan="4">記録なし</td></tr>'}</tbody>
                        </table>
                        <strong>■ 今週のまとめ（実績）</strong><p style="white-space: pre-wrap;">${r.actual || '-'}</p><br>
                        <strong>■ 次週の予定</strong><p style="white-space: pre-wrap;">${r.plan || '-'}</p><br>
                        <strong>■ 備考</strong><p style="white-space: pre-wrap;">${r.notes || '-'}</p>
                    </div>
                </div>
            `;
        });

        // 下部の個人別集計表を描画
        if (Object.keys(authorProjectHours).length > 0 && personalSummary) {
            let summaryHtml = '<h3 style="padding: 15px; border-bottom: 2px solid var(--border); margin-bottom: 15px;">【月間】個人別 工事稼働時間（集計）</h3><div style="padding: 0 15px 15px 15px; display: flex; gap: 20px; flex-wrap: wrap;">';
            Object.keys(authorProjectHours).sort().forEach(author => {
                summaryHtml += `<div style="flex: 1; min-width: 300px; background: #fff; padding: 15px; border-radius: 8px; border: 1px solid var(--border); box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                    <h4 style="margin-bottom: 15px; color: var(--primary); font-size: 1.1rem;">${author} さん</h4>
                    <table style="width: 100%; font-size: 0.95rem; border-collapse: collapse;">
                        <thead><tr style="background:#f1f5f9; border-bottom: 2px solid var(--border);"><th style="padding: 8px; text-align: left;">工事名</th><th style="padding: 8px; text-align: right;">時間(H)</th></tr></thead>
                        <tbody>`;
                let total = 0;
                Object.keys(authorProjectHours[author]).sort().forEach(proj => {
                    const hrs = authorProjectHours[author][proj];
                    total += hrs;
                    summaryHtml += `<tr style="border-bottom: 1px solid var(--border);"><td style="padding: 8px;">${proj}</td><td style="padding: 8px; text-align: right; font-weight: bold;">${hrs.toFixed(1)}</td></tr>`;
                });
                summaryHtml += `<tr style="background: #f8fafc; font-weight: bold;"><td style="padding: 10px;">合計</td><td style="padding: 10px; text-align: right; color: var(--primary); font-size: 1.1rem;">${total.toFixed(1)}</td></tr>`;
                summaryHtml += `</tbody></table></div>`;
            });
            summaryHtml += '</div>';
            personalSummary.innerHTML = summaryHtml;
        }
    };

    const renderSummaryTable = () => {
        const filterWeek = document.getElementById('summary-filter-week').value;
        const tbody = document.getElementById('summary-tbody');
        const filtered = allReports.filter(r => filterWeek === '' || r.week === filterWeek);
        const projectMap = {};

        filtered.forEach(r => {
            const wRange = formatWeekRange(r.week);
            daysName.forEach(day => {
                const ts = r.dailyLogs ? r.dailyLogs[day] : [];
                if (ts) ts.forEach(t => {
                    if (!t.project) return;
                    if (!projectMap[t.project]) projectMap[t.project] = {};
                    if (!projectMap[t.project][wRange]) projectMap[t.project][wRange] = {};
                    if (!projectMap[t.project][wRange][r.author]) projectMap[t.project][wRange][r.author] = { hours: 0, details: new Set() };
                    projectMap[t.project][wRange][r.author].hours += parseFloat(t.hours || 0);
                    if (t.detail) projectMap[t.project][wRange][r.author].details.add(t.detail);
                });
            });
        });

        tbody.innerHTML = '';
        Object.keys(projectMap).sort().forEach(proj => {
            Object.keys(projectMap[proj]).sort().reverse().forEach(w => {
                Object.keys(projectMap[proj][w]).sort().forEach(auth => {
                    const data = projectMap[proj][w][auth];
                    tbody.innerHTML += `<tr><td><strong>${proj}</strong></td><td>${w}</td><td>${auth}</td><td style="color:var(--primary); font-weight:bold;">${data.hours.toFixed(1)}H</td><td style="font-size:0.85rem;">${Array.from(data.details).join('、')}</td></tr>`;
                });
            });
        });
    };

    ['filter-month', 'filter-author'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', renderTable);
    });
    const summaryFilterWeek = document.getElementById('summary-filter-week');
    if(summaryFilterWeek) summaryFilterWeek.addEventListener('change', renderSummaryTable);

    document.querySelectorAll('[id^="btn-print"]').forEach(btn => btn.addEventListener('click', () => window.print()));

    // Excel Export (Gantt)
    const btnExportGantt = document.getElementById('btn-export-gantt');
    if (btnExportGantt) {
        btnExportGantt.addEventListener('click', () => {
            if (typeof XLSX === 'undefined') return alert('Excelライブラリの読み込みに失敗しました。');
            const ws = XLSX.utils.json_to_sheet(allSchedules.map(s => ({
                "担当者": s.author,
                "工事名": s.project,
                "開始日": s.start,
                "終了日": s.end,
                "作業内容": s.notes || ""
            })));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "月間予定");
            XLSX.writeFile(wb, "月間作業予定.xlsx");
        });
    }

    // Excel Export (List)
    const btnExportList = document.getElementById('btn-export');
    if (btnExportList) {
        btnExportList.addEventListener('click', () => {
            if (typeof XLSX === 'undefined') return alert('Excelライブラリの読み込みに失敗しました。');
            const filterMonth = document.getElementById('filter-month').value;
            const filterAuthor = document.getElementById('filter-author').value;
            const filtered = allReports.filter(r => 
                (filterMonth === '' || getMonthStr(r.week) === filterMonth) && 
                (filterAuthor === '' || r.author === filterAuthor)
            );
            const rows = [];
            const authorProjectHours = {};

            filtered.forEach(r => {
                const days = ['月','火','水','木','金','土','日'];
                days.forEach(day => {
                    if(r.dailyLogs && r.dailyLogs[day]){
                        r.dailyLogs[day].forEach(t => {
                            // 詳細一覧用のデータ
                            rows.push({
                                "対象期間": formatWeekRange(r.week),
                                "担当者": r.author,
                                "曜日": day,
                                "工事名": t.project,
                                "作業内容": t.detail,
                                "作業時間(H)": t.hours,
                                "実績": r.actual || "",
                                "予定": r.plan || "",
                                "備考": r.notes || ""
                            });
                            // 集計用のデータ蓄積
                            if (t.project) {
                                if (!authorProjectHours[r.author]) authorProjectHours[r.author] = {};
                                authorProjectHours[r.author][t.project] = (authorProjectHours[r.author][t.project] || 0) + parseFloat(t.hours || 0);
                            }
                        });
                    }
                });
            });

            const wb = XLSX.utils.book_new();
            
            // 1シート目: 日報一覧
            const wsList = XLSX.utils.json_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, wsList, "日報一覧(詳細)");

            // 2シート目: 個人別集計
            const summaryRows = [];
            Object.keys(authorProjectHours).sort().forEach(author => {
                let total = 0;
                Object.keys(authorProjectHours[author]).sort().forEach(proj => {
                    const hrs = authorProjectHours[author][proj];
                    total += hrs;
                    summaryRows.push({ "担当者": author, "工事名": proj, "合計時間(H)": hrs });
                });
                summaryRows.push({ "担当者": author, "工事名": "【合計】", "合計時間(H)": total });
                summaryRows.push({}); // 空行
            });

            if (summaryRows.length > 0) {
                const wsSum = XLSX.utils.json_to_sheet(summaryRows);
                XLSX.utils.book_append_sheet(wb, wsSum, "個人別集計(月間)");
            }

            XLSX.writeFile(wb, "個人別日報_月間集計.xlsx");
        });
    }

    // Excel Export (Summary)
    const btnExportSummary = document.getElementById('btn-export-summary');
    if (btnExportSummary) {
        btnExportSummary.addEventListener('click', () => {
            if (typeof XLSX === 'undefined') return alert('Excelライブラリの読み込みに失敗しました。');
            const filterWeek = document.getElementById('summary-filter-week').value;
            const filtered = allReports.filter(r => filterWeek === '' || r.week === filterWeek);
            const rows = [];
            const projectMap = {};
            filtered.forEach(r => {
                const wRange = formatWeekRange(r.week);
                ['月','火','水','木','金','土','日'].forEach(day => {
                    const ts = r.dailyLogs ? r.dailyLogs[day] : [];
                    if (ts) ts.forEach(t => {
                        if (!t.project) return;
                        if (!projectMap[t.project]) projectMap[t.project] = {};
                        if (!projectMap[t.project][wRange]) projectMap[t.project][wRange] = {};
                        if (!projectMap[t.project][wRange][r.author]) projectMap[t.project][wRange][r.author] = { hours: 0, details: new Set() };
                        projectMap[t.project][wRange][r.author].hours += parseFloat(t.hours || 0);
                        if (t.detail) projectMap[t.project][wRange][r.author].details.add(t.detail);
                    });
                });
            });
            Object.keys(projectMap).sort().forEach(proj => {
                Object.keys(projectMap[proj]).sort().reverse().forEach(w => {
                    Object.keys(projectMap[proj][w]).sort().forEach(auth => {
                        const data = projectMap[proj][w][auth];
                        rows.push({
                            "工事名": proj,
                            "対象期間": w,
                            "担当者": auth,
                            "合計作業時間(H)": data.hours,
                            "主な作業内容": Array.from(data.details).join('、')
                        });
                    });
                });
            });
            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "工事別集計");
            XLSX.writeFile(wb, "工事別集計.xlsx");
        });
    }
});
