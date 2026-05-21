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
import { getFirestore, collection, addDoc, getDocs, query, orderBy, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

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
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // displayNameがまだ反映されていない場合に備えて再読み込み
        if (!user.displayName) {
            try { await user.reload(); user = auth.currentUser; } catch(e) {}
        }

        // ログイン成功時
        currentUser = auth.currentUser;
        document.getElementById('current-user-email').textContent = currentUser.email;
        
        // 担当者入力欄に表示名（氏名）を自動設定（未設定の場合はメールアドレスの@より前を使用）
        const nameDisplay = currentUser.displayName || currentUser.email.split('@')[0];
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
        
        if (!name) {
            errorMsg.classList.remove('hidden');
            errorMsg.textContent = 'フルネーム（氏名）を入力してください。';
            return;
        }
        
        createUserWithEmailAndPassword(auth, email, pass)
            .then((userCredential) => {
                // displayNameを登録
                return updateProfile(userCredential.user, {
                    displayName: name
                }).then(() => userCredential.user);
            })
            .then((user) => {
                // updateProfile完了後、担当者欄を即座に更新
                currentUser = auth.currentUser;
                const authorEl = document.getElementById('author');
                const schedAuthorEl = document.getElementById('sched-author');
                if (authorEl) authorEl.value = name;
                if (schedAuthorEl) schedAuthorEl.value = name;
                
                errorMsg.classList.add('hidden');
                successMsg.classList.remove('hidden');
                successMsg.textContent = `「${name}」で登録しました！自動的にログインします。`;
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
            
            if (btn.dataset.target === 'gantt-view' || btn.dataset.target === 'summary-view') {
                document.body.classList.add('print-a3-landscape');
                if (btn.dataset.target === 'gantt-view') loadSchedules();
                if (btn.dataset.target === 'summary-view') loadReports(true);
            } else {
                document.body.classList.remove('print-a3-landscape');
                if (btn.dataset.target === 'list-view') loadReports(false);
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
                    <div class="day-report-field" style="margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 10px;">
                        <label style="font-size: 0.85rem; font-weight: bold; margin-bottom: 5px; display: block; color: var(--text-muted);">📝 日次レポート・備考</label>
                        <textarea class="day-report-text" rows="2" placeholder="今日の作業報告や特記事項を記入してください" style="width: 100%; border: 1px solid var(--border); border-radius: 4px; padding: 8px; font-size: 0.9rem; background: var(--bg); color: var(--text); resize: vertical;"></textarea>
                    </div>
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

            const addTaskRow = (projVal = '', detailVal = '', hoursVal = '', timelineVal = '') => {
                const clone = taskRowTemplate.content.cloneNode(true);
                const row = clone.querySelector('.task-row');
                
                const projInput = row.querySelector('.task-project');
                const detailInput = row.querySelector('.task-detail');
                const hoursInput = row.querySelector('.task-hours');
                const timelineInput = row.querySelector('.task-timeline-data');
                const hoursTotalSpan = row.querySelector('.timeline-hours-total');
                
                if (projVal) projInput.value = projVal;
                if (detailVal) detailInput.value = detailVal;
                
                let stateArray = Array(48).fill(0); // 0:なし, 1:作業, 2:休憩
                if (timelineVal && timelineVal.length === 48) {
                    stateArray = timelineVal.split('').map(Number);
                } else if (hoursVal) {
                    const hours = parseFloat(hoursVal);
                    if (!isNaN(hours)) {
                        const slotCount = Math.round(hours * 2);
                        const startSlot = 16; // 8:00
                        for (let i = 0; i < slotCount; i++) {
                            if (startSlot + i < 48) {
                                stateArray[startSlot + i] = 1;
                            }
                        }
                    }
                }
                
                const headerContainer = row.querySelector('.timeline-hours-header');
                for (let h = 0; h < 24; h++) {
                    const lbl = document.createElement('div');
                    lbl.className = 'timeline-hour-label';
                    lbl.textContent = h;
                    headerContainer.appendChild(lbl);
                }
                
                const cellsGrid = row.querySelector('.timeline-cells-grid');
                const cellElements = [];
                for (let i = 0; i < 48; i++) {
                    const cell = document.createElement('div');
                    cell.className = 'timeline-cell';
                    cell.dataset.index = i;
                    cell.dataset.state = stateArray[i];
                    
                    const hour = Math.floor(i / 2);
                    const min = (i % 2 === 0) ? '00' : '30';
                    const nextHour = Math.floor((i + 1) / 2);
                    const nextMin = ((i + 1) % 2 === 0) ? '00' : '30';
                    cell.title = `${String(hour).padStart(2, '0')}:${min}〜${String(nextHour).padStart(2, '0')}:${nextMin}`;
                    
                    cellsGrid.appendChild(cell);
                    cellElements.push(cell);
                }
                
                let currentMode = 1;
                const paletteBtns = row.querySelectorAll('.palette-btn');
                paletteBtns.forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        paletteBtns.forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        currentMode = parseInt(btn.dataset.mode);
                    });
                });
                
                let isDrawing = false;
                
                const updateCellState = (index) => {
                    if (index < 0 || index >= 48) return;
                    stateArray[index] = currentMode;
                    cellElements[index].dataset.state = currentMode;
                    
                    const workCount = stateArray.filter(s => s === 1).length;
                    const totalHours = workCount * 0.5;
                    hoursTotalSpan.textContent = totalHours.toFixed(1);
                    hoursInput.value = totalHours.toFixed(1);
                    timelineInput.value = stateArray.join('');
                    
                    calculateTotal();
                };

                cellsGrid.addEventListener('mousedown', (e) => {
                    const cell = e.target.closest('.timeline-cell');
                    if (cell) {
                        isDrawing = true;
                        const idx = parseInt(cell.dataset.index);
                        updateCellState(idx);
                    }
                });
                
                cellsGrid.addEventListener('mousemove', (e) => {
                    if (!isDrawing) return;
                    const cell = e.target.closest('.timeline-cell');
                    if (cell) {
                        const idx = parseInt(cell.dataset.index);
                        updateCellState(idx);
                    }
                });
                
                const stopDrawing = () => { isDrawing = false; };
                window.addEventListener('mouseup', stopDrawing);
                
                cellsGrid.addEventListener('touchstart', (e) => {
                    const touch = e.touches[0];
                    const target = document.elementFromPoint(touch.clientX, touch.clientY);
                    const cell = target ? target.closest('.timeline-cell') : null;
                    if (cell && cell.parentNode === cellsGrid) {
                        isDrawing = true;
                        const idx = parseInt(cell.dataset.index);
                        updateCellState(idx);
                        e.preventDefault();
                    }
                }, { passive: false });
                
                cellsGrid.addEventListener('touchmove', (e) => {
                    if (!isDrawing) return;
                    const touch = e.touches[0];
                    const target = document.elementFromPoint(touch.clientX, touch.clientY);
                    const cell = target ? target.closest('.timeline-cell') : null;
                    if (cell && cell.parentNode === cellsGrid) {
                        const idx = parseInt(cell.dataset.index);
                        updateCellState(idx);
                    }
                    e.preventDefault();
                }, { passive: false });
                
                cellsGrid.addEventListener('touchend', stopDrawing);
                
                const initialWorkCount = stateArray.filter(s => s === 1).length;
                const initialHours = initialWorkCount * 0.5;
                hoursTotalSpan.textContent = initialHours.toFixed(1);
                hoursInput.value = initialHours.toFixed(1);
                timelineInput.value = stateArray.join('');
                
                row.querySelector('.remove-task-btn').addEventListener('click', () => {
                    window.removeEventListener('mouseup', stopDrawing);
                    row.remove();
                    calculateTotal();
                });
                
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
                        taskList.addTaskRow(t.project, t.detail, t.hours, t.timeline || '');
                    });
                    const reportText = taskList.closest('.day-card').querySelector('.day-report-text');
                    if (reportText) {
                        reportText.value = (sourceReport.dailyReports && sourceReport.dailyReports[day]) ? sourceReport.dailyReports[day] : '';
                    }
                }
            });

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
                    const timeline = row.querySelector('.task-timeline-data').value;
                    if (project || detail || hours || timeline) tasks.push({ project, detail, hours, timeline });
                });
                dailyLogs[day] = tasks;
            });

            const dailyReports = {};
            daysName.forEach(day => {
                const textVal = document.querySelector(`.task-list[data-day="${day}"]`)
                    .closest('.day-card')
                    .querySelector('.day-report-text').value.trim();
                dailyReports[day] = textVal;
            });

            const reportData = {
                week: document.getElementById('week').value,
                author: document.getElementById('author').value,
                dailyLogs,
                dailyReports,
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
            // doc.idも一緒に保存（編集・削除で使用）
            allSchedules = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
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

            // data-idを付与してクリックで編集モーダルを開く
            html += `<div class="gantt-bar" data-id="${s.id}" style="grid-row: ${rowIndex}; grid-column: ${gridStart} / ${gridEnd}; margin: 5px 0; background-color: ${authorColor}; cursor: pointer;" title="クリックして編集">
                        ✏️ ${s.notes || s.project}
                     </div>`;
        });

        if (targetSchedules.length === 0) {
            html += `<div style="grid-column: 1 / -1; padding: 20px; text-align: center;">予定が登録されていません。</div>`;
        }
        html += `</div>`;
        container.innerHTML = html;
        document.getElementById('print-gantt-title').textContent = `${year}年${month}月 作業予定表`;

        // ガントバークリックで編集モーダルを開く
        container.querySelectorAll('.gantt-bar[data-id]').forEach(bar => {
            bar.addEventListener('click', () => {
                const schedId = bar.dataset.id;
                const sched = allSchedules.find(s => s.id === schedId);
                if (sched) openEditModal(sched);
            });
        });
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
        
        // displayName優先、なければメールのID部分で比較
        const myName = currentUser.displayName || currentUser.email.split('@')[0];
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

        const summaryFilterMonth = document.getElementById('summary-filter-month');
        if (summaryFilterMonth) {
            const cur = summaryFilterMonth.value;
            summaryFilterMonth.innerHTML = '<option value="">月を選択してください</option>';
            months.forEach(m => summaryFilterMonth.innerHTML += `<option value="${m}">${m.replace('-', '年')}月</option>`);
            if (cur) {
                summaryFilterMonth.value = cur;
            } else if (months.length > 0) {
                summaryFilterMonth.value = months[0];
            }
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
            const renderCell = (day) => {
                const tasksHtml = (r.dailyLogs && r.dailyLogs[day]) ? r.dailyLogs[day].map(t => `<div class="day-summary-cell"><strong>${t.project}</strong>${t.detail} (${parseFloat(t.hours||0).toFixed(1)}H)</div>`).join('') : '';
                const reportHtml = (r.dailyReports && r.dailyReports[day]) ? `<div class="day-report-summary-cell" style="font-size:0.8rem; color:#0284c7; margin-top:5px; border-top:1px dotted var(--border); padding-top:3px; white-space:pre-wrap; font-style:italic; text-align: left;">📝 ${r.dailyReports[day]}</div>` : '';
                return (tasksHtml || reportHtml) ? (tasksHtml + reportHtml) : '-';
            };

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
                // ts が undefined になる場合に備えてフォールバック
                const ts = (r.dailyLogs && Array.isArray(r.dailyLogs[day])) ? r.dailyLogs[day] : [];
                const dailyRep = (r.dailyReports && r.dailyReports[day]) ? r.dailyReports[day] : '';
                
                if (ts.length > 0) {
                    ts.forEach((t) => {
                        // 行ごとに日付・レポートを繰り返す（rowspanなし・シンプル実装）
                        printTasksHtml += `<tr>
                            <td>${dates ? formatDate(dates[idx]) : ''}(${day})</td>
                            <td>${t.project || ''}</td>
                            <td>${t.detail || ''}</td>
                            <td style="text-align:center;">${parseFloat(t.hours||0).toFixed(1)}H</td>
                            <td style="white-space: pre-wrap; font-size:0.85rem;">${dailyRep}</td>
                        </tr>`;
                    });
                } else if (dailyRep) {
                    // 作業なし・日報のみの日
                    printTasksHtml += `<tr>
                        <td>${dates ? formatDate(dates[idx]) : ''}(${day})</td>
                        <td colspan="3" style="color: #64748b; font-style: italic;">作業記録なし</td>
                        <td style="white-space: pre-wrap; font-size:0.85rem;">${dailyRep}</td>
                    </tr>`;
                }
            });

            printContainer.innerHTML += `
                <div class="print-report-card">
                    <div class="print-report-header">対象期間: ${formatWeekRange(r.week)} ｜ 担当者: ${r.author || ''}</div>
                    <div class="print-report-body">
                        <strong>■ 業務実績（日別詳細）</strong>
                        <table class="print-task-table">
                            <thead><tr><th>日付(曜)</th><th>工事名</th><th>作業内容</th><th>時間</th><th>日次レポート・備考</th></tr></thead>
                            <tbody>${printTasksHtml || '<tr><td colspan="5" style="text-align:center; padding:10px; color:#64748b;">記録なし</td></tr>'}</tbody>
                        </table>
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
        const filterMonth = document.getElementById('summary-filter-month').value;
        const thead = document.getElementById('summary-thead');
        const tbody = document.getElementById('summary-tbody');
        const printTitle = document.getElementById('print-summary-title');
        
        if (!thead || !tbody) return;
        
        if (!filterMonth) {
            thead.innerHTML = '';
            tbody.innerHTML = '<tr><td style="padding: 20px; text-align: center; color: #64748b;">対象月を選択してください。</td></tr>';
            return;
        }

        const [year, month] = filterMonth.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        
        if (printTitle) {
            printTitle.textContent = `${year}年${month}月 工事別作業時間集計`;
        }

        // 1. カレンダーヘッダーの生成
        let headHtml = `<tr>
            <th style="min-width: 150px; background: #f1f5f9; position: sticky; left: 0; z-index: 10;">工事名</th>
            <th style="min-width: 100px; background: #f1f5f9; position: sticky; left: 150px; z-index: 10;">担当者</th>`;
        
        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(year, month - 1, d);
            const dayOfWeekStr = ['日','月','火','水','木','金','土'][dateObj.getDay()];
            const isWeekend = (dateObj.getDay() === 0 || dateObj.getDay() === 6) ? 'color:red;' : '';
            headHtml += `<th style="min-width: 35px; text-align: center; font-size: 0.8rem; ${isWeekend}">${d}<br>${dayOfWeekStr}</th>`;
        }
        headHtml += `<th style="min-width: 80px; text-align: right; background: #f1f5f9;">合計</th></tr>`;
        thead.innerHTML = headHtml;

        // 2. データ集計
        const projectMap = {};
        
        allReports.forEach(r => {
            const days = ['月','火','水','木','金','土','日'];
            const dates = getDaysOfWeek(r.week);
            if (!dates) return;
            
            days.forEach((day, idx) => {
                const dateObj = dates[idx];
                const dYear = dateObj.getFullYear();
                const dMonth = dateObj.getMonth() + 1;
                const dDay = dateObj.getDate();
                
                // 選択された月と一致するかチェック
                if (dYear === year && dMonth === month) {
                    const ts = r.dailyLogs ? r.dailyLogs[day] : [];
                    if (ts) ts.forEach(t => {
                        if (!t.project || !t.hours) return;
                        const proj = t.project;
                        const auth = r.author || '不明';
                        const hrs = parseFloat(t.hours || 0);
                        
                        if (!projectMap[proj]) projectMap[proj] = {};
                        if (!projectMap[proj][auth]) {
                            projectMap[proj][auth] = {
                                days: {},
                                total: 0
                            };
                        }
                        
                        projectMap[proj][auth].days[dDay] = (projectMap[proj][auth].days[dDay] || 0) + hrs;
                        projectMap[proj][auth].total += hrs;
                    });
                }
            });
        });

        // 3. テーブル行の生成
        let bodyHtml = '';
        const sortedProjects = Object.keys(projectMap).sort();
        
        if (sortedProjects.length === 0) {
            bodyHtml = `<tr><td colspan="${daysInMonth + 3}" style="padding: 20px; text-align: center; color: #64748b;">該当する作業記録がありません。</td></tr>`;
            tbody.innerHTML = bodyHtml;
            return;
        }

        sortedProjects.forEach(proj => {
            const authors = Object.keys(projectMap[proj]).sort();
            authors.forEach((auth) => {
                const data = projectMap[proj][auth];
                bodyHtml += `<tr>`;
                
                bodyHtml += `<td style="font-weight: bold; background: #fff; position: sticky; left: 0; z-index: 5; border-right: 1px solid var(--border);">${proj}</td>`;
                bodyHtml += `<td style="background: #fff; position: sticky; left: 150px; z-index: 5; border-right: 1px solid var(--border);">${auth}</td>`;
                
                for (let d = 1; d <= daysInMonth; d++) {
                    const hrs = data.days[d];
                    const displayHrs = hrs ? hrs.toFixed(1) : '';
                    const style = hrs ? 'background-color: #f0fdf4; font-weight: bold; text-align: center;' : 'text-align: center; color: #cbd5e1;';
                    bodyHtml += `<td style="${style}">${hrs ? displayHrs : '-'}</td>`;
                }
                
                bodyHtml += `<td style="text-align: right; font-weight: bold; color: var(--primary); background: #f8fafc;">${data.total.toFixed(1)}H</td>`;
                bodyHtml += `</tr>`;
            });
        });
        
        tbody.innerHTML = bodyHtml;
    };

    ['filter-month', 'filter-author'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', renderTable);
    });
    const summaryFilterMonth = document.getElementById('summary-filter-month');
    if(summaryFilterMonth) summaryFilterMonth.addEventListener('change', renderSummaryTable);

    // 印刷ボタン処理（#print-areaを一時的に作成してから印刷）
    const doPrint = (contentSourceId, titleText, isLandscape = false) => {
        // 既存のprint-areaや動的スタイルを削除
        const existingArea = document.getElementById('print-area');
        if (existingArea) existingArea.remove();
        const existingStyle = document.getElementById('print-dynamic-style');
        if (existingStyle) existingStyle.remove();

        // 印刷コンテンツを取得
        const sourceEl = document.getElementById(contentSourceId);
        if (!sourceEl) { window.print(); return; }

        // 横向き印刷用の@pageスタイルを動的に追加
        const style = document.createElement('style');
        style.id = 'print-dynamic-style';
        if (isLandscape) {
            style.innerHTML = '@media print { @page { size: A3 landscape !important; margin: 10mm !important; } }';
        } else {
            style.innerHTML = '@media print { @page { size: A4 portrait !important; margin: 10mm !important; } }';
        }
        document.head.appendChild(style);

        // #print-areaを作成してbodyに追加
        const printArea = document.createElement('div');
        printArea.id = 'print-area';
        printArea.style.cssText = 'background:white; padding:15px; width: 100%;';

        // タイトルを追加
        if (titleText) {
            const titleEl = document.createElement('h2');
            titleEl.className = 'print-gantt-title';
            titleEl.textContent = titleText;
            printArea.appendChild(titleEl);
        }

        // コンテンツをコピー
        const clone = sourceEl.cloneNode(true);
        clone.style.display = 'block';
        
        // 横向きの場合、テーブルがはみ出ないように幅やフォントサイズを調整し、stickyを解除
        if (isLandscape) {
            clone.style.width = '100%';
            clone.style.fontSize = '8pt';
            // sticky固定が印刷時に崩れる原因となるため、全セルのpositionをstaticに戻す
            clone.querySelectorAll('th, td').forEach(el => {
                el.style.position = 'static';
                el.style.zIndex = 'auto';
            });
        }
        
        printArea.appendChild(clone);
        document.body.appendChild(printArea);

        // 印刷後に削除
        window.print();
        setTimeout(() => {
            printArea.remove();
            const dynStyle = document.getElementById('print-dynamic-style');
            if (dynStyle) dynStyle.remove();
        }, 1000);
    };

    // A4縦印刷（個人別一覧・レポート）
    const btnPrint = document.getElementById('btn-print');
    if (btnPrint) {
        btnPrint.addEventListener('click', () => {
            doPrint('print-details-container', '週次完了レポート（個人別）', false);
        });
    }
    // A3横印刷（工事別集計）
    const btnPrintSummary = document.getElementById('btn-print-summary');
    if (btnPrintSummary) {
        btnPrintSummary.addEventListener('click', () => {
            const filterMonth = document.getElementById('summary-filter-month').value;
            const [year, month] = filterMonth ? filterMonth.split('-') : ['', ''];
            const titleText = year ? `${year}年${month}月 工事別作業時間集計` : '工事別作業時間集計';
            doPrint('summary-table', titleText, true);
        });
    }
    // A3横印刷（ガントチャート）
    const btnPrintGantt = document.getElementById('btn-print-gantt');
    if (btnPrintGantt) {
        btnPrintGantt.addEventListener('click', () => {
            doPrint('gantt-container', document.getElementById('print-gantt-title')?.textContent || '月間作業予定表', true);
        });
    }


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
                    const tasks = (r.dailyLogs && r.dailyLogs[day]) ? r.dailyLogs[day] : [];
                    const dailyRep = (r.dailyReports && r.dailyReports[day]) ? r.dailyReports[day] : '';
                    
                    if (tasks.length > 0) {
                        tasks.forEach(t => {
                            rows.push({
                                "対象期間": formatWeekRange(r.week),
                                "担当者": r.author,
                                "曜日": day,
                                "工事名": t.project,
                                "作業内容": t.detail,
                                "作業時間(H)": t.hours,
                                "日次レポート・備考": dailyRep
                            });
                            
                            if (t.project) {
                                if (!authorProjectHours[r.author]) authorProjectHours[r.author] = {};
                                authorProjectHours[r.author][t.project] = (authorProjectHours[r.author][t.project] || 0) + parseFloat(t.hours || 0);
                            }
                        });
                    } else if (dailyRep) {
                        rows.push({
                            "対象期間": formatWeekRange(r.week),
                            "担当者": r.author,
                            "曜日": day,
                            "工事名": "",
                            "作業内容": "(工事入力なし)",
                            "作業時間(H)": "",
                            "日次レポート・備考": dailyRep
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
            const filterMonth = document.getElementById('summary-filter-month').value;
            if (!filterMonth) return alert('対象月を選択してください。');
            
            const [year, month] = filterMonth.split('-').map(Number);
            const table = document.getElementById('summary-table');
            const wb = XLSX.utils.table_to_book(table, { raw: true });
            XLSX.writeFile(wb, `${year}年${month}月_工事別作業時間集計.xlsx`);
        });
    }
});

// --- ガントチャート予定編集モーダル ---
// openEditModal はDOMContentLoadedの外で定義（クロージャから呼ばれるため）
// db / updateDoc / deleteDoc / doc はモジュールスコープで参照可能
function openEditModal(sched) {
    // 既存モーダルがあれば削除
    const existing = document.getElementById('edit-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'edit-modal-overlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); z-index: 9999;
        display: flex; justify-content: center; align-items: center; padding: 20px;
        box-sizing: border-box;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
        background: white; color: #1e293b;
        border-radius: 12px; padding: 30px; width: 100%; max-width: 500px;
        box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
        box-sizing: border-box;
    `;

    modal.innerHTML = `
        <h3 style="margin-bottom: 20px; font-size: 1.2rem; border-bottom: 2px solid #2563eb; padding-bottom: 10px; color: #1e293b;">
            ✏️ 予定の修正
        </h3>
        <div style="margin-bottom: 15px;">
            <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">工事名 <span style="color:red">*</span></label>
            <input type="text" id="edit-project" value="${(sched.project || '').replace(/"/g, '&quot;')}"
                style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
        </div>
        <div style="margin-bottom: 15px;">
            <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">担当者</label>
            <input type="text" id="edit-author" value="${(sched.author || '').replace(/"/g, '&quot;')}"
                style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
        </div>
        <div style="display:flex; gap:10px; margin-bottom:15px; flex-wrap:wrap;">
            <div style="flex:1; min-width:140px;">
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">開始日 <span style="color:red">*</span></label>
                <input type="date" id="edit-start" value="${sched.start || ''}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
            <div style="flex:1; min-width:140px;">
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">終了日 <span style="color:red">*</span></label>
                <input type="date" id="edit-end" value="${sched.end || ''}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
        </div>
        <div style="margin-bottom: 20px;">
            <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">作業内容・備考</label>
            <textarea id="edit-notes" rows="3"
                style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; resize:vertical; box-sizing:border-box; color:#1e293b;">${sched.notes || ''}</textarea>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button id="edit-save-btn" style="flex:2; min-width:120px; padding:12px; background:#2563eb; color:#fff; border:none; border-radius:6px; font-weight:700; cursor:pointer; font-size:1rem;">
                💾 保存する
            </button>
            <button id="edit-delete-btn" style="flex:1; min-width:80px; padding:12px; background:#ef4444; color:#fff; border:none; border-radius:6px; font-weight:700; cursor:pointer; font-size:1rem;">
                🗑️ 削除
            </button>
            <button id="edit-cancel-btn" style="flex:1; min-width:80px; padding:12px; background:#64748b; color:#fff; border:none; border-radius:6px; font-weight:700; cursor:pointer; font-size:1rem;">
                ✕ キャンセル
            </button>
        </div>
        <div id="edit-modal-msg" style="display:none; margin-top:12px; padding:10px; border-radius:6px; text-align:center; font-weight:bold;"></div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // オーバーレイ背景クリックで閉じる
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    // キャンセルボタン
    document.getElementById('edit-cancel-btn').addEventListener('click', () => overlay.remove());

    // 保存ボタン
    document.getElementById('edit-save-btn').addEventListener('click', async () => {
        const saveBtn = document.getElementById('edit-save-btn');
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';

        const updatedData = {
            project: document.getElementById('edit-project').value.trim(),
            author: document.getElementById('edit-author').value.trim(),
            start: document.getElementById('edit-start').value,
            end: document.getElementById('edit-end').value,
            notes: document.getElementById('edit-notes').value.trim(),
        };

        if (!updatedData.project || !updatedData.start || !updatedData.end) {
            alert('工事名・開始日・終了日は必須です。');
            saveBtn.disabled = false;
            saveBtn.innerHTML = '💾 保存する';
            return;
        }
        if (updatedData.start > updatedData.end) {
            alert('終了日は開始日より後の日付にしてください。');
            saveBtn.disabled = false;
            saveBtn.innerHTML = '💾 保存する';
            return;
        }

        try {
            await updateDoc(doc(db, "schedules", sched.id), updatedData);

            const msg = document.getElementById('edit-modal-msg');
            msg.style.display = 'block';
            msg.style.background = '#dcfce7';
            msg.style.color = '#166534';
            msg.textContent = '✅ 保存しました！';

            setTimeout(() => {
                overlay.remove();
                window.loadSchedules();
            }, 1000);
        } catch (err) {
            console.error(err);
            alert('保存に失敗しました: ' + err.message);
            saveBtn.disabled = false;
            saveBtn.innerHTML = '💾 保存する';
        }
    });

    // 削除ボタン
    document.getElementById('edit-delete-btn').addEventListener('click', async () => {
        if (!confirm(`「${sched.project}」の予定を削除しますか？\nこの操作は取り消せません。`)) return;

        const delBtn = document.getElementById('edit-delete-btn');
        delBtn.disabled = true;
        delBtn.textContent = '削除中...';

        try {
            await deleteDoc(doc(db, "schedules", sched.id));
            overlay.remove();
            window.loadSchedules();
        } catch (err) {
            console.error(err);
            alert('削除に失敗しました: ' + err.message);
            delBtn.disabled = false;
            delBtn.innerHTML = '🗑️ 削除';
        }
    });
}
