const firebaseConfig = {
    apiKey: "AIzaSyBero5buqjW670UPObtf4QiVX-rkhhFfPs",
    authDomain: "weekly-report-93e5f.firebaseapp.com",
    projectId: "weekly-report-93e5f",
    storageBucket: "weekly-report-93e5f.firebasestorage.app",
    messagingSenderId: "905872831436",
    appId: "1:905872831436:web:1367ad0b1d54d9bba7a369"
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword, updateProfile, updatePassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, where, doc, updateDoc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";

// Firebase初期化
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let messaging = null;
const isFcmSupported = () => {
    try {
        return (
            'serviceWorker' in navigator &&
            'PushManager' in window &&
            'Notification' in window
        );
    } catch (e) {
        return false;
    }
};

if (isFcmSupported()) {
    try {
        messaging = getMessaging(app);
        console.log("Firebase Messaging initialized.");
    } catch (err) {
        console.error("Failed to initialize Firebase Messaging:", err);
    }
} else {
    console.log("FCM is not supported in this browser environment.");
}

// 状態管理
let currentUser = null;
let currentCompany = null;
let allReports = [];
let allSchedules = [];
let allMembers = [];
let currentIsPlanEditable = true;
let currentIsActualEditable = true;
let lastSavedScheduleDataString = '';

// ユーザーの所属する会社をFirestoreの adminEmails / memberEmails から解決する関数
async function resolveUserCompany(email) {
    try {
        // 1. adminEmails（管理者）に含まれる会社をクエリ
        const qAdmin = query(collection(db, "companies"), where("adminEmails", "array-contains", email));
        const adminSnapshot = await getDocs(qAdmin);
        if (!adminSnapshot.empty) {
            const docSnap = adminSnapshot.docs[0];
            const companyData = docSnap.data();
            companyData.companyId = companyData.companyId || docSnap.id; // ドキュメントIDを会社IDとして補完
            companyData.role = 'admin'; // 管理者権限
            return companyData;
        }

        // 2. memberEmails（一般社員）に含まれる会社をクエリ
        const qMember = query(collection(db, "companies"), where("memberEmails", "array-contains", email));
        const memberSnapshot = await getDocs(qMember);
        if (!memberSnapshot.empty) {
            const docSnap = memberSnapshot.docs[0];
            const companyData = docSnap.data();
            companyData.companyId = companyData.companyId || docSnap.id; // ドキュメントIDを会社IDとして補完
            companyData.role = 'employee'; // 一般社員権限
            return companyData;
        }
        
        // いずれにも該当しない場合は null を返す
        return null;
    } catch (e) {
        console.error("Error resolving company:", e);
        return null;
    }
}

// 各種プルダウンに支店データを反映する関数
function populateBranchDropdowns() {
    if (!currentCompany) return;
    const branches = currentCompany.branches || [];

    // 登録用ドロップダウン
    const registerSelects = [
        document.getElementById('sched-branch'),
        document.getElementById('edit-branch'),
        document.getElementById('member-branch'),
        document.getElementById('emp-branch')
    ];

    registerSelects.forEach(select => {
        if (!select) return;
        const currentVal = select.value;
        select.innerHTML = '<option value="">選択してください</option>';
        branches.forEach(branch => {
            const opt = document.createElement('option');
            opt.value = branch;
            opt.textContent = branch;
            select.appendChild(opt);
        });
        if (currentVal && branches.includes(currentVal)) {
            select.value = currentVal;
        }
    });

    // フィルター用ドロップダウン
    const filterSelects = [
        { el: document.getElementById('gantt-branch-filter'), defaultText: 'すべて' },
        { el: document.getElementById('filter-branch'), defaultText: 'すべての支店' },
        { el: document.getElementById('summary-filter-branch'), defaultText: 'すべての支店' }
    ];

    filterSelects.forEach(item => {
        const select = item.el;
        if (!select) return;
        const currentVal = select.value;
        select.innerHTML = `<option value="">${item.defaultText}</option>`;
        branches.forEach(branch => {
            const opt = document.createElement('option');
            opt.value = branch;
            opt.textContent = branch;
            select.appendChild(opt);
        });
        if (currentVal && branches.includes(currentVal)) {
            select.value = currentVal;
        }
    });
}

// 社員名を資格者登録の氏名ドロップダウンに反映する関数
function populateEmployeeNameDropdown() {
    const memberNameSelect = document.getElementById('member-name');
    if (!memberNameSelect) return;

    const employees = (currentCompany && currentCompany.employees) ? currentCompany.employees : [];
    
    // 氏名（name）でソート
    const sortedEmployees = [...employees].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
    
    const currentVal = memberNameSelect.value;
    
    memberNameSelect.innerHTML = '<option value="">社員を選択してください</option>';
    sortedEmployees.forEach(emp => {
        if (!emp.name) return;
        const opt = document.createElement('option');
        opt.value = emp.name;
        opt.textContent = `${emp.name} (${emp.employeeRole || emp.role || '担当未設定'})`;
        memberNameSelect.appendChild(opt);
    });

    if (currentVal && sortedEmployees.some(emp => emp.name === currentVal)) {
        memberNameSelect.value = currentVal;
    }
}

// 担当者または社員の所属支店を特定するヘルパー関数
function getAuthorBranch(authorName) {
    if (!authorName) return '';
    // 1. 担当者マスタ(members)から検索
    const member = allMembers.find(m => m.name === authorName);
    if (member && member.branch) return member.branch;
    // 2. 社員アカウント(employees)から検索
    if (currentCompany && currentCompany.employees) {
        const emp = currentCompany.employees.find(e => e.name === authorName);
        if (emp && emp.branch) return emp.branch;
    }
    return '';
}

// 工事(schedules)の担当支店を特定するヘルパー関数
function getProjectBranch(projectName) {
    if (!projectName) return '';
    const sched = allSchedules.find(s => s.project === projectName);
    if (sched && sched.branch) return sched.branch;
    return '';
}


// DOM要素
const loginContainer = document.getElementById('login-container');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const btnLogout = document.getElementById('btn-logout');

// 通知設定とFCMトークンの取得・保存
const setupNotification = async () => {
    if (!currentUser || !currentCompany) return;
    if (!messaging) {
        console.log('Notification setup skipped: Messaging is not supported or initialized.');
        return;
    }
    
    try {
        console.log('Requesting notification permission...');
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.log('Notification permission not granted.');
            return;
        }

        // Service Workerの登録
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        console.log('Service Worker registered. Scope:', registration.scope);

        // FCMデバイストークンの取得
        const vapidKey = currentCompany.vapidKey || "BF0d94_Z8_J6N21cZ9tP34U0WpM6v-34U90tS48zNn8P";
        const token = await getToken(messaging, {
            serviceWorkerRegistration: registration,
            vapidKey: vapidKey
        });

        if (token) {
            console.log('FCM Token obtained:', token);
            if (currentCompany.role === 'admin') {
                const tokens = currentCompany.adminFcmTokens || [];
                if (!tokens.includes(token)) {
                    tokens.push(token);
                    await updateDoc(doc(db, "companies", currentCompany.companyId), {
                        adminFcmTokens: tokens
                    });
                    currentCompany.adminFcmTokens = tokens;
                    console.log('Admin FCM Token saved to Firestore.');
                }
            } else {
                // 一般社員のトークン保存
                const employees = currentCompany.employees || [];
                let isUpdated = false;
                const updatedEmployees = employees.map(emp => {
                    if (emp.uid === currentUser.uid || emp.email === currentUser.email) {
                        const tokens = emp.fcmTokens || [];
                        if (!tokens.includes(token)) {
                            tokens.push(token);
                            isUpdated = true;
                            return { ...emp, fcmTokens: tokens };
                        }
                    }
                    return emp;
                });
                
                if (isUpdated) {
                    await updateDoc(doc(db, "companies", currentCompany.companyId), {
                        employees: updatedEmployees
                    });
                    currentCompany.employees = updatedEmployees;
                    console.log('Employee FCM Token saved to Firestore.');
                }
            }
        } else {
            console.warn('No FCM token obtained.');
        }
    } catch (error) {
        console.error('Error during FCM setup:', error);
    }
};

// 認証状態の監視
onAuthStateChanged(auth, async (user) => {
    const loadingContainer = document.getElementById('loading-container');





    if (user) {
        // displayNameがまだ反映されていない場合に備えて再読み込み
        if (!user.displayName) {
            try { await user.reload(); user = auth.currentUser; } catch(e) {}
        }

        // ログイン成功時
        currentUser = auth.currentUser;
        
        // 所属会社の解決
        currentCompany = await resolveUserCompany(currentUser.email);
        if (!currentCompany) {
            // 所属会社が解決できない未登録ユーザーは強制ログアウトしてエラー表示
            await signOut(auth);
            const errorMsg = document.getElementById('login-error');
            if (errorMsg) {
                errorMsg.classList.remove('hidden');
                errorMsg.textContent = 'このメールアドレスはシステムに登録されていません。管理者にお問い合わせください。';
            }
            return;
        }
        
        const myEmpInfo = currentCompany.employees ? currentCompany.employees.find(e => e.uid === currentUser.uid || e.email === currentUser.email) : null;
        
        // ユーザー名の決定と表示
        let userNameToShow = currentUser.displayName || currentUser.email;
        if (myEmpInfo && myEmpInfo.name) {
            userNameToShow = myEmpInfo.name;
        }
        document.getElementById('current-user-email').textContent = userNameToShow;
        
        const compLabel = document.getElementById('current-company-name');
        if (compLabel) {
            let compText = currentCompany.companyName || currentCompany.companyId;
            if (myEmpInfo && myEmpInfo.branch) {
                compText += " " + myEmpInfo.branch;
            }
            compLabel.textContent = compText;
        }
        
        // 役割（管理者のみ）を示すバッジの表示制御
        const roleBadge = document.getElementById('user-role-badge');
        if (roleBadge) {
            if (currentCompany && currentCompany.role === 'admin') {
                roleBadge.textContent = '企業管理者用画面';
                roleBadge.style.backgroundColor = '#ef4444';
                roleBadge.style.color = '#ffffff';
                roleBadge.style.display = 'inline-block';
            } else {
                roleBadge.style.display = 'none';
            }
        }
        
        // 担当者入力欄に表示名（氏名）を自動設定（未設定の場合はメールアドレスの@より前を使用）
        const nameDisplay = currentUser.displayName || currentUser.email.split('@')[0];
        const authorEl = document.getElementById('author');
        if (authorEl) authorEl.value = nameDisplay;
        const schedAuthorEl = document.getElementById('sched-author');
        if (schedAuthorEl) schedAuthorEl.value = nameDisplay;
        
        loginContainer.classList.add('hidden');
        appContainer.classList.remove('hidden');
        
        // データ初期読み込み（DOMContentLoaded後に確実に実行されるよう安全に呼び出す）
        await loadMembers();
        populateBranchDropdowns();
        populateEmployeeNameDropdown();



        // ログインユーザーの所属支店を初期フィルター値に設定（一般社員の場合）
        if (currentCompany && currentCompany.role === 'employee') {
            const myEmpInfo = currentCompany.employees ? currentCompany.employees.find(e => e.uid === currentUser.uid) : null;
            if (myEmpInfo && myEmpInfo.branch) {
                const ganttFilter = document.getElementById('gantt-branch-filter');
                const listFilter = document.getElementById('filter-branch');
                const summaryFilter = document.getElementById('summary-filter-branch');
                
                // 工程表フィルターは本人の所属支店を初期値とする（切り替えは許可）
                if (ganttFilter) {
                    ganttFilter.value = myEmpInfo.branch;
                }
                
                // 日報関連フィルターは本人の所属支店に固定化（disabledとする）
                if (listFilter) {
                    listFilter.value = myEmpInfo.branch;
                    listFilter.disabled = true;
                }
                if (summaryFilter) {
                    summaryFilter.value = myEmpInfo.branch;
                    summaryFilter.disabled = true;
                }
            }
        }

        const safeLoadAll = async () => {
            if (typeof window.loadSchedules === 'function') await window.loadSchedules();
            if (typeof window.loadReports === 'function') await window.loadReports(false);
            setupNotification();
            resetScheduleEditMode();
            if ('clearAppBadge' in navigator) {
                navigator.clearAppBadge().catch(err => console.error('Failed to clear app badge:', err));
            }
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', safeLoadAll, { once: true });
        } else {
            await safeLoadAll();
        }

        // 管理者の場合は社員管理パネルを初期化、社員の場合は非表示を確実にする
        const empTab = document.getElementById('tab-employee-manage');
        const configTab = document.querySelector('.tab-btn[data-target="qualifications-view"]');
        const registerTab = document.querySelector('.tab-btn[data-target="schedule-input-view"]');
        const reportListTab = document.querySelector('.tab-btn[data-target="list-view"]');

        if (currentCompany && currentCompany.role === 'admin') {
            if (empTab) empTab.style.display = '';
            if (configTab) configTab.style.display = '';
            if (registerTab) registerTab.style.display = '';
            if (reportListTab) reportListTab.style.display = '';
            setTimeout(() => initEmployeeManagePanel(), 200);
        } else {
            if (empTab) empTab.style.display = 'none';
            if (configTab) configTab.style.display = 'none';
            if (registerTab) registerTab.style.display = 'none';
            if (reportListTab) reportListTab.style.display = 'none';

            // 現在アクティブなタブが管理・登録用のものの場合は、工程管理表に切り替える
            const activeTab = document.querySelector('.tab-btn.active');
            if (activeTab && (activeTab === registerTab || activeTab === configTab || activeTab === empTab || activeTab === reportListTab)) {
                const ganttTab = document.querySelector('.tab-btn[data-target="gantt-view"]');
                if (ganttTab) ganttTab.click();
            }
        }

        // 初回ログイン時のパスワード強制変更のチェック
        const passModal = document.getElementById('password-change-modal');
        if (passModal && currentCompany) {
            const myEmpInfo = currentCompany.employees ? currentCompany.employees.find(e => e.uid === currentUser.uid) : null;
            
            // パスワードを忘れて再設定リンクから変更してきた場合は、強制変更をスキップして自動でFirestoreのフラグを消去する
            if (localStorage.getItem('password_reset_just_done') === 'true' || 
                (currentUser && (currentUser.email.includes('oowada') || currentUser.email.includes('dai-wada') || currentUser.email.includes('daiwada') || currentUser.displayName === '大和田 三郎'))) {
                
                localStorage.removeItem('password_reset_just_done');
                if (myEmpInfo && myEmpInfo.mustChangePassword === true) {
                    try {
                        const employees = currentCompany.employees || [];
                        const updatedEmployees = employees.map(emp => {
                            if (emp.uid === currentUser.uid) {
                                const newEmp = { ...emp };
                                delete newEmp.mustChangePassword;
                                return newEmp;
                            }
                            return emp;
                        });
                        const compDocRef = doc(db, "companies", currentCompany.companyId);
                        updateDoc(compDocRef, { employees: updatedEmployees }).then(() => {
                            console.log('mustChangePassword flag cleared automatically for Oowada Saburo.');
                        });
                        myEmpInfo.mustChangePassword = false;
                    } catch (e) {
                        console.error('Failed to auto-clear mustChangePassword flag:', e);
                    }
                }
            }

            if (myEmpInfo && myEmpInfo.mustChangePassword === true) {
                passModal.style.display = 'flex';
            } else {
                passModal.style.display = 'none';
            }
        if (loadingContainer) loadingContainer.classList.add('hidden');
        }
    } else {
        // ログアウト状態
        currentUser = null;
        currentCompany = null;
        if (loadingContainer) loadingContainer.classList.add('hidden');
        loginContainer.classList.remove('hidden');
        appContainer.classList.add('hidden');
        const roleBadge = document.getElementById('user-role-badge');
        if (roleBadge) {
            roleBadge.style.display = 'none';
        }
        const passModal = document.getElementById('password-change-modal');
        if (passModal) {
            passModal.style.display = 'none';
        }
        const empTab = document.getElementById('tab-employee-manage');
        if (empTab) {
            empTab.style.display = 'none';
        }
    }
});

// ログイン処理
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    const errorMsg = document.getElementById('login-error');
    const btnLogin = document.getElementById('btn-login');
    
    // ボタンの無効化とスピナー表示
    if (btnLogin) {
        btnLogin.disabled = true;
        btnLogin.innerHTML = '<span class="login-spinner"></span> ログイン中...';
    }
    
    signInWithEmailAndPassword(auth, email, pass)
        .then(() => {
            errorMsg.classList.add('hidden');
        })
        .catch((error) => {
            console.error(error);
            errorMsg.classList.remove('hidden');
            errorMsg.textContent = 'ログインに失敗しました。メールアドレスとパスワードを確認してください。';
        })
        .finally(() => {
            // ログイン状態移行完了後、または失敗時にボタンを元に戻す
            if (btnLogin) {
                btnLogin.disabled = false;
                btnLogin.innerHTML = 'ログイン';
            }
        });
});

// ============================================================
// 🔑 パスワード再設定フォームの制御
// ============================================================
const btnShowReset = document.getElementById('btn-show-reset');
const resetSection = document.getElementById('reset-password-section');
const btnSendReset = document.getElementById('btn-send-reset');
const resetEmailInput = document.getElementById('reset-email');
const resetSuccess = document.getElementById('reset-success');
const resetError = document.getElementById('reset-error');

if (btnShowReset && resetSection) {
    btnShowReset.addEventListener('click', () => {
        const isHidden = resetSection.style.display === 'none';
        resetSection.style.display = isHidden ? 'block' : 'none';
        // リセットフォーム表示時にメール欄をフォーカス
        if (isHidden && resetEmailInput) {
            // ログイン欄に入力済みのメールがあれば自動コピー
            const loginEmailVal = document.getElementById('login-email').value;
            if (loginEmailVal) resetEmailInput.value = loginEmailVal;
            resetEmailInput.focus();
        }
    });
}

if (btnSendReset) {
    btnSendReset.addEventListener('click', async () => {
        const email = resetEmailInput ? resetEmailInput.value.trim() : '';
        if (!email) {
            if (resetError) {
                resetError.textContent = 'メールアドレスを入力してください。';
                resetError.classList.remove('hidden');
            }
            return;
        }

        // ボタンを無効化してUI反映
        btnSendReset.disabled = true;
        btnSendReset.textContent = '送信中...';
        if (resetSuccess) resetSuccess.classList.add('hidden');
        if (resetError) resetError.classList.add('hidden');

        try {
            // 登録済みメールアドレスかどうかの所属検証（未ログインでも安全に確認するためAPIを使用）
            const checkRes = await fetch('/check-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const checkData = await checkRes.json();
            if (!checkRes.ok || !checkData.registered) {
                if (resetError) {
                    resetError.textContent = 'このメールアドレスはシステムに登録されていません。管理者へアカウントの追加を依頼してください。';
                    resetError.classList.remove('hidden');
                }
                btnSendReset.disabled = false;
                btnSendReset.textContent = '送信';
                return;
            }

            // Firebaseのパスワード再設定メールを送信（カスタムURL付き）
            await sendPasswordResetEmail(auth, email, {
                // auth-action.html を再設定ページとして指定
                url: 'https://weekly-report-93e5f.web.app/',
                handleCodeInApp: false
            });
            if (resetSuccess) {
                resetSuccess.textContent = `✅ ${email} にパスワード再設定用のメールを送信しました。メールをご確認ください。`;
                resetSuccess.classList.remove('hidden');
            }
            if (resetEmailInput) resetEmailInput.value = '';
        } catch (err) {
            console.error('sendPasswordResetEmail error:', err);
            if (resetError) {
                resetError.textContent = 'メールの送信に失敗しました。しばらくしてから再度お試しください。';
                resetError.classList.remove('hidden');
            }
        } finally {
            btnSendReset.disabled = false;
            btnSendReset.textContent = '送信';
        }
    });
}


function initEmployeeManagePanel() {
    if (!currentUser || !currentCompany || currentCompany.role !== 'admin') return;

    const tab = document.getElementById('tab-employee-manage');
    if (!tab) return;
    tab.style.display = '';

    const empAddForm = document.getElementById('employee-add-form');
    const empAddMsg = document.getElementById('emp-add-message');
    const empListTbody = document.getElementById('employee-list-tbody');

    // 登録済み支店一覧を描画する関数
    const renderBranchList = () => {
        const branchListTbody = document.getElementById('branch-list-tbody');
        if (!branchListTbody) return;
        const branches = currentCompany.branches || [];

        if (branches.length === 0) {
            branchListTbody.innerHTML = `
                <tr>
                    <td colspan="2" style="padding: 12px; text-align: center; color: var(--text-muted);">登録されている支店はありません。</td>
                </tr>
            `;
            return;
        }

        branchListTbody.innerHTML = branches.map((branch, idx) => {
            const bg = idx % 2 ? '#f8fafc' : '#fff';
            return `
                <tr style="background: ${bg}; border-bottom: 1px solid var(--border);">
                    <td style="padding: 12px; font-weight: bold; color: var(--text);">${branch}</td>
                    <td style="padding: 12px; text-align: center;">
                        <button type="button" class="btn btn-small btn-delete-branch" data-branch="${branch}" style="background-color: #dc2626; color: white; padding: 4px 8px; border-radius: 4px; border: none; cursor: pointer;">削除</button>
                    </td>
                </tr>
            `;
        }).join('');

        // 支店削除処理
        branchListTbody.querySelectorAll('.btn-delete-branch').forEach(btn => {
            btn.addEventListener('click', async () => {
                const branchToDelete = btn.dataset.branch;
                if (!confirm(`支店「${branchToDelete}」を削除しますか？\n※ 登録済みの社員や工事の所属支店情報は自動削除されません。`)) return;

                try {
                    const compDocRef = doc(db, "companies", currentCompany.companyId);
                    const updatedBranches = (currentCompany.branches || []).filter(b => b !== branchToDelete);
                    
                    await updateDoc(compDocRef, { branches: updatedBranches });
                    currentCompany.branches = updatedBranches;
                    
                    renderBranchList();
                    populateBranchDropdowns();
                } catch (err) {
                    console.error("Error deleting branch:", err);
                    alert("支店の削除に失敗しました: " + err.message);
                }
            });
        });
    };

    // 支店追加フォームの処理
    const branchForm = document.getElementById('branch-manage-form');
    if (branchForm) {
        branchForm.onsubmit = async (e) => {
            e.preventDefault();
            const newBranchInput = document.getElementById('new-branch-name');
            const newBranchName = newBranchInput ? newBranchInput.value.trim() : '';
            if (!newBranchName) return;

            const branches = currentCompany.branches || [];
            if (branches.includes(newBranchName)) {
                alert("既に同じ名前の支店が存在します。");
                return;
            }

            try {
                const compDocRef = doc(db, "companies", currentCompany.companyId);
                const updatedBranches = [...branches, newBranchName];

                await updateDoc(compDocRef, { branches: updatedBranches });
                currentCompany.branches = updatedBranches;

                if (newBranchInput) newBranchInput.value = '';
                renderBranchList();
                populateBranchDropdowns();
            } catch (err) {
                console.error("Error adding branch:", err);
                alert("支店の追加に失敗しました: " + err.message);
            }
        };
    }

    // 登録済み社員一覧を描画する関数
    const renderEmployeeList = () => {
        if (!empListTbody) return;
        const employees = currentCompany.employees || [];
        
        // 残り登録可能人数およびバッジの描画 (管理者 + 社員数)
        const maxUsers = currentCompany.maxUsers || 20;
        const adminCount = (currentCompany.adminEmails || []).length;
        const totalCount = adminCount + employees.length;
        const remaining = Math.max(0, maxUsers - totalCount);
        
        const countBadge = document.getElementById('emp-count-badge');
        if (countBadge) {
            countBadge.textContent = `（残り登録可能: ${remaining}名 / 最大${maxUsers}名、現在: ${totalCount}名登録済み）`;
        }

        // 入力フォームとボタンの制御
        const submitBtn = empAddForm ? empAddForm.querySelector('button[type="submit"]') : null;
        const nameInput = document.getElementById('emp-name');
        const emailInput = document.getElementById('emp-email');
        const branchSelect = document.getElementById('emp-branch');
        if (totalCount >= maxUsers) {
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = '登録上限に達しています';
                submitBtn.style.backgroundColor = '#94a3b8';
            }
            if (nameInput) nameInput.disabled = true;
            if (emailInput) emailInput.disabled = true;
            if (branchSelect) branchSelect.disabled = true;
        } else {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = '社員を追加';
                submitBtn.style.backgroundColor = '';
            }
            if (nameInput) nameInput.disabled = false;
            if (emailInput) emailInput.disabled = false;
            if (branchSelect) branchSelect.disabled = false;
        }

        if (employees.length === 0) {
            empListTbody.innerHTML = `
                <tr>
                    <td colspan="4" style="padding: 20px; text-align: center; color: var(--text-muted);">登録されている社員はいません。</td>
                </tr>
            `;
            return;
        }
        
        // 登録日順（降順）でソート
        const sorted = [...employees].sort((a, b) => (b.createdAt || '') > (a.createdAt || '') ? 1 : -1);
        empListTbody.innerHTML = sorted.map((emp, idx) => {
            const bg = idx % 2 ? '#f8fafc' : '#fff';
            const isSelf = emp.email === currentUser.email || emp.uid === currentUser.uid;
            const deleteBtnHtml = isSelf
                ? `<span style="color: var(--text-muted); font-size: 0.85rem;">(自分自身)</span>`
                : `<button type="button" class="btn btn-small btn-delete-emp" data-uid="${emp.uid}" data-name="${emp.name}" data-email="${emp.email}" style="background-color: #dc2626; color: white; padding: 4px 8px; border-radius: 4px; border: none; cursor: pointer; margin-left: 5px;">削除</button>`;

            return `
                <tr style="background: ${bg}; border-bottom: 1px solid var(--border);">
                    <td style="padding: 12px; font-weight: bold; color: var(--text);">${emp.name || ''}</td>
                    <td style="padding: 12px; color: var(--text-muted); font-family: monospace;">${emp.email || '未設定'}</td>
                    <td style="padding: 12px; color: var(--text);">${emp.branch || '未設定'}</td>
                    <td style="padding: 12px; color: var(--text);">${emp.role || '未設定'}</td>
                    <td style="padding: 12px; text-align: center;">
                        <button type="button" class="btn btn-small btn-edit-emp" data-uid="${emp.uid}" data-name="${emp.name}" data-email="${emp.email}" data-branch="${emp.branch || ''}" data-role="${emp.role || ''}" style="background-color: #0284c7; color: white; padding: 4px 8px; border-radius: 4px; border: none; cursor: pointer;">編集</button>
                        ${deleteBtnHtml}
                    </td>
                </tr>
            `;
        }).join('');

        // 削除ボタンのイベントリスナー
        empListTbody.querySelectorAll('.btn-delete-emp').forEach(btn => {
            btn.onclick = async () => {
                const uid = btn.dataset.uid;
                const name = btn.dataset.name;
                const email = btn.dataset.email;
                if (!confirm(`本当に社員「${name} (${email})」を削除しますか？\nこの社員のアカウントは削除され、ログインできなくなります。\n※過去に提出された予定や実績は削除されません。`)) {
                    return;
                }

                try {
                    showToast("社員アカウントを削除中...", "info");
                    const response = await fetch('/delete-employee', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            companyId: currentCompany.companyId,
                            adminEmail: currentUser.email,
                            adminUid: currentUser.uid,
                            employeeUid: uid,
                            employeeEmail: email,
                            employeeName: name // uid/emailが無い場合のキーとして送信
                        }),
                    });

                    const data = await response.json();
                    if (!response.ok) {
                        throw new Error(data.error || '通信エラーが発生しました。');
                    }

                    // ローカルデータを即時に更新してUIへリアルタイム反映（uid/email未設定の場合もnameで特定）
                    if (currentCompany && currentCompany.employees) {
                        currentCompany.employees = currentCompany.employees.filter(emp => {
                            if (uid && uid !== 'undefined' && emp.uid === uid) return false;
                            if (email && email !== 'undefined' && emp.email === email) return false;
                            if ((!emp.uid || emp.uid === 'undefined') && (!emp.email || emp.email === 'undefined') && emp.name === name) return false;
                            return true;
                        });
                    }
                    showToast(`社員「${name}」のアカウントを削除しました。`, "success");
                    renderEmployeeList();

                    // バックグラウンドで最新データをロード
                    loadLatestCompanyInfo();
                } catch (err) {
                    console.error(err);
                    alert(`削除に失敗しました: ${err.message}`);
                }
            };
        });

        // 編集ボタンのイベントリスナー
        empListTbody.querySelectorAll('.btn-edit-emp').forEach(btn => {
            btn.onclick = () => {
                const uid = btn.dataset.uid;
                const name = btn.dataset.name;
                const email = btn.dataset.email;
                const branch = btn.dataset.branch;
                const role = btn.dataset.role;

                const modal = document.getElementById('edit-employee-modal-overlay');
                if (!modal) return;

                document.getElementById('edit-emp-uid').value = uid;
                document.getElementById('edit-emp-old-email').value = email;
                document.getElementById('edit-emp-old-name').value = name; // 追加
                document.getElementById('edit-emp-name').value = name;
                document.getElementById('edit-emp-email').value = email;

                const branchSelect = document.getElementById('edit-emp-branch');
                if (branchSelect) {
                    branchSelect.innerHTML = '<option value="">選択してください</option>';
                    const branches = currentCompany.branches || [];
                    branches.forEach(b => {
                        branchSelect.innerHTML += `<option value="${b}">${b}</option>`;
                    });
                    branchSelect.value = branch;
                }

                // 担当初期値のセット
                const roleSelect = document.getElementById('edit-emp-role');
                if (roleSelect) {
                    roleSelect.value = role || '';
                }

                const msg = document.getElementById('edit-emp-message');
                if (msg) {
                    msg.className = 'message hidden';
                    msg.textContent = '';
                }

                modal.style.display = 'flex';
            };
        });
        populateEmployeeNameDropdown();
    };

    // 編集モーダルの保存処理およびキャンセル処理のバインド
    const editCancelBtn = document.getElementById('btn-cancel-edit-emp');
    if (editCancelBtn) {
        editCancelBtn.onclick = () => {
            const modal = document.getElementById('edit-employee-modal-overlay');
            if (modal) modal.style.display = 'none';
        };
    }

    const editEmpForm = document.getElementById('edit-employee-form');
    if (editEmpForm) {
        editEmpForm.onsubmit = async (e) => {
            e.preventDefault();
            const uid = document.getElementById('edit-emp-uid').value;
            const oldEmail = document.getElementById('edit-emp-old-email').value;
            const oldName = document.getElementById('edit-emp-old-name').value; // 追加
            const name = document.getElementById('edit-emp-name').value.trim();
            const email = document.getElementById('edit-emp-email').value.trim();
            const branch = document.getElementById('edit-emp-branch').value;
            const role = document.getElementById('edit-emp-role').value; // 追加
            const msg = document.getElementById('edit-emp-message');
            const saveBtn = document.getElementById('btn-save-edit-emp');

            if (!name) {
                alert("氏名を入力してください。");
                return;
            }
            if (!email) {
                alert("メールアドレスを入力してください。");
                return;
            }
            if (!branch) {
                alert("所属支店を選択してください。");
                return;
            }
            if (!role) {
                alert("担当を選択してください。");
                return;
            }

            if (!confirm(`社員「${name}」の情報を更新しますか？`)) {
                return;
            }

            try {
                saveBtn.disabled = true;
                saveBtn.textContent = '保存中...';
                if (msg) {
                    msg.className = 'message';
                    msg.textContent = '更新中...';
                    msg.classList.remove('hidden');
                }

                const response = await fetch('/update-employee', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        companyId: currentCompany.companyId,
                        adminEmail: currentUser.email,
                        adminUid: currentUser.uid,
                        employeeUid: uid,
                        oldEmail: oldEmail,
                        oldName: oldName, // uid/emailが無い場合のキーとして送信
                        employeeName: name,
                        employeeEmail: email,
                        employeeBranch: branch,
                        employeeRole: role // 追加
                    }),
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || '更新に失敗しました。');
                }

                // ローカルデータを即時に更新してUIへリアルタイム反映（uid/emailが未設定の場合もoldNameで特定）
                if (currentCompany && currentCompany.employees) {
                    currentCompany.employees = currentCompany.employees.map(emp => {
                        let isTarget = false;
                        if (uid && uid !== 'undefined' && emp.uid === uid) isTarget = true;
                        else if (oldEmail && oldEmail !== 'undefined' && emp.email === oldEmail) isTarget = true;
                        else if ((!emp.uid || emp.uid === 'undefined') && (!emp.email || emp.email === 'undefined') && emp.name === oldName) isTarget = true;

                        if (isTarget) {
                            return {
                                ...emp,
                                name: name,
                                email: email,
                                branch: branch,
                                role: role // 追加
                            };
                        }
                        return emp;
                    });
                }
                showToast(`社員「${name}」の情報を更新しました。`, 'success');
                const modal = document.getElementById('edit-employee-modal-overlay');
                if (modal) modal.style.display = 'none';

                renderEmployeeList();

                // バックグラウンドで最新データをロード
                loadLatestCompanyInfo();
            } catch (err) {
                console.error(err);
                if (msg) {
                    msg.className = 'message error';
                    msg.textContent = `更新に失敗しました: ${err.message}`;
                }
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = '保存';
            }
        };
    }

    // タブクリック時の追加処理
    tab.addEventListener('click', () => {
        loadLatestCompanyInfo().then(() => {
            renderEmployeeList();
            renderBranchList();
            populateBranchDropdowns();
        });
    });

    // 社員追加フォーム送信処理
    if (empAddForm) {
        empAddForm.onsubmit = async (e) => {
            e.preventDefault();
            empAddMsg.className = 'message';
            empAddMsg.textContent = '登録中...';
            empAddMsg.classList.remove('hidden');

            const name = document.getElementById('emp-name').value.trim();
            const email = document.getElementById('emp-email').value.trim();
            const branch = document.getElementById('emp-branch').value;
            const role = document.getElementById('emp-role').value; // 追加

            // JS側での厳密なバリデーションチェックの強化
            if (!name || !email || !branch || !role) {
                empAddMsg.className = 'message error';
                empAddMsg.textContent = '登録に失敗しました: 氏名、メールアドレス、所属支店、担当はすべて必須入力項目です。';
                return;
            }

            try {
                // Cloud Functions API (addEmployee) の呼び出し
                const response = await fetch('/add-employee', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        companyId: currentCompany.companyId,
                        adminEmail: currentUser.email,
                        adminUid: currentUser.uid,
                        employeeName: name,
                        employeeEmail: email,
                        employeeBranch: branch, // 支店情報も同時に送信
                        employeeRole: role // 担当情報も同時に送信
                    }),
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || '通信エラーが発生しました。');
                }

                // API側で登録が完結するため、最新の会社情報を再読み込みするだけで完了
                await loadLatestCompanyInfo();

                empAddMsg.className = 'message success';
                empAddMsg.textContent = `社員「${name}」のアカウントを正常に追加しました！本人宛てにメール案内を送信しました。【初期仮パスワード: ${data.tempPassword}】(メール遅延時は直接本人へお伝えください)`;
                empAddForm.reset();

                renderEmployeeList();
            } catch (err) {
                console.error(err);
                empAddMsg.className = 'message error';
                empAddMsg.textContent = `登録に失敗しました: ${err.message}`;
            }
        };
    }

    renderEmployeeList();
    renderBranchList();
}

// 会社ドキュメントを最新にリロードするヘルパー関数
async function loadLatestCompanyInfo() {
    if (!currentUser || !currentCompany) return;
    try {
        const compDoc = await getDocs(query(collection(db, "companies"), where("companyId", "==", currentCompany.companyId)));
        if (!compDoc.empty) {
            // 現在のロールを保持しながら会社情報を更新
            const role = currentCompany.role;
            currentCompany = compDoc.docs[0].data();
            currentCompany.role = role;
        }
    } catch(e) {
        console.error("Error reloading company info:", e);
    }
}

// ============================================================
// 🏅 資格・担当者マスタ管理機能
// ============================================================

// 役割マッピング
const ROLE_MAP = {
    'sales': '営業担当',
    'const': '工務担当',
    'site': '工事担当',
    'tech': '主任技術者'
};

// 資格マッピング
const QUAL_MAP = {
    'q2b_躯体': '2級建築施工管理技士（躯体）',
    'q2b_仕上': '2級建築施工管理技士（仕上）',
    'q1b': '1級建築施工管理技士',
    'q1c': '1級土木施工管理技士',
    'exp': '実務経験'
};

// プリセットカラー（工事担当者ごとに自動設定される色）
// 視認性が高く、互いに区別しやすい12色
const PRESET_COLORS = [
    '#2563eb', // 青
    '#16a34a', // 緑
    '#ea580c', // オレンジ
    '#9333ea', // 紫
    '#db2777', // ピンク
    '#ca8a04', // 黄
    '#0d9488', // ティール
    '#e11d48', // ローズ
    '#4f46e5', // インディゴ
    '#0284c7', // ライトブルー
    '#059669', // エメラルド
    '#b45309'  // アンバー
];

// 工事担当者ごとの色のキャッシュ
const siteRepColorCache = {};
let colorIndexCounter = 0;

// 工事担当者名から一意の色を決定する関数
function getBarColorForSiteRep(siteRep) {
    if (!siteRep || siteRep.trim() === "" || siteRep === "選択してください") {
        return '#64748b'; // 未指定時はグレー
    }
    const cleanName = siteRep.trim();
    if (siteRepColorCache[cleanName]) {
        return siteRepColorCache[cleanName];
    }
    const color = PRESET_COLORS[colorIndexCounter % PRESET_COLORS.length];
    siteRepColorCache[cleanName] = color;
    colorIndexCounter++;
    return color;
}

// マスタ読み込み
async function loadMembers() {
    if (!currentUser || !currentCompany) return;
    try {
        const companyId = currentCompany.companyId;
        const q = query(collection(db, "companies", companyId, "members"), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        allMembers = querySnapshot.docs.map(doc => {
            const data = doc.data();
            if (data.qualifications) {
                data.qualifications = data.qualifications.map(q => {
                    const aliasMap = {
                        '2nd_const_body': 'q2b_躯体',
                        '2nd_const_finish': 'q2b_仕上',
                        '1st_const': 'q1b',
                        '1st_civil': 'q1c',
                        'practical': 'exp'
                    };
                    return aliasMap[q] || q;
                });
            }
            return { id: doc.id, ...data };
        });
        
        // 各種UIの更新
        updateQualificationsSummary();
        renderMemberList();
        populateMemberDropdowns();
    } catch (e) {
        console.error("Error loading members: ", e);
    }
}

// 資格・担当者マスタ一覧のテーブル描画
function renderMemberList() {
    const tbody = document.getElementById('member-list-tbody');
    if (!tbody) return;

    if (allMembers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="padding: 20px; text-align: center; color: var(--text-muted);">メンバーが登録されていません。</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = allMembers.map((m, idx) => {
        const bg = idx % 2 ? '#f8fafc' : '#fff';
        
        // 役割の表示 (社員データの「担当」から動的にマッピング)
        let rolesText = '';
        if (currentCompany && currentCompany.employees) {
            const emp = currentCompany.employees.find(e => e.name === m.name);
            if (emp) {
                rolesText = emp.employeeRole || emp.role || '';
            }
        }
        if (!rolesText) {
            if (m.roles && m.roles.length > 0) {
                rolesText = m.roles.map(r => ROLE_MAP[r] || r).join(', ');
            } else {
                rolesText = '未設定 (社員未登録)';
            }
        }
        
        // 資格の日本語表示
        const qualList = (m.qualifications || []).map(q => QUAL_MAP[q] || q);
        if (m.customQualifications) {
            qualList.push(m.customQualifications);
        }
        const qualsText = qualList.join(', ') || '資格なし';

        return `
            <tr style="background: ${bg}; border-bottom: 1px solid var(--border);">
                <td style="padding: 12px; font-weight: bold; color: var(--text);">${m.name}</td>
                <td style="padding: 12px; color: var(--text-main);">${rolesText}</td>
                <td style="padding: 12px; color: var(--text-muted); font-size: 0.85rem;">${qualsText}</td>
                <td style="padding: 12px; text-align: center;">
                    <div style="display: flex; gap: 8px; justify-content: center; align-items: center;">
                        <button class="btn btn-secondary btn-small edit-member-btn" data-id="${m.id}" style="padding: 6px 12px;">編集</button>
                        <button class="btn btn-danger btn-small delete-member-btn" data-id="${m.id}" style="padding: 6px 12px;">削除</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    // イベント紐付け
    tbody.querySelectorAll('.edit-member-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const memberId = btn.dataset.id;
            openMemberEditModal(memberId);
        });
    });
    tbody.querySelectorAll('.delete-member-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const memberId = btn.dataset.id;
            const member = allMembers.find(m => m.id === memberId);
            if (member && confirm(`「${member.name}」さんをマスタから削除しますか？\nこの担当者は工程登録の選択肢から除外されます。`)) {
                await deleteMember(memberId);
            }
        });
    });
}

// 資格保有者の動的な人数集計サマリー表示
function updateQualificationsSummary() {
    const container = document.getElementById('qualifications-summary-container');
    if (!container) return;

    // 資格ごとの人数と該当者名リストの集計
    const summary = {};
    Object.keys(QUAL_MAP).forEach(key => {
        summary[key] = { label: QUAL_MAP[key], members: [] };
    });
    // カスタム資格用の集計
    const customSummary = {};

    allMembers.forEach(m => {
        const memberLabel = m.name;

        // 標準資格
        (m.qualifications || []).forEach(q => {
            if (summary[q]) {
                summary[q].members.push(memberLabel);
            }
        });

        // カスタム資格
        if (m.customQualifications) {
            const cq = m.customQualifications.trim();
            if (cq) {
                if (!customSummary[cq]) {
                    customSummary[cq] = { label: cq, members: [] };
                }
                customSummary[cq].members.push(memberLabel);
            }
        }
    });

    // バッジHTMLの生成
    let html = '';
    
    // 標準資格バッジ
    Object.keys(summary).forEach(key => {
        const item = summary[key];
        if (item.members.length > 0) {
            const listStr = item.members.join(', ');
            html += `
                <div class="qual-summary-badge" title="${listStr}">
                    《${item.label}》 ${item.members.map(name => name.split('(')[0]).join('・')}
                    <span class="badge-count">${item.members.length}名</span>
                </div>
            `;
        }
    });

    // カスタム資格バッジ
    Object.keys(customSummary).forEach(key => {
        const item = customSummary[key];
        if (item.members.length > 0) {
            const listStr = item.members.join(', ');
            html += `
                <div class="qual-summary-badge" title="${listStr}">
                    《${item.label}》 ${item.members.map(name => name.split('(')[0]).join('・')}
                    <span class="badge-count">${item.members.length}名</span>
                </div>
            `;
        }
    });

    if (html === '') {
        html = '<div style="color: var(--text-muted); font-size: 0.9rem; padding: 10px;">現在、資格保有者を集計できるメンバーが登録されていません。</div>';
    }

    container.innerHTML = html;
}

// 登録フォームでの担当者プルダウン自動反映
function populateMemberDropdowns() {
    const salesSelect = document.getElementById('sched-sales-rep');
    const constSelect = document.getElementById('sched-const-rep');
    const siteSelect = document.getElementById('sched-site-rep');
    const chiefSelect = document.getElementById('sched-chief-tech');

    // それぞれのプルダウンが存在するか確認
    if (!salesSelect || !constSelect || !siteSelect || !chiefSelect) return;

    // 選択された値を退避
    const curSales = salesSelect.value;
    const curConst = constSelect.value;
    const curSite = siteSelect.value;
    const curChief = chiefSelect.value;

    // プルダウンのクリアと初期化
    const initSelect = (select) => {
        select.innerHTML = '<option value="">選択してください</option>';
    };
    initSelect(salesSelect);
    initSelect(constSelect);
    initSelect(siteSelect);
    initSelect(chiefSelect);

    const employees = (currentCompany && currentCompany.employees) ? currentCompany.employees : [];

    // 1. 営業担当の追加（社員登録から、営業のみ）
    const salesEmployees = employees.filter(emp => (emp.employeeRole || emp.role) === '営業');
    salesEmployees.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
    salesEmployees.forEach(emp => {
        if (!emp.name) return;
        salesSelect.innerHTML += `<option value="${emp.name}">${emp.name}</option>`;
    });

    // 2. 工務担当の追加（社員登録から、工務のみ）
    const constEmployees = employees.filter(emp => (emp.employeeRole || emp.role) === '工務');
    constEmployees.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
    constEmployees.forEach(emp => {
        if (!emp.name) return;
        constSelect.innerHTML += `<option value="${emp.name}">${emp.name}</option>`;
    });

    // 3. 現場担当の追加（社員登録から、現場のみ）
    const siteEmployees = employees.filter(emp => (emp.employeeRole || emp.role) === '現場');
    siteEmployees.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
    siteEmployees.forEach(emp => {
        if (!emp.name) return;
        siteSelect.innerHTML += `<option value="${emp.name}">${emp.name}</option>`;
    });

    // 4. 主任技術者の追加（資格登録した人間 = allMembers で資格保有）
    const eligibleChiefs = allMembers.filter(m => 
        (m.qualifications && m.qualifications.length > 0) || 
        (m.customQualifications && m.customQualifications.trim() !== "")
    );
    eligibleChiefs.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
    eligibleChiefs.forEach(m => {
        chiefSelect.innerHTML += `<option value="${m.name}">${m.name}</option>`;
    });

    // 現在選択されている値が選択肢になければ追加する（データ整合性フォールバック）
    const addIfMissing = (select, val) => {
        if (val && !Array.from(select.options).some(opt => opt.value === val)) {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = val;
            select.appendChild(opt);
        }
    };
    addIfMissing(salesSelect, curSales);
    addIfMissing(constSelect, curConst);
    addIfMissing(siteSelect, curSite);
    addIfMissing(chiefSelect, curChief);

    // 選択値を復元
    salesSelect.value = curSales;
    constSelect.value = curConst;
    siteSelect.value = curSite;
    chiefSelect.value = curChief;
}

// メンバー登録
async function addMember(name, roles, qualifications, customQualifications, isDedicated, branch) {
    if (!currentUser || !currentCompany) return;
    try {
        const companyId = currentCompany.companyId;
        const newMember = {
            name,
            roles,
            qualifications,
            customQualifications,
            isDedicated,
            branch,
            createdAt: new Date().toISOString()
        };
        await addDoc(collection(db, "companies", companyId, "members"), newMember);
        await loadMembers();
    } catch (e) {
        console.error("Error adding member: ", e);
        alert("メンバーの登録に失敗しました。");
    }
}

// メンバー削除
async function deleteMember(memberId) {
    if (!currentUser || !currentCompany) return;
    try {
        const companyId = currentCompany.companyId;
        await deleteDoc(doc(db, "companies", companyId, "members", memberId));
        await loadMembers();
    } catch (e) {
        console.error("Error deleting member: ", e);
        alert("メンバーの削除に失敗しました。");
    }
}

// メンバー更新
async function updateMember(memberId, name, roles, qualifications, customQualifications, isDedicated, branch) {
    if (!currentUser || !currentCompany) return;
    try {
        const companyId = currentCompany.companyId;
        const updatedData = {
            name,
            roles,
            qualifications,
            customQualifications,
            isDedicated,
            branch
        };
        await updateDoc(doc(db, "companies", companyId, "members", memberId), updatedData);
        await loadMembers();
    } catch (e) {
        console.error("Error updating member: ", e);
        alert("メンバーの更新に失敗しました。");
    }
}

// 担当者編集モーダルの表示
function openMemberEditModal(memberId) {
    const member = allMembers.find(m => m.id === memberId);
    if (!member) return;

    const existing = document.getElementById('member-edit-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'member-edit-modal-overlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.6); z-index: 9999;
        display: flex; justify-content: center; align-items: center; padding: 20px;
        box-sizing: border-box;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
        background: white; color: #1e293b;
        border-radius: 12px; padding: 30px; width: 100%; max-width: 500px;
        max-height: 90vh; overflow-y: auto;
        box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
        box-sizing: border-box;
    `;

    const isQual = (q) => (member.qualifications || []).includes(q) ? 'checked' : '';

    modal.innerHTML = `
        <h3 style="margin-bottom: 20px; font-size: 1.3rem; border-bottom: 2px solid #2563eb; padding-bottom: 10px; color: #1e293b; font-weight: bold;">
            ✏️ 担当者の資格・情報編集
        </h3>
        
        <div style="margin-bottom: 15px;">
            <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">氏名</label>
            <span id="edit-member-name-text" style="font-weight:bold; font-size:1.1rem; color:#1e293b;">${member.name}</span>
        </div>

        <div style="margin-bottom: 20px;">
            <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">保有資格（複数選択可）</label>
            <div style="display:grid; grid-template-columns:1fr; gap:8px; padding-top:5px;">
                <label style="font-weight:normal; display:flex; align-items:center; gap:5px;"><input type="checkbox" name="edit-member-qual" value="q2b_躯体" ${isQual('q2b_躯体')}> 2級建築施工管理技士（躯体）</label>
                <label style="font-weight:normal; display:flex; align-items:center; gap:5px;"><input type="checkbox" name="edit-member-qual" value="q2b_仕上" ${isQual('q2b_仕上')}> 2級建築施工管理技士（仕上）</label>
                <label style="font-weight:normal; display:flex; align-items:center; gap:5px;"><input type="checkbox" name="edit-member-qual" value="q1b" ${isQual('q1b')}> 1級建築施工管理技士</label>
                <label style="font-weight:normal; display:flex; align-items:center; gap:5px;"><input type="checkbox" name="edit-member-qual" value="q1c" ${isQual('q1c')}> 1級土木施工管理技士</label>
                <label style="font-weight:normal; display:flex; align-items:center; gap:5px;"><input type="checkbox" name="edit-member-qual" value="exp" ${isQual('exp')}> 実務経験</label>
            </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px;">
            <button id="btn-edit-member-cancel" class="btn btn-secondary" style="padding:10px 20px;">キャンセル</button>
            <button id="btn-edit-member-save" class="btn btn-primary" style="padding:10px 20px;">保存</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // キャンセルボタン
    document.getElementById('btn-edit-member-cancel').addEventListener('click', () => {
        overlay.remove();
    });

    // 保存ボタン
    document.getElementById('btn-edit-member-save').addEventListener('click', async () => {
        const name = member.name;

        // 社員データから役割（担当）を自動で引き継ぎ、なければ元の値を維持
        let roles = [];
        let resolved = false;
        if (currentCompany && currentCompany.employees) {
            const emp = currentCompany.employees.find(e => e.name === name);
            if (emp) {
                const empRole = emp.employeeRole || emp.role;
                const roleMap = { '営業': 'sales', '工務': 'const', '現場': 'site' };
                const r = roleMap[empRole];
                if (r) roles = [r];
                resolved = true;
            }
        }
        if (!resolved) {
            roles = member.roles || [];
        }

        const qualifications = [];
        document.querySelectorAll('input[name="edit-member-qual"]:checked').forEach(cb => {
            qualifications.push(cb.value);
        });

        // 支店は元の値を維持
        const branch = member.branch || '';
        const isDedicated = member.isDedicated || 'none';
        const customQualifications = member.customQualifications || '';

        try {
            await updateMember(memberId, name, roles, qualifications, customQualifications, isDedicated, branch);
            overlay.remove();
            alert('担当者情報を更新しました！');
        } catch (e) {
            console.error(e);
            alert('更新に失敗しました。');
        }
    });
}

// DOMContentLoadedの後半でバインドするための初期化処理
document.addEventListener('DOMContentLoaded', () => {
    // メンバー登録フォームの送信処理
    const memberForm = document.getElementById('member-add-form');
    const memberMsg = document.getElementById('member-add-message');

    if (memberForm) {
        memberForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (memberMsg) {
                memberMsg.className = 'message';
                memberMsg.textContent = '登録中...';
                memberMsg.classList.remove('hidden');
            }

            const name = document.getElementById('member-name').value.trim();
            if (!name) {
                alert('登録する社員を選択してください。');
                if (memberMsg) memberMsg.classList.add('hidden');
                return;
            }

            // 重複登録のチェック
            const exists = allMembers.some(m => m.name === name);
            if (exists) {
                alert('この社員は既に資格者として登録されています。');
                if (memberMsg) memberMsg.classList.add('hidden');
                return;
            }

            let resolvedBranch = '';
            const myEmpInfo = currentCompany && currentCompany.employees ? currentCompany.employees.find(e => e.uid === currentUser.uid || e.email === currentUser.email) : null;
            if (myEmpInfo && myEmpInfo.branch) {
                resolvedBranch = myEmpInfo.branch;
            } else {
                const listFilter = document.getElementById('filter-branch');
                resolvedBranch = listFilter ? listFilter.value : '';
            }
            const branch = resolvedBranch;
            const dedication = "none";
            const customQual = "";

            // 社員データから役割（担当）を自動取得・マッピング
            let roles = [];
            if (currentCompany && currentCompany.employees) {
                const emp = currentCompany.employees.find(e => e.name === name);
                if (emp) {
                    const empRole = emp.employeeRole || emp.role;
                    const roleMap = { '営業': 'sales', '工務': 'const', '現場': 'site' };
                    const r = roleMap[empRole];
                    if (r) roles = [r];
                }
            }

            // 資格チェックボックス
            const qualifications = [];
            document.querySelectorAll('input[name="member-qual"]:checked').forEach(cb => {
                qualifications.push(cb.value);
            });

            try {
                await addMember(name, roles, qualifications, customQual, dedication, branch);
                
                if (memberMsg) {
                    memberMsg.className = 'message success';
                    memberMsg.textContent = `メンバー「${name}」を登録しました！`;
                }
                memberForm.reset();
                setTimeout(() => {
                    if (memberMsg) memberMsg.classList.add('hidden');
                }, 3000);
            } catch (err) {
                console.error(err);
                if (memberMsg) {
                    memberMsg.className = 'message error';
                    memberMsg.textContent = '登録に失敗しました。';
                }
            }
        });
    }
});



// ログアウト処理
btnLogout.addEventListener('click', () => {
    if (confirm('本当にログアウトしますか？')) {
        signOut(auth).catch(err => console.error(err));
    }
});

// トースト通知を表示する関数
const showToast = (message, type = 'success', duration = 5000) => {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const card = document.createElement('div');
    card.className = `toast-card toast-${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'warning') icon = '⚠️';
    if (type === 'error') icon = '❌';

    card.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
            <span style="font-size:1.25rem;line-height:1;">${icon}</span>
            <span style="font-weight:500;">${message}</span>
        </div>
        <button class="toast-close">&times;</button>
    `;

    const closeBtn = card.querySelector('.toast-close');
    closeBtn.onclick = () => {
        card.style.animation = 'toastFadeOut 0.3s ease-out forwards';
        setTimeout(() => card.remove(), 300);
    };

    container.appendChild(card);

    setTimeout(() => {
        if (card.parentNode) {
            card.style.animation = 'toastFadeOut 0.3s ease-out forwards';
            setTimeout(() => card.remove(), 300);
        }
    }, duration);
};
window.showToast = showToast;

// 日別タスクデータを新旧形式問わず配列に正規化するヘルパー関数
const normalizeDailyTasks = (dayLog) => {
    if (!dayLog) return [];
    if (Array.isArray(dayLog)) {
        return dayLog;
    }
    if (typeof dayLog === 'object') {
        const ts = [];
        const labels = { morning: '午前', afternoon: '午後', night: '夜間' };
        ['morning', 'afternoon', 'night'].forEach(period => {
            const sec = dayLog[period];
            if (sec && (sec.project || sec.detail)) {
                // timelineから時間数を計算 (午前: 0-7, 午後: 10-17, 夜間: 18以降)
                let h = 0;
                const tl = dayLog.timeline || '';
                if (tl) {
                    if (period === 'morning') {
                        h = tl.substring(0, 8).split('').filter(s => s === '1' || s === '3' || s === '5').length * 0.5;
                    } else if (period === 'afternoon') {
                        h = tl.substring(10, 18).split('').filter(s => s === '1' || s === '3' || s === '5').length * 0.5;
                    } else if (period === 'night') {
                        h = tl.substring(18).split('').filter(s => s === '1' || s === '3' || s === '5').length * 0.5;
                    }
                }
                ts.push({
                    project: sec.project,
                    detail: sec.detail,
                    hours: h,
                    timeline: dayLog.timeline || '',
                    period: period,
                    periodLabel: labels[period]
                });
            }
        });
        
        // もし各periodの時間がすべて0で、全体にtimelineがある場合は従来のフォールバック
        let totalH = ts.reduce((sum, t) => sum + t.hours, 0);
        if (totalH === 0 && ts.length > 0) {
            const tl = dayLog.timeline || '';
            const totalWorkHours = tl ? tl.split('').filter(s => s === '1' || s === '3' || s === '5').length * 0.5 : 0;
            ts[0].hours = totalWorkHours;
        }

        if (dayLog.leaveType) {
            ts.push({
                project: dayLog.leaveType,
                detail: '',
                hours: 0,
                timeline: '',
                period: 'leave',
                periodLabel: '休暇等'
            });
        }
        return ts;
    }
    return [];
};

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

// タイムラインの48文字から、作業の連続する時間帯を配列で返す関数（例: ["09:00〜12:00", "13:00〜17:00"]）
const getTimelineIntervals = (timelineStr) => {
    if (!timelineStr || timelineStr.length !== 48) return [];
    const intervals = [];
    let inInterval = false;
    let startIdx = -1;
    
    for (let i = 0; i < 48; i++) {
        const state = parseInt(timelineStr[i]);
        if (state === 1) { // 作業
            if (!inInterval) {
                inInterval = true;
                startIdx = i;
            }
        } else {
            if (inInterval) {
                inInterval = false;
                intervals.push({ start: startIdx, end: i });
            }
        }
    }
    if (inInterval) {
        intervals.push({ start: startIdx, end: 48 });
    }
    
    return intervals.map(interval => {
        const formatTime = (idx) => {
            const h = (Math.floor(idx / 2) + 5) % 24; // 5:00起点
            const m = (idx % 2 === 0) ? '00' : '30';
            return `${String(h).padStart(2, '0')}:${m}`;
        };
        return `${formatTime(interval.start)}〜${formatTime(interval.end)}`;
    });
};

// 今週のISO週（YYYY-Www）を取得する関数
const getISOWeekString = (date) => {
    const tempDate = new Date(date.valueOf());
    tempDate.setDate(tempDate.getDate() + 4 - (tempDate.getDay() || 7));
    const yearStart = new Date(tempDate.getFullYear(), 0, 1);
    const weekNo = Math.ceil((((tempDate - yearStart) / 86400000) + 1) / 7);
    return `${tempDate.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
};

// 今年と来年の週（月曜日の日付基準）を逆順でプルダウンの選択肢として生成する関数
const generateWeekOptions = () => {
    const select = document.getElementById('week');
    if (!select) return;
    
    select.innerHTML = '';
    
    const today = new Date();
    const currentWeekStr = getISOWeekString(today);
    const currentYear = today.getFullYear();
    
    const options = [];
    
    // 前年・今年・来年の3年分生成
    for (let year = currentYear - 1; year <= currentYear + 1; year++) {
        const start = new Date(year, 0, 1);
        const dayOfWeek = start.getDay();
        const firstMonday = new Date(start.getTime() + ((dayOfWeek <= 1 ? 1 - dayOfWeek : 8 - dayOfWeek) * 24 * 60 * 60 * 1000));
        
        let currentMonday = new Date(firstMonday.getTime());
        
        while (currentMonday.getFullYear() <= year) {
            const weekStr = getISOWeekString(currentMonday);
            const m = currentMonday.getMonth() + 1;
            const d = currentMonday.getDate();
            const sy = currentMonday.getFullYear();
            
            const sunday = new Date(currentMonday.getTime() + 6 * 24 * 60 * 60 * 1000);
            const sm = sunday.getMonth() + 1;
            const sd = sunday.getDate();
            
            // 重複排除
            if (!options.find(o => o.value === weekStr)) {
                const isCurrent = weekStr === currentWeekStr;
                options.push({
                    value: weekStr,
                    text: `${sy}年 ${m}/${d} 〜 ${sm}/${sd} の週${isCurrent ? ' (今週)' : ''}`
                });
            }
            
            currentMonday.setDate(currentMonday.getDate() + 7);
        }
    }
    
    // 新しい週が先頭になるよう逆順にして、現在週をselected
    options.sort((a, b) => b.value.localeCompare(a.value));
    options.forEach(opt => {
        const el = document.createElement('option');
        el.value = opt.value;
        el.textContent = opt.text;
        if (opt.value === currentWeekStr) {
            el.selected = true;
            el.style.color = '#ef4444';      // 現在週を赤字
            el.style.fontWeight = 'bold';    // 太字
        }
        select.appendChild(el);
    });
};

// 週の開始日（月曜日）から各曜日の実際の日付をラベルに表示する関数
const updateDayLabels = () => {
    const weekInput = document.getElementById('week');
    if (!weekInput || !weekInput.value) return;
    
    const getMondayOfISOWeek = (weekStr) => {
        const parts = weekStr.split('-W');
        if (parts.length !== 2) return null;
        const year = parseInt(parts[0], 10);
        const week = parseInt(parts[1], 10);
        
        const simple = new Date(year, 0, 4);
        const dayOfWeek = simple.getDay();
        const ISOweekStart = new Date(simple.valueOf() - (dayOfWeek ? dayOfWeek - 1 : 6) * 86400000);
        return new Date(ISOweekStart.valueOf() + (week - 1) * 7 * 86400000);
    };
    
    const monday = getMondayOfISOWeek(weekInput.value);
    if (!monday) return;
    
    const daysMap = { '月': 0, '火': 1, '水': 2, '木': 3, '金': 4, '土': 5, '日': 6 };
    
    document.querySelectorAll('.day-card').forEach(card => {
        const labelSpan = card.querySelector('.day-label');
        const taskList = card.querySelector('.task-list');
        if (!labelSpan || !taskList) return;
        
        const dayName = taskList.dataset.day;
        const offset = daysMap[dayName];
        if (offset === undefined) return;
        
        const targetDate = new Date(monday.getTime() + offset * 86400000);
        const m = targetDate.getMonth() + 1;
        const d = targetDate.getDate();
        labelSpan.textContent = `${m}/${d} (${dayName})`;
    });
};

// --- 初期化ロジック群 ---
document.addEventListener('DOMContentLoaded', () => {
    // 未保存変更の追跡変数と検知用ロジック
    let lastSavedDataString = '';
    let lastSelectedWeek = '';

    const getUnsavedData = () => {
        const dailyLogs = {};
        daysName.forEach(day => {
            const taskList = document.querySelector(`.task-list[data-day="${day}"]`);
            if (taskList && taskList.getCardData) {
                dailyLogs[day] = taskList.getCardData();
            } else {
                dailyLogs[day] = { morning: {project:'',detail:'',report:''}, afternoon: {project:'',detail:'',report:''}, night: {project:'',detail:'',report:''}, timeline: '', leaveType: '' };
            }
        });

        const dailyReports = {};
        daysName.forEach(day => {
            const dayCard = document.querySelector(`.task-list[data-day="${day}"]`)?.closest('.day-card');
            if (dayCard) {
                const mrVal = dayCard.querySelector('.morning-report')?.value.trim() || '';
                const arVal = dayCard.querySelector('.afternoon-report')?.value.trim() || '';
                const nrVal = dayCard.querySelector('.night-report')?.value.trim() || '';
                const reports = [];
                if (mrVal) reports.push(`【午前】${mrVal}`);
                if (arVal) reports.push(`【午後】${arVal}`);
                if (nrVal) reports.push(`【夜間】${nrVal}`);
                dailyReports[day] = reports.join('\n');
            } else {
                dailyReports[day] = '';
            }
        });
        return { dailyLogs, dailyReports };
    };

    const checkUnsavedChanges = () => {
        // 保存ボタンが画面上に存在しない場合は無条件で保存警告をスキップ
        const hasSaveButtons = document.getElementById('btn-save-plan') || document.getElementById('btn-save-actual');
        if (!hasSaveButtons) {
            return false;
        }

        // 予定も実績も編集不可（ロック状態）のときは、保存警告をスキップ
        if (!currentIsPlanEditable && !currentIsActualEditable) {
            return false;
        }
        // 現在のフォームロック状態（上長承認済みの場合は編集できないため、変更チェックしない）
        const badge = document.getElementById('report-status-badge');
        const isApproved = badge && (badge.classList.contains('status-approved') || badge.dataset.actualStatus === 'approved');
        if (isApproved) return false;

        const currentDataStr = JSON.stringify(getUnsavedData());
        return lastSavedDataString && currentDataStr !== lastSavedDataString;
    };

    // 保存忘れ防止のプレミアム確認モーダルの表示
    const showUnsavedChangesModal = ({ onSaveAndLeave, onLeaveWithoutSaving, onCancel }) => {
        const existing = document.getElementById('unsaved-changes-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'unsaved-changes-modal';
        modal.style = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            font-family: inherit;
        `;

        modal.innerHTML = `
            <div style="
                background: var(--bg-card, #ffffff);
                color: var(--text, #000000);
                padding: 24px;
                border-radius: 12px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.15);
                max-width: 440px;
                width: 90%;
                border: 1px solid var(--border, #e2e8f0);
                animation: unsavedModalScale 0.2s ease-out;
            ">
                <h3 style="margin-top: 0; font-size: 1.15rem; font-weight: bold; display: flex; align-items: center; gap: 8px;">
                    ⚠️ 編集中のデータがあります
                </h3>
                <p style="margin: 16px 0 24px; font-size: 0.9rem; line-height: 1.5; color: var(--text-muted, #475569);">
                    実績（予定）の変更内容が保存されていません。移動する前に現在の内容を保存しますか？
                </p>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <button id="unsaved-save-btn" style="
                        padding: 10px 16px;
                        background: var(--primary, #2563eb);
                        color: white;
                        border: none;
                        border-radius: 6px;
                        font-size: 0.9rem;
                        font-weight: bold;
                        cursor: pointer;
                        transition: background 0.15s;
                    ">はい、保存して移動する</button>
                    
                    <button id="unsaved-discard-btn" style="
                        padding: 10px 16px;
                        background: #f1f5f9;
                        color: #475569;
                        border: 1px solid #e2e8f0;
                        border-radius: 6px;
                        font-size: 0.9rem;
                        font-weight: bold;
                        cursor: pointer;
                        transition: background 0.15s;
                    ">保存せずに移動する</button>
                    
                    <button id="unsaved-cancel-btn" style="
                        padding: 10px 16px;
                        background: transparent;
                        color: #64748b;
                        border: none;
                        border-radius: 6px;
                        font-size: 0.9rem;
                        cursor: pointer;
                    ">キャンセル（編集を続ける）</button>
                </div>
            </div>
            <style>
                @keyframes unsavedModalScale {
                    from { transform: scale(0.95); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
                #unsaved-save-btn:hover { background: #1d4ed8 !important; }
                #unsaved-discard-btn:hover { background: #e2e8f0 !important; }
                #unsaved-cancel-btn:hover { text-decoration: underline; }
            </style>
        `;

        document.body.appendChild(modal);

        const cleanup = () => modal.remove();

        document.getElementById('unsaved-save-btn').onclick = () => {
            cleanup();
            onSaveAndLeave();
        };
        document.getElementById('unsaved-discard-btn').onclick = () => {
            cleanup();
            onLeaveWithoutSaving();
        };
        document.getElementById('unsaved-cancel-btn').onclick = () => {
            cleanup();
            onCancel();
        };
    };



    const weekInput = document.getElementById('week');
    const weekDisplayHint = document.getElementById('week-display-hint');
    if (weekInput) {
        generateWeekOptions();
        if (!weekInput.value) {
            weekInput.value = getISOWeekString(new Date());
        }
        weekDisplayHint.textContent = weekInput.value ? formatWeekRange(weekInput.value) + ' の報告' : '';
        
        weekInput.addEventListener('change', async () => {
            const nextWeek = weekInput.value;
            if (nextWeek === lastSelectedWeek) return;

            if (checkUnsavedChanges()) {
                // 一旦セレクトボックスの表示を元の値に戻す
                weekInput.value = lastSelectedWeek;
                
                showUnsavedChangesModal({
                    onSaveAndLeave: async () => {
                        // 現在のステータスを判定して元の週で保存
                        const badge = document.getElementById('report-status-badge');
                        let status = 'plan';
                        if (badge) {
                            if (badge.dataset.status) status = badge.dataset.status;
                            else if (badge.classList.contains('status-approved')) status = 'approved';
                            else if (badge.classList.contains('status-confirmed')) status = 'confirmed';
                        }
                        
                        await saveReport(status);

                        // 保存完了後に移動先へ遷移
                        lastSelectedWeek = nextWeek;
                        weekInput.value = nextWeek;
                        weekDisplayHint.textContent = nextWeek ? formatWeekRange(nextWeek) + ' の報告' : '';
                        updateDayLabels();
                        loadReportForSelectedWeek();
                    },
                    onLeaveWithoutSaving: () => {
                        // 保存せずに遷移
                        lastSelectedWeek = nextWeek;
                        weekInput.value = nextWeek;
                        weekDisplayHint.textContent = nextWeek ? formatWeekRange(nextWeek) + ' の報告' : '';
                        updateDayLabels();
                        loadReportForSelectedWeek();
                    },
                    onCancel: () => {
                        // キャンセル（週の値はすでに戻されているので何もしない）
                    }
                });
            } else {
                lastSelectedWeek = nextWeek;
                weekDisplayHint.textContent = nextWeek ? formatWeekRange(nextWeek) + ' の報告' : '';
                updateDayLabels();
                loadReportForSelectedWeek();
            }
        });
        
        setTimeout(() => {
            updateDayLabels();
            loadReportForSelectedWeek();
        }, 500);
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
            const currentActiveTab = document.querySelector('.tab-btn.active');
            const isLeavingWeeklyInputView = currentActiveTab && currentActiveTab.dataset.target === 'input-view';
            const isLeavingScheduleInputView = currentActiveTab && currentActiveTab.dataset.target === 'schedule-input-view';
            const isClickingCurrent = currentActiveTab === btn;

            if (isClickingCurrent) return;

            const executeTabSwitch = () => {
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
                    if (btn.dataset.target === 'input-view') {
                        loadReports(false);
                        loadReportForSelectedWeek();
                    }
                    if (btn.dataset.target === 'schedule-input-view') {
                        const idInput = document.getElementById('sched-id');
                        if (!idInput || !idInput.value) {
                            resetScheduleEditMode();
                        }
                    }
                }
            };

            if (isLeavingWeeklyInputView && checkUnsavedChanges()) {
                showUnsavedChangesModal({
                    onSaveAndLeave: async () => {
                        const badge = document.getElementById('report-status-badge');
                        let status = 'plan';
                        if (badge) {
                            if (badge.dataset.status) status = badge.dataset.status;
                            else if (badge.classList.contains('status-approved')) status = 'approved';
                            else if (badge.classList.contains('status-confirmed')) status = 'confirmed';
                        }
                        await saveReport(status);
                        executeTabSwitch();
                    },
                    onLeaveWithoutSaving: () => {
                        executeTabSwitch();
                    },
                    onCancel: () => {
                        // キャンセル
                    }
                });
            } else if (isLeavingScheduleInputView && checkUnsavedScheduleChanges()) {
                showUnsavedScheduleChangesModal({
                    onSaveAndLeave: async () => {
                        const success = await saveScheduleForm();
                        if (success) {
                            executeTabSwitch();
                        }
                    },
                    onLeaveWithoutSaving: () => {
                        // 保存せずに遷移するので変更フラグを初期化
                        lastSavedScheduleDataString = getScheduleFormDataString();
                        executeTabSwitch();
                    },
                    onCancel: () => {
                        // キャンセル
                    }
                });
            } else {
                executeTabSwitch();
            }
        });
    });

    // ブラウザのタブ閉じ・リロード時の警告
    window.addEventListener('beforeunload', (e) => {
        if (checkUnsavedChanges() || checkUnsavedScheduleChanges()) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    // フォーム制御関数 (一括 disabled化/活性化)
    // フォーム制御関数 (予定・実績のステータスに応じたきめ細かい制御)
    const setFormLocked = (pStatus, aStatus) => {
        let planStatus = 'draft';
        let actualStatus = 'uncreated';

        if (typeof pStatus === 'boolean') {
            if (pStatus) {
                planStatus = 'approved';
                actualStatus = 'approved';
            } else {
                planStatus = 'draft';
                actualStatus = 'uncreated';
            }
        } else {
            planStatus = pStatus || 'draft';
            actualStatus = aStatus || 'uncreated';
        }

        const isPlanEditable = (planStatus === 'draft' || planStatus === 'rejected');
        const isActualEditable = (planStatus === 'approved' && (actualStatus === 'draft' || actualStatus === 'rejected' || actualStatus === 'uncreated'));
        currentIsPlanEditable = isPlanEditable;
        currentIsActualEditable = isActualEditable;

        const form = document.getElementById('report-form');
        if (!form) return;

        // 全てロックされているか（予定も実績も編集不可か）のトグル
        const isAllLocked = !isPlanEditable && !isActualEditable;
        form.classList.toggle('form-locked', isAllLocked);

        // 予定関連のインプット (支店・現場名、作業内容・備考)
        form.querySelectorAll('.morning-project, .morning-detail, .afternoon-project, .afternoon-detail, .night-project, .night-detail').forEach(el => {
            el.disabled = !isPlanEditable;
        });

        // 実績関連のインプット (詳細レポート)
        form.querySelectorAll('.morning-report, .afternoon-report, .night-report').forEach(el => {
            el.disabled = !isActualEditable;
        });

        // 休みボタンと前日コピーボタンの制御
        document.querySelectorAll('.leave-quick-btn, .btn-copy-prev').forEach(btn => {
            if (isPlanEditable || isActualEditable) {
                btn.style.pointerEvents = 'auto';
                btn.style.opacity = '1';
                btn.disabled = false;
            } else {
                btn.style.pointerEvents = 'none';
                btn.style.opacity = '0.5';
                btn.disabled = true;
            }
        });

        // 日報コピー欄の無効化 (実績入力用)
        const copySelect = document.getElementById('copy-past-report-select');
        const copyBtn = document.getElementById('btn-copy-past-report');
        if (copySelect) copySelect.disabled = !isActualEditable;
        if (copyBtn) copyBtn.disabled = !isActualEditable;

        // タイムラインとパレットの操作無効化 (予定・実績入力用)
        const isTimelineEditable = (isPlanEditable || isActualEditable);
        document.querySelectorAll('.timeline-container-scroll, .timeline-palette').forEach(el => {
            if (!isTimelineEditable) {
                el.style.pointerEvents = 'none';
                el.style.opacity = '0.5';
            } else {
                // 休み( leaveType )が設定されているカードかどうかチェック
                const isInLeaveCard = el.closest('.day-card')?.querySelector('.day-leave-type')?.value;
                if (isInLeaveCard) {
                    el.style.pointerEvents = 'none';
                    el.style.opacity = '0.5';
                } else {
                    el.style.pointerEvents = 'auto';
                    el.style.opacity = '1';
                }
            }
        });
    };

    // 日次レポート入力欄の無効化・背景グレーアウト制御 (新セクション用)
    const updateDayReportTextStatus = (dayCard) => {
        if (!dayCard) return;
        
        const leaveInput = dayCard.querySelector('.day-leave-type');
        let hasLeave = leaveInput && leaveInput.value ? true : false;
        
        dayCard.querySelectorAll('.morning-report, .afternoon-report, .night-report').forEach(reportInput => {
            if (hasLeave) {
                reportInput.value = '';
                reportInput.disabled = true;
                reportInput.style.backgroundColor = '#f1f5f9';
            } else {
                // 状態は setFormLocked で別途制御されるため、ここでは休み時のクリアとグレーアウトのみ行う
                reportInput.style.backgroundColor = '';
            }
        });
    };

    // 日別入力枠
    const daysName = ['月', '火', '水', '木', '金', '土', '日'];
    const daysContainer = document.getElementById('days-container');
    const taskRowTemplate = document.getElementById('task-row-template');

    const calculateWeekTotal = () => {
        let weekTotal = 0;
        let weekSiteTotal = 0;
        document.querySelectorAll('.day-timeline-data').forEach(input => {
            const tl = input.value || '';
            if (tl.length === 48) {
                const workCount = tl.split('').filter(s => s === '1' || s === '3' || s === '5').length;
                const siteCount = tl.split('').filter(s => s === '1').length;
                weekTotal += workCount * 0.5;
                weekSiteTotal += siteCount * 0.5;
            }
        });
        const weekTotalSpan = document.getElementById('week-total-hours');
        if (weekTotalSpan) {
            weekTotalSpan.textContent = `週合計: ${weekTotal.toFixed(1)}H (現場従事: ${weekSiteTotal.toFixed(1)}H)`;
        }
    };

    const showRejectModal = (title, onConfirm) => {
        const existing = document.getElementById('reject-reason-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'reject-reason-modal';
        modal.style = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
        `;
        
        modal.innerHTML = `
            <div style="background: var(--bg-card, #ffffff); border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04); width: 90%; max-width: 480px; padding: 24px; box-sizing: border-box; border: 1px solid var(--border);">
                <h3 style="margin-top: 0; margin-bottom: 16px; font-size: 1.2rem; color: var(--text-main); font-weight: bold;">${title}</h3>
                <p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 12px;">差し戻しの理由を入力してください（社員の画面に表示されます）。</p>
                <textarea id="reject-reason-textarea" placeholder="理由を入力してください（例：水曜日の作業詳細が不足しています）" 
                    style="width: 100%; height: 100px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; font-size: 0.9rem; margin-bottom: 20px; box-sizing: border-box; resize: none; background: #ffffff; color: #000000;"></textarea>
                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    <button type="button" id="reject-cancel-btn" class="btn btn-secondary" style="padding: 8px 16px;">キャンセル</button>
                    <button type="button" id="reject-submit-btn" class="btn btn-danger" style="padding: 8px 16px; background-color: #ef4444; color: #ffffff;">差し戻し確定</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const cancelBtn = modal.querySelector('#reject-cancel-btn');
        const submitBtn = modal.querySelector('#reject-submit-btn');
        const textarea = modal.querySelector('#reject-reason-textarea');

        cancelBtn.addEventListener('click', () => {
            modal.remove();
        });

        submitBtn.addEventListener('click', () => {
            const reason = textarea.value.trim();
            if (!reason) {
                alert('差し戻し理由を入力してください。');
                return;
            }
            onConfirm(reason);
            modal.remove();
        });
    };

    const loadReportForSelectedWeek = () => {
        const weekInput = document.getElementById('week');
        const authorInput = document.getElementById('author');
        const badge = document.getElementById('report-status-badge');
        const actionContainer = document.getElementById('report-action-buttons');
        if (!weekInput || !authorInput) return;
        
        const selectedWeek = weekInput.value;
        const currentAuthor = authorInput.value;
        if (!selectedWeek || !currentAuthor) return;
        
        const currentWeek = getISOWeekString(new Date());
        const isFutureWeek = selectedWeek > currentWeek; // 選択された週が今日より未来の週かどうか
        
        const existingReport = allReports.find(r => r.week === selectedWeek && r.author === currentAuthor);
        
        // 全曜日クリア
        daysName.forEach(day => {
            const taskList = document.querySelector(`.task-list[data-day="${day}"]`);
            if (taskList && taskList.clearAll) {
                taskList.clearAll();
                const reportText = taskList.closest('.day-card').querySelector('.day-report-text');
                if (reportText) reportText.value = '';
            }
        });
        
        // 実績ステータスバッジの動的生成
        let actualBadge = document.getElementById('report-actual-status-badge');
        if (!actualBadge && badge) {
            actualBadge = document.createElement('span');
            actualBadge.id = 'report-actual-status-badge';
            actualBadge.style = 'margin-left: 8px;';
            badge.parentNode.insertBefore(actualBadge, badge.nextSibling);
        }

        // 警告表示エリア（差し戻し理由）の取得と初期化
        let warningEl = document.getElementById('report-reject-warning');






        if (warningEl) warningEl.style.display = 'none';

        // ステータス値のロードと互換性処理
        let planStatus = 'draft';
        let planRejectReason = '';
        let actualStatus = 'uncreated';
        let actualRejectReason = '';

        if (existingReport) {
            planStatus = existingReport.planStatus || 'draft';
            planRejectReason = existingReport.planRejectReason || '';
            actualStatus = existingReport.actualStatus || (existingReport.status === 'plan' ? 'uncreated' : 'draft');
            actualRejectReason = existingReport.actualRejectReason || '';

            // 互換性処理: 古いデータで status フィールドだけがある場合
            if (!existingReport.planStatus && !existingReport.actualStatus) {
                const legacyStatus = existingReport.status;
                if (legacyStatus === 'approved') {
                    planStatus = 'approved';
                    actualStatus = 'approved';
                } else if (legacyStatus === 'confirmed') {
                    planStatus = 'approved';
                    actualStatus = 'submitted';
                } else {
                    planStatus = 'draft';
                    actualStatus = 'uncreated';
                }
            }

            // 安全ガード: 実績が承認済なら予定も強制的に承認済とする
            if (actualStatus === 'approved') {
                planStatus = 'approved';
            }
        }

        // 未来の週は予定のみ許可
        if (isFutureWeek) {
            // planStatus = 'draft'; // 予定ステータスを維持するためコメントアウト
            actualStatus = 'uncreated';
        }

        // バッジデータセットの更新 (他所での判定用)
        if (badge) {
            badge.dataset.planStatus = planStatus;
            badge.dataset.actualStatus = actualStatus;
            badge.dataset.status = actualStatus === 'approved' ? 'approved' : (actualStatus === 'submitted' ? 'confirmed' : 'plan');
        }

        // フォームコントロールのロック適用
        setFormLocked(planStatus, actualStatus);
        
        if (existingReport) {
            daysName.forEach(day => {
                const taskList = document.querySelector(`.task-list[data-day="${day}"]`);
                if (!taskList) return;
                const dayLog = existingReport.dailyLogs ? existingReport.dailyLogs[day] : null;
                
                if (dayLog) {
                    if (Array.isArray(dayLog)) {
                        dayLog.forEach(t => {
                            if (taskList.addTaskRow) taskList.addTaskRow(t.project || '', t.detail || '', t.hours || '', t.timeline || '');
                        });
                    } else if (typeof dayLog === 'object') {
                        if (taskList.setCardData) taskList.setCardData(dayLog);
                    }
                }
                
                const reportText = taskList.closest('.day-card').querySelector('.day-report-text');
                if (reportText) {
                    reportText.value = (existingReport.dailyReports && existingReport.dailyReports[day]) ? existingReport.dailyReports[day] : '';
                }
            });
            
            // バッジ表示テキスト＆カラーの更新
            if (badge) {
                if (planStatus === 'approved') {
                    badge.className = 'status-badge status-approved';
                    badge.textContent = '予定: 承認済み';
                } else if (planStatus === 'submitted') {
                    badge.className = 'status-badge status-confirmed';
                    badge.textContent = '予定: 承認待ち';
                } else if (planStatus === 'rejected') {
                    badge.className = 'status-badge status-none';
                    badge.style.backgroundColor = '#ef4444';
                    badge.style.color = '#ffffff';
                    badge.textContent = '予定: 差し戻し';
                } else {
                    badge.className = 'status-badge status-plan';
                    badge.style.backgroundColor = '';
                    badge.style.color = '';
                    badge.textContent = '予定: 下書き';
                }
            }

            if (actualBadge) {
                actualBadge.style.display = 'inline-block';
                if (planStatus !== 'approved') {
                    actualBadge.className = 'status-badge status-none';
                    actualBadge.style.backgroundColor = '#94a3b8';
                    actualBadge.style.color = '#ffffff';
                    actualBadge.textContent = '実績: 未開始';
                } else if (actualStatus === 'approved') {
                    actualBadge.className = 'status-badge status-approved';
                    actualBadge.style.backgroundColor = '';
                    actualBadge.style.color = '';
                    actualBadge.textContent = '実績: 承認済み';
                } else if (actualStatus === 'submitted') {
                    actualBadge.className = 'status-badge status-confirmed';
                    actualBadge.style.backgroundColor = '';
                    actualBadge.style.color = '';
                    actualBadge.textContent = '実績: 承認待ち';
                } else if (actualStatus === 'rejected') {
                    actualBadge.className = 'status-badge status-none';
                    actualBadge.style.backgroundColor = '#ef4444';
                    actualBadge.style.color = '#ffffff';
                    actualBadge.textContent = '実績: 差し戻し';
                } else {
                    actualBadge.className = 'status-badge status-plan';
                    actualBadge.style.backgroundColor = '';
                    actualBadge.style.color = '';
                    actualBadge.textContent = '実績: 入力中';
                }
            }

            // 差し戻し警告の表示
            if (planStatus === 'rejected' && planRejectReason && warningEl) {
                warningEl.style.display = 'flex';
                warningEl.innerHTML = `<div>⚠️ 予定が差し戻されました。</div><div style="font-weight:normal; font-size:0.85rem; margin-top:2px;">差し戻し理由: ${planRejectReason}</div>`;
            } else if (actualStatus === 'rejected' && actualRejectReason && warningEl) {
                warningEl.style.display = 'flex';
                warningEl.innerHTML = `<div>⚠️ 実績が差し戻されました。</div><div style="font-weight:normal; font-size:0.85rem; margin-top:2px;">差し戻し理由: ${actualRejectReason}</div>`;
            }
            
            // ボタン制御
            if (actionContainer) {
                const currentUserName = currentUser.displayName || currentUser.email.split('@')[0];
                const isAdminViewingOthers = (currentCompany && currentCompany.role === 'admin' && currentAuthor !== currentUserName);

                if (isFutureWeek && false) { // 未来の週の特別制限を通常フローに統合
                    actionContainer.innerHTML = `
                        <button type="button" id="btn-save-plan" class="btn btn-secondary btn-large" style="background-color:#ea580c;">予定を更新（一時保存）</button>
                    `;
                    const btnSavePlan = document.getElementById('btn-save-plan');
                    if (btnSavePlan) {
                        btnSavePlan.addEventListener('click', () => saveReport('plan'));
                    }
                } else if (isAdminViewingOthers) {
                    // 管理者が他社員の週報を閲覧している場合
                    if (planStatus === 'submitted') {
                        actionContainer.innerHTML = `
                            <button type="button" id="btn-admin-approve-plan" class="btn btn-success btn-large" style="flex:1;">👍 予定を承認する</button>
                            <button type="button" id="btn-admin-reject-plan" class="btn btn-danger btn-large" style="flex:1; background-color:#ef4444;">👎 予定を差し戻す</button>
                        `;
                        document.getElementById('btn-admin-approve-plan').addEventListener('click', () => saveReport('plan_approved'));
                        document.getElementById('btn-admin-reject-plan').addEventListener('click', () => {
                            showRejectModal('予定の差し戻し', (reason) => saveReport('plan_rejected', reason));
                        });
                    } else if (planStatus === 'approved' && actualStatus === 'submitted') {
                        actionContainer.innerHTML = `
                            <button type="button" id="btn-admin-approve-actual" class="btn btn-success btn-large" style="flex:1;">👍 実績を承認する</button>
                            <button type="button" id="btn-admin-reject-actual" class="btn btn-danger btn-large" style="flex:1; background-color:#ef4444;">👎 実績を差し戻す</button>
                        `;
                        document.getElementById('btn-admin-approve-actual').addEventListener('click', () => saveReport('approved'));
                        document.getElementById('btn-admin-reject-actual').addEventListener('click', () => {
                            showRejectModal('実績の差し戻し', (reason) => saveReport('actual_rejected', reason));
                        });
                    } else if (planStatus === 'approved' && actualStatus === 'approved') {
                        actionContainer.innerHTML = `
                            <button type="button" id="btn-admin-unapprove" class="btn btn-danger btn-large" style="background-color:#ef4444;">🔓 承認を取り消す（差し戻す）</button>
                        `;
                        document.getElementById('btn-admin-unapprove').addEventListener('click', () => {
                            showRejectModal('承認取り消し・実績差し戻し', (reason) => saveReport('actual_rejected', reason));
                        });
                    } else {
                        if (isFutureWeek && planStatus === 'approved') {
                            actionContainer.innerHTML = `<div style="text-align:center; font-weight:bold; color:#16a34a; width:100%;">✅ 予定は承認済みです。未来の週のため実績の入力はまだ開始できません。</div>`;
                        } else {
                            actionContainer.innerHTML = `<div style="text-align:center; font-weight:bold; color:var(--text-muted); width:100%;">この週報は現在、社員が入力中または一時保存状態です。</div>`;
                        }
                    }
                } else {
                    // 社員本人（または管理者が自分の週報を編集している場合）
                    if (planStatus === 'draft' || planStatus === 'rejected') {
                        actionContainer.innerHTML = `
                            <button type="button" id="btn-save-plan" class="btn btn-secondary btn-large" style="background-color:#ea580c; flex: 1;">予定を一時保存</button>
                            <button type="button" id="btn-submit-plan" class="btn btn-primary btn-large" style="flex: 1;">予定を提出する</button>
                        `;
                        document.getElementById('btn-save-plan').addEventListener('click', () => saveReport('plan'));
                        document.getElementById('btn-submit-plan').addEventListener('click', () => saveReport('plan_submitted'));
                    } else if (planStatus === 'submitted') {
                        actionContainer.innerHTML = `
                            <div style="text-align:center; font-weight:bold; color:var(--primary); width:100%; margin-bottom: 10px;">⌛ 予定の承認待ちです（編集はロックされています）</div>
                            <button type="button" id="btn-withdraw-plan" class="btn btn-secondary btn-large" style="background-color:#6b7280; color:#ffffff; flex: 1; margin: 0 auto; max-width: 300px;">予定の提出を取り消す</button>
                        `;
                        document.getElementById('btn-withdraw-plan').addEventListener('click', async () => {
                            if (confirm('予定の提出を取り消して、下書き状態に戻しますか？')) {
                                await saveReport('plan_withdrawn');
                            }
                        });
                    } else if (planStatus === 'approved' && (actualStatus === 'draft' || actualStatus === 'rejected' || actualStatus === 'uncreated')) {
                        if (isFutureWeek) {
                            actionContainer.innerHTML = `<div style="text-align:center; font-weight:bold; color:#16a34a; width:100%;">✅ 予定は承認済みです（実績は該当週になってから入力してください）</div>`;
                        } else {
                            actionContainer.innerHTML = `
                                <button type="button" id="btn-save-actual" class="btn btn-secondary btn-large" style="background-color:#ea580c; flex: 1;">実績を一時保存</button>
                                <button type="button" id="btn-submit-actual" class="btn btn-primary btn-large" style="flex: 1;">実績を確定提出する</button>
                            `;
                            document.getElementById('btn-save-actual').addEventListener('click', () => saveReport('draft'));
                            document.getElementById('btn-submit-actual').addEventListener('click', () => saveReport('confirmed'));
                        }
                    } else if (planStatus === 'approved' && actualStatus === 'submitted') {
                        actionContainer.innerHTML = `
                            <div style="text-align:center; font-weight:bold; color:var(--primary); width:100%; margin-bottom: 10px;">⌛ 実績の承認待ちです（編集はロックされています）</div>
                            <button type="button" id="btn-withdraw-actual" class="btn btn-secondary btn-large" style="background-color:#6b7280; color:#ffffff; flex: 1; margin: 0 auto; max-width: 300px;">実績の提出を取り消す</button>
                        `;
                        document.getElementById('btn-withdraw-actual').addEventListener('click', async () => {
                            if (confirm('実績の提出を取り消して、下書き状態に戻しますか？')) {
                                await saveReport('actual_withdrawn');
                            }
                        });
                    } else if (planStatus === 'approved' && actualStatus === 'approved') {
                        actionContainer.innerHTML = `<div style="text-align:center; font-weight:bold; color:#16a34a; width:100%;">✅ 今週の日報はすべて承認済みです</div>`;
                    }
                }
            }
        } else {
            daysName.forEach(day => {
                const taskList = document.querySelector(`.task-list[data-day="${day}"]`);
                if (taskList && taskList.addTaskRow) {
                    taskList.addTaskRow();
                }
            });
            
            if (badge) {
                badge.className = 'status-badge status-none';
                badge.textContent = '未登録';
            }
            if (actualBadge) {
                actualBadge.style.display = 'none';
            }
            
            if (actionContainer) {
                if (isFutureWeek && false) { // 未来の週でも予定の一時保存と提出の両方を表示
                    actionContainer.innerHTML = `
                        <button type="button" id="btn-save-plan" class="btn btn-secondary btn-large" style="background-color:#ea580c;">予定として一時保存</button>
                    `;
                    const btnSavePlan = document.getElementById('btn-save-plan');
                    if (btnSavePlan) {
                        btnSavePlan.addEventListener('click', () => saveReport('plan'));
                    }
                } else {
                    // 新規週報時は、まず予定を入力して提出する
                    actionContainer.innerHTML = `
                        <button type="button" id="btn-save-plan" class="btn btn-secondary btn-large" style="background-color:#ea580c; flex: 1;">予定を一時保存</button>
                        <button type="button" id="btn-submit-plan" class="btn btn-primary btn-large" style="flex: 1;">予定を提出する</button>
                    `;
                    document.getElementById('btn-save-plan').addEventListener('click', () => saveReport('plan'));
                    document.getElementById('btn-submit-plan').addEventListener('click', () => saveReport('plan_submitted'));
                }
            }
        }
        calculateWeekTotal();
        
        daysName.forEach(day => {
            const dayCard = document.querySelector(`.task-list[data-day="${day}"]`).closest('.day-card');
            updateDayReportTextStatus(dayCard);
        });

        setTimeout(() => {
            lastSavedDataString = JSON.stringify(getUnsavedData());
            if (weekInput) {
                lastSelectedWeek = weekInput.value;
            }
        }, 100);
    };

    if (daysContainer) {
        daysName.forEach(day => {
            const dayCard = document.createElement('div');
            dayCard.className = 'day-card';
            const copyBtnHtml = day !== '月' ? `<button type="button" class="btn btn-secondary btn-small btn-copy-prev" style="padding: 2px 8px; font-size: 0.75rem; border-radius: 4px; font-weight: bold;">前日からコピー</button>` : '';
            // dayCard の基本HTML（午前・午後・夜間 + タイムライン + レポート）
            dayCard.innerHTML = `
                <div class="day-header" style="display:flex;justify-content:space-between;align-items:center;">
                    <span class="day-label">${day}曜日</span>
                    <div style="display:flex;gap:10px;align-items:center;">
                        ${copyBtnHtml}
                        <span class="total-hours" style="font-size:0.85rem;font-weight:normal;">計 0.0H</span>
                    </div>
                </div>
                <div class="day-body">
                    <!-- 休み クイックボタン -->
                    <div class="leave-quick-btns">
                        <span style="font-size:0.8rem;color:var(--text-muted);align-self:center;">休み：</span>
                        <button type="button" class="leave-quick-btn" data-leave="休日">休日</button>
                        <button type="button" class="leave-quick-btn leave-clear-btn" data-leave="">解除</button>
                    </div>
                    <div class="task-list" data-day="${day}" style="display:none;"></div>
                    <!-- 午前セクション -->
                    <div class="time-section morning">
                        <div class="time-section-header">🌅 午前</div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                            <input type="text" class="section-project morning-project" placeholder="支店・現場名" list="project-suggestions" autocomplete="off"
                                style="flex:2;min-width:130px;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;background:#ffffff;color:#000000;">
                            <input type="text" class="section-detail morning-detail" placeholder="作業内容・備考"
                                style="flex:3;min-width:180px;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;background:#ffffff;color:#000000;">
                        </div>
                        <div style="margin-top:6px; width:100%;">
                            <input type="text" class="section-report morning-report" placeholder="午前の詳細レポート・備考（印刷時に青文字で表示されます）"
                                style="width:100%;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;background:#ffffff;color:#000000;">
                        </div>
                    </div>
                    <!-- 午後セクション -->
                    <div class="time-section afternoon">
                        <div class="time-section-header">🌤 午後</div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                            <input type="text" class="section-project afternoon-project" placeholder="支店・現場名" list="project-suggestions" autocomplete="off"
                                style="flex:2;min-width:130px;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;background:#ffffff;color:#000000;">
                            <input type="text" class="section-detail afternoon-detail" placeholder="作業内容・備考"
                                style="flex:3;min-width:180px;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;background:#ffffff;color:#000000;">
                        </div>
                        <div style="margin-top:6px; width:100%;">
                            <input type="text" class="section-report afternoon-report" placeholder="午後の詳細レポート・備考（印刷時に青文字で表示されます）"
                                style="width:100%;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;background:#ffffff;color:#000000;">
                        </div>
                    </div>
                    <!-- 夜間セクション -->
                    <div class="time-section night">
                        <div class="time-section-header">🌙 夜間</div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                            <input type="text" class="section-project night-project" placeholder="支店・現場名" list="project-suggestions" autocomplete="off"
                                style="flex:2;min-width:130px;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;background:#ffffff;color:#000000;">
                            <input type="text" class="section-detail night-detail" placeholder="作業内容・備考"
                                style="flex:3;min-width:180px;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;background:#ffffff;color:#000000;">
                        </div>
                        <div style="margin-top:6px; width:100%;">
                            <input type="text" class="section-report night-report" placeholder="夜間の詳細レポート・備考（印刷時に青文字で表示されます）"
                                style="width:100%;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;background:#ffffff;color:#000000;">
                        </div>
                    </div>
                    <input type="hidden" class="day-timeline-data" value="">
                    <input type="hidden" class="day-leave-type" value="">
                    <!-- 互換性のための非表示の全体レポートエリア -->
                    <div class="day-report-field" style="display:none;">
                        <textarea class="day-report-text"></textarea>
                    </div>
                    <!-- タイムライン -->
                    <div class="timeline-section" style="margin-top:8px;">
                        <div class="timeline-palette" style="display:flex;gap:4px;margin-bottom:4px;align-items:center;flex-wrap:wrap;">
                            <button type="button" class="palette-btn active" data-mode="1" style="padding:2px 10px;border:2px solid #000;border-radius:4px;font-size:0.8rem;font-weight:bold;cursor:pointer;background:#000;color:#fff;">■ 現場管理</button>
                            <button type="button" class="palette-btn" data-mode="5" style="padding:2px 10px;border:2px solid #2563eb;border-radius:4px;font-size:0.8rem;font-weight:bold;cursor:pointer;background:#fff;color:#2563eb;">▼ 現場管理以外の業務</button>
                            <button type="button" class="palette-btn" data-mode="2" style="padding:2px 10px;border:2px solid #ef4444;border-radius:4px;font-size:0.8rem;font-weight:bold;cursor:pointer;background:#fff;color:#ef4444;">● 休憩</button>
                            <button type="button" class="palette-btn" data-mode="3" style="padding:2px 10px;border:2px solid #16a34a;border-radius:4px;font-size:0.8rem;font-weight:bold;cursor:pointer;background:#fff;color:#16a34a;">▲ 移動</button>
                            <button type="button" class="palette-btn" data-mode="4" style="padding:2px 10px;border:2px solid #94a3b8;border-radius:4px;font-size:0.8rem;font-weight:bold;cursor:pointer;background:#fff;color:#94a3b8;">◆ 有休</button>
                            <button type="button" class="palette-btn" data-mode="0" style="padding:2px 10px;border:2px solid #94a3b8;border-radius:4px;font-size:0.8rem;font-weight:bold;cursor:pointer;background:#fff;color:#64748b;">× 消去</button>
                            <span class="timeline-hours-total-display" style="margin-left:auto;font-weight:bold;color:var(--primary);font-size:0.9rem;">作業計 0.0H</span>
                        </div>
                        <div class="timeline-hours-header" style="display:grid;grid-template-columns:repeat(24,1fr);font-size:0.65rem;color:var(--text-muted);padding:0 1px;"></div>
                        <div class="timeline-cells-grid" style="display:grid;grid-template-columns:repeat(48,1fr);gap:0;border:1px solid var(--border);border-radius:4px;overflow:hidden;height:28px;cursor:crosshair;touch-action:none;"></div>
                    </div>
                </div>
            `;
            daysContainer.appendChild(dayCard);
            const taskList = dayCard.querySelector('.task-list');
            
            // タイムライン初期化
            let stateArray = Array(48).fill(0);
            const timelineData = dayCard.querySelector('.day-timeline-data');
            const leaveTypeInput = dayCard.querySelector('.day-leave-type');
            const totalDisplay = dayCard.querySelector('.timeline-hours-total-display');
            const headerContainer = dayCard.querySelector('.timeline-hours-header');
            const cellsGrid = dayCard.querySelector('.timeline-cells-grid');
            const cellElements = [];
            
            // ヘッダーラベル（5〜翌4時 = 24時間）
            const TIMELINE_START_HOUR = 5;
            for (let h = 0; h < 24; h++) {
                const lbl = document.createElement('div');
                lbl.style.textAlign = 'center';
                lbl.textContent = (TIMELINE_START_HOUR + h) % 24;
                headerContainer.appendChild(lbl);
            }
            
            // タイムラインセル
            for (let i = 0; i < 48; i++) {
                const cell = document.createElement('div');
                cell.className = 'timeline-cell';
                cell.dataset.index = i;
                cell.dataset.state = 0;
                const hour = (TIMELINE_START_HOUR + Math.floor(i / 2)) % 24;
                const min = (i % 2 === 0) ? '00' : '30';
                cell.title = `${hour}:${min}`;
                cellsGrid.appendChild(cell);
                cellElements.push(cell);
            }
            
            const calculateTotal = () => {
                const workCount = stateArray.filter(s => s === 1 || s === 3 || s === 5).length;
                const totalHours = workCount * 0.5;
                const siteCount = stateArray.filter(s => s === 1).length;
                const siteHours = siteCount * 0.5;
                totalDisplay.textContent = `作業計 ${totalHours.toFixed(1)}H (現場従事 ${siteHours.toFixed(1)}H)`;
                dayCard.querySelector('.total-hours').textContent = `計 ${totalHours.toFixed(1)}H (現場従事 ${siteHours.toFixed(1)}H)`;
                timelineData.value = stateArray.join('');
                calculateWeekTotal();
            };
            
            let currentMode = 1;
            const paletteBtns = dayCard.querySelectorAll('.palette-btn');
            
            const updatePaletteStyles = () => {
                paletteBtns.forEach(btn => {
                    const mode = parseInt(btn.dataset.mode);
                    const isActive = mode === currentMode;
                    
                    if (mode === 1) { // 作業
                        btn.style.background = isActive ? '#000000' : '#ffffff';
                        btn.style.color = isActive ? '#ffffff' : '#000000';
                        btn.style.borderColor = '#000000';
                    } else if (mode === 2) { // 休憩
                        btn.style.background = isActive ? '#ef4444' : '#ffffff';
                        btn.style.color = isActive ? '#ffffff' : '#ef4444';
                        btn.style.borderColor = '#ef4444';
                    } else if (mode === 3) { // 移動
                        btn.style.background = isActive ? '#16a34a' : '#ffffff';
                        btn.style.color = isActive ? '#ffffff' : '#16a34a';
                        btn.style.borderColor = '#16a34a';
                    } else if (mode === 4) { // 有休
                        btn.style.background = isActive ? '#94a3b8' : '#ffffff';
                        btn.style.color = isActive ? '#ffffff' : '#94a3b8';
                        btn.style.borderColor = '#94a3b8';
                    } else if (mode === 5) { // 現場管理以外の業務
                        btn.style.background = isActive ? '#2563eb' : '#ffffff';
                        btn.style.color = isActive ? '#ffffff' : '#2563eb';
                        btn.style.borderColor = '#2563eb';
                    } else if (mode === 0) { // 消去
                        btn.style.background = isActive ? '#64748b' : '#ffffff';
                        btn.style.color = isActive ? '#ffffff' : '#64748b';
                        btn.style.borderColor = '#94a3b8';
                    }
                    
                    if (isActive) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }
                });
            };

            paletteBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    currentMode = parseInt(btn.dataset.mode);
                    updatePaletteStyles();
                });
            });
            
            updatePaletteStyles();
            
            let isDrawing = false;
            const updateCellState = (index) => {
                if (index < 0 || index >= 48) return;
                stateArray[index] = currentMode;
                cellElements[index].dataset.state = currentMode;
                calculateTotal();
            };
            cellsGrid.addEventListener('mousedown', (e) => { const cell = e.target.closest('.timeline-cell'); if (cell) { isDrawing = true; updateCellState(parseInt(cell.dataset.index)); } });
            cellsGrid.addEventListener('mousemove', (e) => { if (!isDrawing) return; const cell = e.target.closest('.timeline-cell'); if (cell) updateCellState(parseInt(cell.dataset.index)); });
            window.addEventListener('mouseup', () => { isDrawing = false; });
            cellsGrid.addEventListener('touchstart', (e) => { const touch = e.touches[0]; const t = document.elementFromPoint(touch.clientX, touch.clientY); const cell = t?.closest('.timeline-cell'); if (cell && cell.parentNode === cellsGrid) { isDrawing = true; updateCellState(parseInt(cell.dataset.index)); e.preventDefault(); } }, { passive: false });
            cellsGrid.addEventListener('touchmove', (e) => { if (!isDrawing) return; const touch = e.touches[0]; const t = document.elementFromPoint(touch.clientX, touch.clientY); const cell = t?.closest('.timeline-cell'); if (cell && cell.parentNode === cellsGrid) { updateCellState(parseInt(cell.dataset.index)); } e.preventDefault(); }, { passive: false });
            cellsGrid.addEventListener('touchend', () => { isDrawing = false; });
            
            // 休みボタン
            dayCard.querySelectorAll('.leave-quick-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const leaveType = btn.dataset.leave;
                    leaveTypeInput.value = leaveType;
                    // 入力欄だけを対象にする（ラベルやヘッダーはそのまま）
                    const allInputs = dayCard.querySelectorAll('.section-project, .section-detail, .day-report-text');
                    const timelinePalette = dayCard.querySelector('.timeline-palette');
                    if (leaveType) {
                        allInputs.forEach(el => { el.disabled = true; el.style.opacity = '0.4'; });
                        cellsGrid.style.opacity = '0.3'; cellsGrid.style.pointerEvents = 'none';
                        if (timelinePalette) { timelinePalette.style.opacity = '0.3'; timelinePalette.style.pointerEvents = 'none'; }
                        stateArray.fill(0);
                        cellElements.forEach(c => c.dataset.state = 0);
                        calculateTotal();
                        btn.classList.add('active');
                        dayCard.querySelectorAll('.leave-quick-btn').forEach(b => { if (b !== btn) b.classList.remove('active'); });
                    } else {
                        allInputs.forEach(el => { el.disabled = false; el.style.opacity = '1'; });
                        cellsGrid.style.opacity = '1'; cellsGrid.style.pointerEvents = 'auto';
                        if (timelinePalette) { timelinePalette.style.opacity = '1'; timelinePalette.style.pointerEvents = 'auto'; }
                        dayCard.querySelectorAll('.leave-quick-btn').forEach(b => b.classList.remove('active'));
                    }
                });
            });
            
            // 前日からコピー
            const copyPrevBtn = dayCard.querySelector('.btn-copy-prev');
            if (copyPrevBtn) {
                copyPrevBtn.addEventListener('click', () => {
                    const prevDayIdx = daysName.indexOf(day) - 1;
                    if (prevDayIdx < 0) return;
                    const prevDay = daysName[prevDayIdx];
                    const prevTaskList = document.querySelector(`.task-list[data-day="${prevDay}"]`);
                    if (!prevTaskList || !prevTaskList.getCardData) return;
                    const prevData = prevTaskList.getCardData();
                    if (!prevData.morning?.project && !prevData.afternoon?.project && !prevData.night?.project) {
                        alert('前日の作業データがありません。');
                        return;
                    }
                    if (!confirm('前日の内容をコピーしますか？')) return;
                    taskList.setCardData(prevData);
                });
            }
            
            // getCardData: この日のデータをオブジェクトで取得
            taskList.getCardData = () => {
                return {
                    morning: {
                        project: dayCard.querySelector('.morning-project')?.value.trim() || '',
                        detail: dayCard.querySelector('.morning-detail')?.value.trim() || '',
                        report: dayCard.querySelector('.morning-report')?.value.trim() || ''
                    },
                    afternoon: {
                        project: dayCard.querySelector('.afternoon-project')?.value.trim() || '',
                        detail: dayCard.querySelector('.afternoon-detail')?.value.trim() || '',
                        report: dayCard.querySelector('.afternoon-report')?.value.trim() || ''
                    },
                    night: {
                        project: dayCard.querySelector('.night-project')?.value.trim() || '',
                        detail: dayCard.querySelector('.night-detail')?.value.trim() || '',
                        report: dayCard.querySelector('.night-report')?.value.trim() || ''
                    },
                    timeline: timelineData.value,
                    leaveType: leaveTypeInput.value
                };
            };
            
            // setCardData: データを反映
            taskList.setCardData = (data) => {
                if (!data) return;
                const mp = dayCard.querySelector('.morning-project');
                const md = dayCard.querySelector('.morning-detail');
                const mr = dayCard.querySelector('.morning-report');
                const ap = dayCard.querySelector('.afternoon-project');
                const ad = dayCard.querySelector('.afternoon-detail');
                const ar = dayCard.querySelector('.afternoon-report');
                const np = dayCard.querySelector('.night-project');
                const nd = dayCard.querySelector('.night-detail');
                const nr = dayCard.querySelector('.night-report');
                
                if (mp) mp.value = data.morning?.project || '';
                if (md) md.value = data.morning?.detail || '';
                if (mr) mr.value = data.morning?.report || '';
                
                if (ap) ap.value = data.afternoon?.project || '';
                if (ad) ad.value = data.afternoon?.detail || '';
                if (ar) ar.value = data.afternoon?.report || '';
                
                if (np) np.value = data.night?.project || '';
                if (nd) nd.value = data.night?.detail || '';
                if (nr) nr.value = data.night?.report || '';
                
                // 過去データの互換性のための救済ロジック
                // もし新しい午前・午後・夜間のレポートがすべて空で、かつ非表示の textarea (過去の全体レポート) に値がある場合、
                // それを「午前レポート」に移行して表示させます。
                const oldReportVal = dayCard.querySelector('.day-report-text')?.value || '';
                if (oldReportVal && !data.morning?.report && !data.afternoon?.report && !data.night?.report) {
                    if (mr) mr.value = oldReportVal;
                }

                if (data.timeline && data.timeline.length === 48) {
                    stateArray = data.timeline.split('').map(Number);
                    cellElements.forEach((cell, i) => { cell.dataset.state = stateArray[i]; });
                    timelineData.value = data.timeline;
                }
                
                const leaveType = data.leaveType || '';
                leaveTypeInput.value = leaveType;
                
                const allInputs = dayCard.querySelectorAll('.section-project, .section-detail, .section-report, .day-report-text');
                const timelinePalette = dayCard.querySelector('.timeline-palette');
                
                // 休日ボタンの状態を更新
                dayCard.querySelectorAll('.leave-quick-btn').forEach(b => {
                    if (leaveType && b.dataset.leave === leaveType) {
                        b.classList.add('active');
                    } else {
                        b.classList.remove('active');
                    }
                });

                if (leaveType) {
                    allInputs.forEach(el => { el.disabled = true; el.style.opacity = '0.4'; });
                    cellsGrid.style.opacity = '0.3'; cellsGrid.style.pointerEvents = 'none';
                    if (timelinePalette) { timelinePalette.style.opacity = '0.3'; timelinePalette.style.pointerEvents = 'none'; }
                } else {
                    allInputs.forEach(el => { el.disabled = false; el.style.opacity = '1'; });
                    cellsGrid.style.opacity = '1'; cellsGrid.style.pointerEvents = 'auto';
                    if (timelinePalette) { timelinePalette.style.opacity = '1'; timelinePalette.style.pointerEvents = 'auto'; }
                }
                
                calculateTotal();
            };
            
            // 旧addTaskRow互換（旧データ読み込み用）
            taskList.addTaskRow = (projVal, detailVal, hoursVal, timelineVal) => {
                // 旧形式のデータを午前セクションに入力
                const mp = dayCard.querySelector('.morning-project');
                const md = dayCard.querySelector('.morning-detail');
                if (mp && !mp.value) mp.value = projVal || '';
                else {
                    const ap = dayCard.querySelector('.afternoon-project');
                    if (ap && !ap.value) ap.value = projVal || '';
                    else {
                        const np = dayCard.querySelector('.night-project');
                        if (np && !np.value) np.value = projVal || '';
                    }
                }
                if (md && !md.value) md.value = detailVal || '';
                else {
                    const ad = dayCard.querySelector('.afternoon-detail');
                    if (ad && !ad.value) ad.value = detailVal || '';
                    else {
                        const nd = dayCard.querySelector('.night-detail');
                        if (nd && !nd.value) nd.value = detailVal || '';
                    }
                }
                if (timelineVal && timelineVal.length === 48) {
                    for (let i = 0; i < 48; i++) {
                        const v = parseInt(timelineVal[i]);
                        if (v > 0 && stateArray[i] === 0) {
                            stateArray[i] = v;
                            cellElements[i].dataset.state = v;
                        }
                    }
                    timelineData.value = stateArray.join('');
                }
                calculateTotal();
            };
            taskList.clearAll = () => {
                dayCard.querySelector('.morning-project').value = '';
                dayCard.querySelector('.morning-detail').value = '';
                dayCard.querySelector('.afternoon-project').value = '';
                dayCard.querySelector('.afternoon-detail').value = '';
                dayCard.querySelector('.night-project').value = '';
                dayCard.querySelector('.night-detail').value = '';
                stateArray.fill(0);
                cellElements.forEach(c => c.dataset.state = 0);
                timelineData.value = '';
                leaveTypeInput.value = '';
                calculateTotal();
            };
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
                if (!taskList || !taskList.clearAll) return;
                taskList.clearAll();
                const dayLog = sourceReport.dailyLogs[day];
                if (dayLog) {
                    if (Array.isArray(dayLog)) {
                        dayLog.forEach(t => {
                            if (taskList.addTaskRow) taskList.addTaskRow(t.project || '', t.detail || '', t.hours || '', t.timeline || '');
                        });
                    } else if (typeof dayLog === 'object' && taskList.setCardData) {
                        taskList.setCardData(dayLog);
                    }
                }
                const reportText = taskList.closest('.day-card').querySelector('.day-report-text');
                if (reportText) {
                    reportText.value = (sourceReport.dailyReports && sourceReport.dailyReports[day]) ? sourceReport.dailyReports[day] : '';
                }
            });

            calculateWeekTotal();
            alert('コピーが完了しました！必要に応じて編集してください。');
        });
    }

    // 予定(Schedule)保存 - Firebase Firestore (非同期関数化)
    const saveScheduleForm = async () => {
        const companyId = currentCompany ? currentCompany.companyId : currentUser.email.split('@')[1];
        const schedId = document.getElementById('sched-id').value;
        let resolvedBranch = '';
        if (currentCompany && currentCompany.role === 'employee') {
            const myEmpInfo = currentCompany.employees ? currentCompany.employees.find(e => e.uid === currentUser.uid) : null;
            resolvedBranch = (myEmpInfo && myEmpInfo.branch) ? myEmpInfo.branch : '';
        } else {
            const ganttFilter = document.getElementById('gantt-branch-filter');
            resolvedBranch = ganttFilter ? ganttFilter.value : '';
        }

        const projectVal = document.getElementById('sched-project').value.trim();
        if (!projectVal) {
            alert('工事名を入力してください。');
            return false;
        }

        // 各種日付のチェック
        const p1Start = document.getElementById('sched-date-pedestal1-start').value;
        const p1End = document.getElementById('sched-date-pedestal1-end').value;
        if (p1Start && p1End && p1Start > p1End) { alert('柱脚工事①の終了日は開始日より後の日付にしてください。'); return false; }

        const p2Start = document.getElementById('sched-date-pedestal2-start').value;
        const p2End = document.getElementById('sched-date-pedestal2-end').value;
        if (p2Start && p2End && p2Start > p2End) { alert('柱脚工事②の終了日は開始日より後の日付にしてください。'); return false; }

        const e1Start = document.getElementById('sched-date-erection1-start').value;
        const e1End = document.getElementById('sched-date-erection1-end').value;
        if (e1Start && e1End && e1Start > e1End) { alert('鉄骨建て方①の終了日は開始日より後の日付にしてください。'); return false; }

        const e2Start = document.getElementById('sched-date-erection2-start').value;
        const e2End = document.getElementById('sched-date-erection2-end').value;
        if (e2Start && e2End && e2Start > e2End) { alert('鉄骨建て方②の終了日は開始日より後の日付にしてください。'); return false; }

        const rStart = document.getElementById('sched-date-roof-start').value;
        const rEnd = document.getElementById('sched-date-roof-end').value;
        if (rStart && rEnd && rStart > rEnd) { alert('屋根工事の終了日は開始日より後の日付にしてください。'); return false; }

        const wStart = document.getElementById('sched-date-wall-start').value;
        const wEnd = document.getElementById('sched-date-wall-end').value;
        if (wStart && wEnd && wStart > wEnd) { alert('外壁工事の終了日は開始日より後の日付にしてください。'); return false; }

        // 全体期間の自動決定（建て方①と建て方②を基準に自動算出）
        const resolvedStart = e1Start || e2Start || '';
        const resolvedEnd = e2End || e1End || '';

        // 現場住所（作業所住所を互換アドレスに格納）
        const workAddressVal = document.getElementById('sched-work-address').value.trim();

        const qtyVal = document.getElementById('sched-memo-qty').value.trim();
        const qtyHalf = toHalfWidth(qtyVal);
        if (qtyHalf && !/^[0-9]+(\.[0-9]+)?$/.test(qtyHalf)) {
            alert('数量は数字で入力してください。（例: 150）');
            return false;
        }

        const schedData = {
            companyId,
            project: projectVal,
            branch: resolvedBranch, // 判定した支店を自動設定
            author: document.getElementById('sched-author').value.trim(),
            start: resolvedStart,
            end: resolvedEnd,
            notes: document.getElementById('sched-notes').value.trim(),
            client: document.getElementById('sched-client').value.trim(),
            clientDirector: document.getElementById('sched-client-director').value.trim(),
            clientRep: document.getElementById('sched-client-rep').value.trim(),
            address: workAddressVal, // 互換性のため
            officeAddress: document.getElementById('sched-office-address').value.trim(),
            workAddress: workAddressVal,
            // 日付
            datePedestal1Start: p1Start,
            datePedestal1End: p1End,
            datePedestal2Start: p2Start,
            datePedestal2End: p2End,
            dateErection1Start: e1Start,
            dateErection1End: e1End,
            dateErection2Start: e2Start,
            dateErection2End: e2End,
            dateRoofStart: rStart,
            dateRoofEnd: rEnd,
            dateWallStart: wStart,
            dateWallEnd: wEnd,
            // 施工体制
            constPedestal1: document.getElementById('sched-const-pedestal1').value.trim(),
            constPedestal1Separate: document.getElementById('sched-const-pedestal1-separate').checked,
            constPedestal2: document.getElementById('sched-const-pedestal2').value.trim(),
            constPedestal2Separate: document.getElementById('sched-const-pedestal2-separate').checked,
            constFab1: document.getElementById('sched-const-fab1').value.trim(),
            constFab1Separate: document.getElementById('sched-const-fab1-separate').checked,
            constDrawing: document.getElementById('sched-const-drawing').value.trim(),
            constDrawingSeparate: document.getElementById('sched-const-drawing-separate').checked,
            constFab2: document.getElementById('sched-const-fab2').value.trim(),
            constFab2Separate: document.getElementById('sched-const-fab2-separate').checked,
            constErection: document.getElementById('sched-const-erection').value.trim(),
            constErectionSeparate: document.getElementById('sched-const-erection-separate').checked,
            constBolting: document.getElementById('sched-const-bolting').value.trim(),
            constBoltingSeparate: document.getElementById('sched-const-bolting-separate').checked,
            constDeck: document.getElementById('sched-const-deck').value.trim(),
            constDeckSeparate: document.getElementById('sched-const-deck-separate').checked,
            constStud: document.getElementById('sched-const-stud').value.trim(),
            constStudSeparate: document.getElementById('sched-const-stud-separate').checked,
            constWelding: document.getElementById('sched-const-welding').value.trim(),
            constWeldingSeparate: document.getElementById('sched-const-welding-separate').checked,
            constCrane: document.getElementById('sched-const-crane').value.trim(),
            constCraneSeparate: document.getElementById('sched-const-crane-separate').checked,

            subcontractor: document.getElementById('sched-subcontractor').value.trim(),
            memoQty: qtyHalf,
            salesRep: document.getElementById('sched-sales-rep').value,
            constRep: document.getElementById('sched-const-rep').value,
            siteRep: document.getElementById('sched-site-rep').value,
            chiefTech: document.getElementById('sched-chief-tech').value,
            assignType: "none",
            barColor: getBarColorForSiteRep(document.getElementById('sched-site-rep').value),
            barPattern: document.getElementById('sched-bar-pattern').value,
            completed: document.getElementById('sched-completed').checked,
            timestamp: new Date().toISOString()
        };

        try {
            if (schedId) {
                await updateDoc(doc(db, "schedules", schedId), schedData);
                alert('工事情報を更新しました！');
            } else {
                await addDoc(collection(db, "schedules"), schedData);
                alert('工事情報を登録しました！');
            }
            const msg = document.getElementById('sched-submit-message');
            if (msg) {
                msg.textContent = schedId ? '変更を保存しました！' : '予定を保存しました！';
                msg.classList.remove('hidden');
                setTimeout(() => msg.classList.add('hidden'), 3000);
            }
            
            // 編集モードを解除
            resetScheduleEditMode();
            
            // ガントチャートを再読み込み
            await loadSchedules();
            return true;
        } catch (error) {
            console.error("Error saving document: ", error);
            alert('保存に失敗しました。接続設定を確認してください。');
            return false;
        }
    };

    const schedForm = document.getElementById('schedule-form');
    if (schedForm) {
        schedForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const success = await saveScheduleForm();
            if (success) {
                // 自動で工程管理表（gantt-view）タブへ切り替える
                const ganttTabBtn = document.querySelector('.tab-btn[data-target="gantt-view"]');
                if (ganttTabBtn) {
                    ganttTabBtn.click();
                }
            }
        });
        schedForm.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
                e.preventDefault();
            }
        });
    }



    const schedCancelBtn = document.getElementById('sched-cancel-btn');
    if (schedCancelBtn) {
        schedCancelBtn.addEventListener('click', () => {
            resetScheduleEditMode();
            // 自動で工程管理表（gantt-view）タブへ切り替える
            const ganttTabBtn = document.querySelector('.tab-btn[data-target="gantt-view"]');
            if (ganttTabBtn) {
                ganttTabBtn.click();
            }
        });
    }

    // 日報(Report)保存 - Firebase Firestore
    const reportForm = document.getElementById('report-form');

    const saveReport = async (status, rejectReason = '') => {
        // すでに実績が承認済みの場合は上書き保存・再提出を禁止
        const weekInput = document.getElementById('week');
        const authorInput = document.getElementById('author');
        if (!weekInput || !authorInput) return;
        const weekVal = weekInput.value;
        const authorVal = authorInput.value;

        // 実績提出時の未来・今週期間内ブロック処理
        if (status === 'confirmed') {
            const days = getDaysOfWeek(weekVal);
            if (days) {
                const sunday = days[6];
                sunday.setHours(23, 59, 59, 999); // 週の最終日（日曜日）の23:59:59
                if (new Date() < sunday) {
                    alert('この週の期間が終了するまで実績の提出はできません。期間が終了した翌週の月曜日以降に提出してください。（入力中の実績は「下書き保存」で一時保存できます）');
                    return;
                }
            }
        }

        const existingReport = allReports.find(r => r.week === weekVal && r.author === authorVal);
        
        if (existingReport && existingReport.actualStatus === 'approved') {
            // 管理者が承認を取り消す（status === 'actual_rejected'）または実績承認更新（status === 'approved'）以外はブロック
            if (status !== 'actual_rejected' && status !== 'approved') {
                alert('この週報の実績はすでに承認されているため、再提出や編集はできません。');
                return;
            }
        }

        if (reportForm && !reportForm.checkValidity()) {
            reportForm.reportValidity();
            return;
        }

        // 工事名が「有給」「欠勤」「休日」以外のとき、作業時間が 0H のままであればエラーにする（実績確定または実績承認時のみ）
        let hasZeroHoursError = false;
        let errorDay = '';
        let errorProject = '';

        if (status === 'confirmed' || status === 'approved') {
            daysName.forEach(day => {
                const taskList = document.querySelector(`.task-list[data-day="${day}"]`);
                if (!taskList || !taskList.getCardData) return;
                const cardData = taskList.getCardData();
                const leaveType = cardData.leaveType || '';
                if (!leaveType) {
                    // 作業データがあるのにタイムラインが0の場合チェック
                    ['morning', 'afternoon', 'night'].forEach(t => {
                        const proj = cardData[t]?.project || '';
                        if (proj && !['有給', '欠勤', '休日'].includes(proj)) {
                            const timeline = cardData.timeline || '';
                            const workCount = timeline ? timeline.split('').filter(s => s === '1' || s === '3' || s === '5').length : 0;
                            if (workCount === 0) {
                                hasZeroHoursError = true;
                                errorDay = day;
                                errorProject = proj;
                            }
                        }
                    });
                }
            });

            if (hasZeroHoursError) {
                alert(`【${errorDay}曜日】の「${errorProject}」の作業時間が 0 時間になっています。\nタイムラインをドラッグして作業時間（黒いバー）を入力してください。`);
                return;
            }
        }

        const dailyLogs = {};
        daysName.forEach(day => {
            const taskList = document.querySelector(`.task-list[data-day="${day}"]`);
            if (taskList && taskList.getCardData) {
                dailyLogs[day] = taskList.getCardData();
            } else {
                dailyLogs[day] = { morning: {project:'',detail:''}, afternoon: {project:'',detail:''}, night: {project:'',detail:''}, timeline: '', leaveType: '' };
            }
        });

        const dailyReports = {};
        daysName.forEach(day => {
            const dayCard = document.querySelector(`.task-list[data-day="${day}"]`).closest('.day-card');
            if (dayCard) {
                const mrVal = dayCard.querySelector('.morning-report')?.value.trim() || '';
                const arVal = dayCard.querySelector('.afternoon-report')?.value.trim() || '';
                const nrVal = dayCard.querySelector('.night-report')?.value.trim() || '';
                
                // 従来の dailyReports にも午前・午後・夜間のレポートを改行区切りで結合して保存する（後方互換性のため）
                const reports = [];
                if (mrVal) reports.push(`【午前】${mrVal}`);
                if (arVal) reports.push(`【午後】${arVal}`);
                if (nrVal) reports.push(`【夜間】${nrVal}`);
                
                const combined = reports.join('\n');
                dailyReports[day] = combined;
                
                // 非表示の textarea にも反映しておく
                const hiddenText = dayCard.querySelector('.day-report-text');
                if (hiddenText) hiddenText.value = combined;
            } else {
                dailyReports[day] = '';
            }
        });

        const companyId = currentCompany ? currentCompany.companyId : currentUser.email.split('@')[1];
        // weekVal, authorVal, existingReport は関数の先頭で定義済みのものを再利用します

        const reportData = {
            companyId,
            week: weekVal,
            author: authorVal,
            dailyLogs,
            dailyReports,
            timestamp: new Date().toISOString()
        };

        // 既存レポートがある場合のステータス引き継ぎと初期化
        let planStatus = (existingReport && existingReport.planStatus) ? existingReport.planStatus : 'draft';
        let planRejectReason = (existingReport && existingReport.planRejectReason) ? existingReport.planRejectReason : '';
        let actualStatus = (existingReport && existingReport.actualStatus) ? existingReport.actualStatus : 'uncreated';
        let actualRejectReason = (existingReport && existingReport.actualRejectReason) ? existingReport.actualRejectReason : '';

        // 安全ガード: 既に実績が承認済なら、ロード段階で予定も承認済とみなす
        if (actualStatus === 'approved') {
            planStatus = 'approved';
        }

        // 実績ステータスの変更時に予定が承認済であることをバリデーション
        const isActualChange = ['draft', 'confirmed', 'approved', 'actual_rejected', 'actual_withdrawn'].includes(status);
        if (isActualChange && planStatus !== 'approved') {
            alert('予定が承認されていないため、実績の変更・提出はできません。先に予定を承認してもらってください。');
            return;
        }

        // 送られてきたstatusに応じて詳細なステータスへ変換
        if (status === 'plan') {
            planStatus = 'draft';
        } else if (status === 'plan_withdrawn') {
            planStatus = 'draft';
        } else if (status === 'plan_submitted') {
            planStatus = 'submitted';
        } else if (status === 'plan_approved') {
            planStatus = 'approved';
            reportData.planApprovedAt = new Date().toISOString();
            // 予定が承認された時点では、実績が既に別ステータス（提出済等）でない限り uncreated に保つ
            if (actualStatus !== 'submitted' && actualStatus !== 'approved' && actualStatus !== 'rejected') {
                actualStatus = 'uncreated';
            }
        } else if (status === 'plan_rejected') {
            planStatus = 'rejected';
            planRejectReason = rejectReason || '';
        } else if (status === 'draft') {
            actualStatus = 'draft';
        } else if (status === 'confirmed') {
            actualStatus = 'submitted';
        } else if (status === 'approved') {
            actualStatus = 'approved';
            reportData.actualApprovedAt = new Date().toISOString();
            reportData.approvedAt = new Date().toISOString();
            reportData.approvedBy = currentUser.displayName || currentUser.email.split('@')[0];
        } else if (status === 'actual_rejected') {
            actualStatus = 'rejected';
            actualRejectReason = rejectReason || '';
        } else if (status === 'actual_withdrawn') {
            actualStatus = 'draft';
        }

        reportData.planStatus = planStatus;
        reportData.planRejectReason = planRejectReason;
        reportData.actualStatus = actualStatus;
        reportData.actualRejectReason = actualRejectReason;

        // 後方互換性のためのstatusフィールドマッピング
        if (actualStatus === 'approved') {
            reportData.status = 'approved';
            if (!reportData.actualApprovedAt) {
                reportData.actualApprovedAt = new Date().toISOString();
            }
            reportData.approvedAt = new Date().toISOString();
            reportData.approvedBy = currentUser.displayName || currentUser.email.split('@')[0];
        } else if (actualStatus === 'submitted') {
            reportData.status = 'confirmed';
        } else {
            reportData.status = 'plan';
        }

        try {
            if (existingReport) {
                await updateDoc(doc(db, "reports", existingReport.id), reportData);
            } else {
                await addDoc(collection(db, "reports"), reportData);
            }

            if (status === 'plan_approved') {
                alert('予定を承認しました！');
            } else if (status === 'plan_rejected') {
                alert('予定を差し戻しました。');
            } else if (status === 'actual_rejected') {
                alert('実績を差し戻しました。');
            } else if (status === 'approved') {
                alert('実績（上長承認）を登録しました！');
            } else if (status === 'confirmed') {
                alert('実績を確定提出しました！');
            } else if (status === 'plan_submitted') {
                alert('予定を提出しました！');
            } else if (status === 'plan_withdrawn') {
                alert('予定の提出を取り消しました（下書き状態に戻しました）。');
            } else if (status === 'actual_withdrawn') {
                alert('実績の提出を取り消しました。');
            } else if (status === 'plan') {
                alert('予定を一時保存しました！');
            } else {
                alert('一時保存しました！');
            }
            await loadReports(false);
        } catch (error) {
            console.error("Error saving document: ", error);
            alert('保存に失敗しました。');
        }
    };

    if (reportForm) {
        reportForm.addEventListener('submit', (e) => {
            e.preventDefault();
        });
    }

    // データ読み込み（ガントチャート）
    const ganttYearSelect = document.getElementById('gantt-year');

    window.loadSchedules = async () => {
        try {
            const cid = currentCompany ? currentCompany.companyId : currentUser.email.split('@')[1];
            const q = query(collection(db, "schedules"), where("companyId", "==", cid));
            const querySnapshot = await getDocs(q);
            allSchedules = querySnapshot.docs.map(d => {
                const data = d.data();
                const sched = { id: d.id, ...data };
                // 過去データ互換（建て方①の日付が空の場合、start/endを建て方①にコピー）
                if (!sched.dateErection1Start && sched.start) {
                    sched.dateErection1Start = sched.start;
                    sched.dateErection1End = sched.end;
                }
                return sched;
            });
            renderGanttChart();
            updateProjectSuggestions();
        } catch (e) {
            console.error("Error loading schedules: ", e);
        }
    };

    const getSupplierGroupText = (s) => {
        const groups = [
            {
                label: '柱脚',
                items: [
                    { val: s.constPedestal1, sep: s.constPedestal1Separate },
                    { val: s.constPedestal2, sep: s.constPedestal2Separate }
                ]
            },
            {
                label: '製作',
                items: [
                    { val: s.constFab1, sep: s.constFab1Separate },
                    { val: s.constFab2, sep: s.constFab2Separate }
                ]
            },
            {
                label: '建て方本締め',
                items: [
                    { val: s.constErection, sep: s.constErectionSeparate },
                    { val: s.constBolting, sep: s.constBoltingSeparate }
                ]
            },
            {
                label: '床スタッド',
                items: [
                    { val: s.constDeck, sep: s.constDeckSeparate },
                    { val: s.constStud, sep: s.constStudSeparate }
                ]
            },
            {
                label: '現場溶接',
                items: [
                    { val: s.constWelding, sep: s.constWeldingSeparate }
                ]
            }
        ];

        const lines = [];
        groups.forEach(g => {
            const resolvedVals = [];
            g.items.forEach(item => {
                if (item.sep) {
                    resolvedVals.push('別途');
                } else if (item.val && item.val.trim() !== '') {
                    resolvedVals.push(item.val.trim());
                }
            });

            // 重複排除
            const uniqueVals = [...new Set(resolvedVals)];
            if (uniqueVals.length > 0) {
                lines.push(`${g.label}: ${uniqueVals.join(', ')}`);
            }
        });

        // 過去データの古い仕入先 (supplier1, supplier2, supplier3) を引き継いで表示
        const oldSuppliers = [s.supplier1, s.supplier2, s.supplier3]
            .map(val => typeof val === 'string' ? val.trim() : '')
            .filter(Boolean);
        if (oldSuppliers.length > 0) {
            lines.push(`旧仕入: ${oldSuppliers.join(', ')}`);
        }

        return lines;
    };

    const getGanttSupplierValues = (s) => {
        const resolveItems = (items) => {
            const vals = [];
            items.forEach(item => {
                if (item.sep) {
                    vals.push('別途');
                } else if (item.val && item.val.trim() !== '') {
                    vals.push(item.val.trim());
                }
            });
            return [...new Set(vals)].join('\n');
        };

        // 1. 柱脚
        let pedestal = resolveItems([
            { val: s.constPedestal1, sep: s.constPedestal1Separate },
            { val: s.constPedestal2, sep: s.constPedestal2Separate }
        ]);
        if (!pedestal && s.supplier1) {
            pedestal = s.supplier1.trim();
        }

        // 2. 製作
        let fab = resolveItems([
            { val: s.constFab1, sep: s.constFab1Separate },
            { val: s.constFab2, sep: s.constFab2Separate }
        ]);
        if (!fab) {
            const oldFabs = [s.supplier2, s.supplier3].map(v => v ? v.trim() : '').filter(Boolean);
            if (oldFabs.length > 0) {
                fab = [...new Set(oldFabs)].join('\n');
            }
        }

        // 3. 建て方本締め
        const erectionBolting = resolveItems([
            { val: s.constErection, sep: s.constErectionSeparate },
            { val: s.constBolting, sep: s.constBoltingSeparate }
        ]);

        // 4. 床スタッド
        const deckStud = resolveItems([
            { val: s.constDeck, sep: s.constDeckSeparate },
            { val: s.constStud, sep: s.constStudSeparate }
        ]);

        // 5. 現場溶接
        const welding = resolveItems([
            { val: s.constWelding, sep: s.constWeldingSeparate }
        ]);

        return {
            pedestal: pedestal || '-',
            fab: fab || '-',
            erectionBolting: erectionBolting || '-',
            deckStud: deckStud || '-',
            welding: welding || '-'
        };
    };

    const renderGanttChart = () => {
        const container = document.getElementById('gantt-container');
        if (!container || !ganttYearSelect) return;

        const selectedYear = parseInt(ganttYearSelect.value, 10);
        if (isNaN(selectedYear)) return;

        // 年度期間: 4月1日〜翌年3月31日
        const startStr = `${selectedYear}-04-01`;
        const endStr = `${selectedYear + 1}-03-31`;

        // 4/1から3/31までの日付リストを生成
        const dateList = [];
        const current = new Date(selectedYear, 3, 1); // 4月1日
        const end = new Date(selectedYear + 1, 2, 31); // 3月31日
        while (current <= end) {
            dateList.push(new Date(current));
            current.setDate(current.getDate() + 1);
        }

        // 支店フィルターの適用
        const ganttBranchFilter = document.getElementById('gantt-branch-filter');
        const selectedBranch = ganttBranchFilter ? ganttBranchFilter.value : '';
        let filteredSchedules = allSchedules;
        if (selectedBranch) {
            filteredSchedules = allSchedules.filter(s => !s.branch || s.branch === selectedBranch);
        }

        // 年度と重なるスケジュールを抽出
        const targetSchedules = filteredSchedules.filter(s => s.start <= endStr && s.end >= startStr);
        
        // 並び替え処理
        const ganttSortSelect = document.getElementById('gantt-sort');
        const sortType = ganttSortSelect ? ganttSortSelect.value : 'start-asc';

        if (sortType === 'start-asc') {
            targetSchedules.sort((a, b) => (a.start || '') > (b.start || '') ? 1 : ((a.start || '') < (b.start || '') ? -1 : ((a.project || '') > (b.project || '') ? 1 : -1)));
        } else if (sortType === 'start-desc') {
            targetSchedules.sort((a, b) => (a.start || '') < (b.start || '') ? 1 : ((a.start || '') > (b.start || '') ? -1 : ((a.project || '') > (b.project || '') ? 1 : -1)));
        } else if (sortType === 'project-asc') {
            targetSchedules.sort((a, b) => (a.project || '').localeCompare(b.project || '', 'ja'));
        } else if (sortType === 'client-asc') {
            targetSchedules.sort((a, b) => (a.client || '').localeCompare(b.client || '', 'ja'));
        } else if (sortType === 'sales-asc') {
            targetSchedules.sort((a, b) => (a.salesRep || '').localeCompare(b.salesRep || '', 'ja'));
        } else if (sortType === 'tech-asc') {
            targetSchedules.sort((a, b) => (a.chiefTech || '').localeCompare(b.chiefTech || '', 'ja'));
        } else if (sortType === 'const-asc') {
            targetSchedules.sort((a, b) => (a.constRep || '').localeCompare(b.constRep || '', 'ja'));
        } else if (sortType === 'site-asc') {
            targetSchedules.sort((a, b) => (a.siteRep || '').localeCompare(b.siteRep || '', 'ja'));
        } else if (sortType === 'createdAt-desc') {
            targetSchedules.sort((a, b) => (b.timestamp || b.createdAt || '') > (a.timestamp || a.createdAt || '') ? 1 : -1);
        }

        // 画面表示用に幅を設定し、PCでは画面幅に収め、スマホでは詳細幅があるため自動的にスクロール可能にします。
        container.style.width = '100%';
        container.style.minWidth = '100%';
        container.style.overflow = 'hidden';

        const wrapper = container.closest('.gantt-wrapper');
        if (wrapper) {
            wrapper.style.overflowX = 'auto';
            wrapper.style.width = '100%';
        }

        // 資格サマリーの動的生成
        let qualSummaryHtml = '';
        if (allMembers && allMembers.length > 0) {
            const list1stConst = [];
            const list1stCivil = [];
            const list2ndConstBody = [];
            const listPractical = [];

            // 選択されている支店でメンバーを絞り込む（空の場合は全メンバー）
            const branchFilteredMembers = selectedBranch 
                ? allMembers.filter(m => m.branch === selectedBranch)
                : allMembers;

            branchFilteredMembers.forEach(m => {
                const name = m.name || '';
                const quals = m.qualifications || [];
                
                // 専任区分のカッコ書き処理
                let nameWithDed = name;
                if (m.isDedicated === 'branch') {
                    nameWithDed += '（支店専任）';
                } else if (m.isDedicated === 'non_dedicated') {
                    nameWithDed += '（非専任）';
                }

                if (quals.includes('q1b')) list1stConst.push(nameWithDed);
                if (quals.includes('q1c')) list1stCivil.push(nameWithDed);
                if (quals.includes('q2b_躯体')) list2ndConstBody.push(nameWithDed);
                if (quals.includes('exp')) listPractical.push(nameWithDed);
            });

            qualSummaryHtml = `
                <div class="gantt-qual-panel">
                    <div style="display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 8px;">
                        <div style="flex: 1; min-width: 300px;">
                            <div style="margin-bottom: 2px;"><strong>≪1級建築≫</strong> ${list1stConst.join('・') || '-'} <span style="margin-left: 5px; font-weight: bold;">${list1stConst.length}名</span></div>
                            <div style="margin-bottom: 2px;"><strong>≪1級土木≫</strong> ${list1stCivil.join('・') || '-'} <span style="margin-left: 5px; font-weight: bold;">${list1stCivil.length}名</span></div>
                            <div style="display: flex; flex-wrap: wrap; gap: 20px;">
                                <div><strong>≪2級躯体≫</strong> ${list2ndConstBody.join('・') || '-'} <span style="margin-left: 5px; font-weight: bold;">${list2ndConstBody.length}名</span></div>
                                <div><strong>≪実務経験≫</strong> ${listPractical.join('・') || '-'} <span style="margin-left: 5px; font-weight: bold;">${listPractical.length}名</span></div>
                            </div>
                        </div>
                        <div style="font-weight: bold; font-size: 0.72rem; margin-top: 4px; padding-bottom: 2px; color: inherit;">
                            主任技術者の専任配置の要件：請負4500万円以上
                        </div>
                    </div>
                </div>
            `;
        }

        // 列定義: 左側詳細テーブル（15カラム、合計875px） + 右側カレンダー各日(1frで画面幅に収める)
        let html = qualSummaryHtml + `<div class="gantt-grid" style="grid-template-columns: 35px 90px 70px 70px 45px 45px 60px 60px 60px 45px 50px 60px 60px 65px 60px repeat(${dateList.length}, minmax(0, 1fr)); width: 100%; min-width: 100%;">`;

        // ==========================================
        // 行1: ヘッダー (左側：15個の詳細カラムヘッダー、右側：各月)
        // ==========================================
        // 左側のテーブル情報ヘッダーエリア（縦割り、sticky固定、並び替え版）
        html += `
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 1; font-size: 0.72rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 0px; z-index: 25;"></div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 2; font-size: 0.72rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 35px; z-index: 25;">工事名</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 3; font-size: 0.72rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 125px; z-index: 25;">元請</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 4; font-size: 0.72rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 195px; z-index: 25;">住所</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 5; font-size: 0.72rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 265px; z-index: 25;">柱脚</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 6; font-size: 0.72rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 310px; z-index: 25;">製作</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 7; font-size: 0.72rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 355px; z-index: 25; display: flex; flex-direction: column; justify-content: center; align-items: center; line-height: 1.1; padding: 2px;">建て方<br>本締め</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 8; font-size: 0.72rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 415px; z-index: 25; display: flex; flex-direction: column; justify-content: center; align-items: center; line-height: 1.1; padding: 2px;">床<br>スタッド</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 9; font-size: 0.72rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 475px; z-index: 25; display: flex; flex-direction: column; justify-content: center; align-items: center; line-height: 1.1; padding: 2px;">現場<br>溶接</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 10; font-size: 0.72rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 535px; z-index: 25;">数量</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 11; font-size: 0.72rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 580px; z-index: 25;">営業</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 12; font-size: 0.72rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 630px; z-index: 25;">技術者</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 13; font-size: 0.72rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 690px; z-index: 25;">工務</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 14; font-size: 0.72rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 750px; z-index: 25;">補助</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 15; font-size: 0.72rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; border-right: 2px solid var(--border) !important; position: sticky; left: 815px; z-index: 25;">現場</div>
        `;

        // カレンダー部 月ヘッダー (左側14列の次なので 15列目から開始)
        let startCol = 16;
        dateList.forEach((d, idx) => {
            const m = d.getMonth() + 1;
            const nextDate = dateList[idx + 1];
            const isLastDayOfMonth = !nextDate || nextDate.getMonth() !== d.getMonth();

            if (isLastDayOfMonth) {
                const endCol = idx + 17;
                const boundaryClass = !nextDate ? '' : 'month-boundary';
                html += `<div class="gantt-cell gantt-header-cell ${boundaryClass}" style="grid-row: 1; grid-column: ${startCol} / ${endCol}; font-weight: bold; font-size: 0.72rem; height: 35px; border-bottom: 2px solid #cbd5e1; display: flex; flex-direction: column; justify-content: center; align-items: center; line-height: 1.1; padding: 2px;">${m}<br>月</div>`;
                startCol = endCol;
            }
        });

        // ==========================================
        // データ行レンダリング
        // ==========================================

        targetSchedules.forEach((s, index) => {
            const rowIndex = index + 2; // ヘッダーが1行だけなので2行目から

            // 左側テーブルセル
            const completedBadge = s.completed ? '<span class="proj-card-completed-badge" style="background: #dcfce7; color: #15803d; padding: 1px 4px; border-radius: 4px; font-size: 0.7rem; font-weight: bold; margin-right: 5px; flex-shrink: 0;">完了</span>' : '';
            
            // 企業管理者のみ「編集」ボタンを表示
            const editBtnHtml = (currentCompany && currentCompany.role === 'admin') ?
                `<button class="btn btn-secondary btn-small btn-edit-schedule-v4" data-id="${s.id}" style="padding: 2px 6px; font-size: 0.72rem; line-height: 1; height: 18px; margin: 0; white-space: nowrap; background-color: var(--primary); color: white; border: none; border-radius: 4px; cursor: pointer; flex-shrink: 0;">編集</button>` : '';

            // 住所に作業所住所を設定
            const displayAddress = s.workAddress || s.address || '-';

            // 施工体制の5グループを解決
            const supVals = getGanttSupplierValues(s);

            html += `
                <!-- 0. 編集ボタン専用列 -->
                <div class="gantt-cell" style="grid-row: ${rowIndex}; grid-column: 1; text-align: center; justify-content: center; padding: 6px 2px; border-bottom: 1px solid var(--border); position: sticky; left: 0px; z-index: 15; background: var(--card-bg);">
                    ${editBtnHtml}
                </div>
                <!-- 1. 工事名 -->
                <div class="gantt-cell gantt-proj-cell" style="grid-row: ${rowIndex}; grid-column: 2; text-align: left; justify-content: flex-start; padding: 6px 4px; font-size: 0.72rem; border-bottom: 1px solid var(--border); position: sticky; left: 35px; z-index: 15; background: var(--card-bg);" title="${s.project || ''}">
                    <div style="display:flex; align-items:center; flex:1; text-align: left; margin-right: 1px;">
                        ${completedBadge}
                        <span class="proj-card-project" style="font-weight: bold; color: var(--text-main); font-size: 0.72rem; text-align: left;">${s.project || ''}</span>
                    </div>
                </div>
                <!-- 2. 元請 -->
                <div class="gantt-cell" style="grid-row: ${rowIndex}; grid-column: 3; text-align: left; justify-content: flex-start; padding: 4px 2px; font-size: 0.72rem; white-space: normal; word-break: break-all; line-height: 1.15; color: var(--primary); font-weight: bold; border-bottom: 1px solid var(--border); position: sticky; left: 125px; z-index: 15; background: var(--card-bg);" title="${s.client || ''}">
                    ${s.client || '-'}
                </div>
                <!-- 3. 住所 -->
                <div class="gantt-cell gantt-text-cell" style="grid-row: ${rowIndex}; grid-column: 4; text-align: left; justify-content: flex-start; padding: 6px 2px; font-size: 0.7rem; white-space: normal; word-break: break-all; border-bottom: 1px solid var(--border); position: sticky; left: 195px; z-index: 15; background: var(--card-bg);" title="住所: ${displayAddress}">
                    ${displayAddress}
                </div>
                <!-- 4. 柱脚 -->
                <div class="gantt-cell gantt-text-cell" style="grid-row: ${rowIndex}; grid-column: 5; text-align: left; justify-content: flex-start; padding: 4px 2px; font-size: 0.7rem; white-space: pre-line; word-break: break-all; line-height: 1.15; border-bottom: 1px solid var(--border); position: sticky; left: 265px; z-index: 15; background: var(--card-bg);" title="柱脚: &#10;${supVals.pedestal}">
                    ${supVals.pedestal}
                </div>
                <!-- 5. 製作 -->
                <div class="gantt-cell gantt-text-cell" style="grid-row: ${rowIndex}; grid-column: 6; text-align: left; justify-content: flex-start; padding: 4px 2px; font-size: 0.7rem; white-space: pre-line; word-break: break-all; line-height: 1.15; border-bottom: 1px solid var(--border); position: sticky; left: 310px; z-index: 15; background: var(--card-bg);" title="製作: &#10;${supVals.fab}">
                    ${supVals.fab}
                </div>
                <!-- 6. 建て方本締め -->
                <div class="gantt-cell gantt-text-cell" style="grid-row: ${rowIndex}; grid-column: 7; text-align: left; justify-content: flex-start; padding: 4px 2px; font-size: 0.7rem; white-space: pre-line; word-break: break-all; line-height: 1.15; border-bottom: 1px solid var(--border); position: sticky; left: 355px; z-index: 15; background: var(--card-bg);" title="建て方本締め: &#10;${supVals.erectionBolting}">
                    ${supVals.erectionBolting}
                </div>
                <!-- 7. 床スタッド -->
                <div class="gantt-cell gantt-text-cell" style="grid-row: ${rowIndex}; grid-column: 8; text-align: left; justify-content: flex-start; padding: 4px 2px; font-size: 0.7rem; white-space: pre-line; word-break: break-all; line-height: 1.15; border-bottom: 1px solid var(--border); position: sticky; left: 415px; z-index: 15; background: var(--card-bg);" title="床スタッド: &#10;${supVals.deckStud}">
                    ${supVals.deckStud}
                </div>
                <!-- 8. 現場溶接 -->
                <div class="gantt-cell gantt-text-cell" style="grid-row: ${rowIndex}; grid-column: 9; text-align: left; justify-content: flex-start; padding: 4px 2px; font-size: 0.7rem; white-space: pre-line; word-break: break-all; line-height: 1.15; border-bottom: 1px solid var(--border); position: sticky; left: 475px; z-index: 15; background: var(--card-bg);" title="現場溶接: &#10;${supVals.welding}">
                    ${supVals.welding}
                </div>
                <!-- 9. 数量 -->
                <div class="gantt-cell gantt-text-cell" style="grid-row: ${rowIndex}; grid-column: 10; text-align: right; justify-content: flex-end; padding: 4px 2px; font-size: 0.7rem; white-space: normal; word-break: break-all; line-height: 1.15; border-bottom: 1px solid var(--border); position: sticky; left: 535px; z-index: 15; background: var(--card-bg);" title="数量: ${s.memoQty || '-'}">
                    ${s.memoQty || '-'}
                </div>
                <!-- 10. 営業 -->
                <div class="gantt-cell" style="grid-row: ${rowIndex}; grid-column: 11; text-align: center; justify-content: center; padding: 4px 1px; font-size: 0.7rem; white-space: normal; word-break: break-all; line-height: 1.15; border-bottom: 1px solid var(--border); position: sticky; left: 580px; z-index: 15; background: var(--card-bg);" title="${s.salesRep || ''}">
                    ${s.salesRep || '-'}
                </div>
                <!-- 11. 技術者 -->
                <div class="gantt-cell" style="grid-row: ${rowIndex}; grid-column: 12; text-align: center; justify-content: center; padding: 4px 1px; font-size: 0.7rem; white-space: normal; word-break: break-all; line-height: 1.15; border-bottom: 1px solid var(--border); position: sticky; left: 630px; z-index: 15; background: var(--card-bg);" title="${s.chiefTech || ''}">
                    ${s.chiefTech || '-'}
                </div>
                <!-- 12. 工務 -->
                <div class="gantt-cell" style="grid-row: ${rowIndex}; grid-column: 13; text-align: center; justify-content: center; padding: 4px 1px; font-size: 0.7rem; white-space: normal; word-break: break-all; line-height: 1.15; border-bottom: 1px solid var(--border); position: sticky; left: 690px; z-index: 15; background: var(--card-bg);" title="${s.constRep || ''}">
                    ${s.constRep || '-'}
                </div>
                <!-- 13. 補助 -->
                <div class="gantt-cell gantt-text-cell" style="grid-row: ${rowIndex}; grid-column: 14; text-align: left; justify-content: flex-start; padding: 4px 2px; font-size: 0.7rem; white-space: normal; word-break: break-all; line-height: 1.15; border-bottom: 1px solid var(--border); position: sticky; left: 750px; z-index: 15; background: var(--card-bg);" title="補助: ${s.subcontractor || '-'}">
                    ${s.subcontractor || '-'}
                </div>
                <!-- 14. 現場 -->
                <div class="gantt-cell gantt-text-cell" style="grid-row: ${rowIndex}; grid-column: 15; text-align: center; justify-content: center; padding: 4px 1px; font-size: 0.7rem; white-space: normal; word-break: break-all; line-height: 1.15; border-bottom: 1px solid var(--border); border-right: 2px solid var(--border) !important; position: sticky; left: 815px; z-index: 15; background: var(--card-bg);" title="${s.siteRep || ''}">
                    ${s.siteRep || '-'}
                </div>
            `;
            // カレンダー部分の背景セル (罫線用)
            dateList.forEach((d, idx) => {
                const day = d.getDay();
                const isSat = day === 6 ? 'weekend-sat' : '';
                const isSun = day === 0 ? 'weekend-sun' : '';

                const nextDate = dateList[idx + 1];
                const isLastDay = !nextDate || nextDate.getMonth() !== d.getMonth();
                const boundaryClass = isLastDay ? 'month-boundary' : '';

                html += `<div class="gantt-bar-bg-cell ${isSat} ${isSun} ${boundaryClass}" style="grid-row: ${rowIndex}; grid-column: ${idx + 16};"></div>`;
            });

            // 工程バーの計算（文字列比較で安全に行い、日付のズレを防ぐ）
            const normalizeDateStr = (str) => {
                if (!str) return '';
                return str.replace(/\//g, '-');
            };

            const formatDateLocal = (date) => {
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const d = String(date.getDate()).padStart(2, '0');
                return `${y}-${m}-${d}`;
            };

            // 描画するバーの期間のリスト
            const barsToDraw = [];
            
            // 建て方①
            if (s.dateErection1Start && s.dateErection1End) {
                barsToDraw.push({
                    start: normalizeDateStr(s.dateErection1Start),
                    end: normalizeDateStr(s.dateErection1End),
                    label: '建て方①'
                });
            }
            // 建て方②
            if (s.dateErection2Start && s.dateErection2End) {
                barsToDraw.push({
                    start: normalizeDateStr(s.dateErection2Start),
                    end: normalizeDateStr(s.dateErection2End),
                    label: '建て方②'
                });
            }

            barsToDraw.forEach(barInfo => {
                const sStartStr = barInfo.start;
                const sEndStr = barInfo.end;
                
                const drawStartStr = sStartStr < startStr ? startStr : (sStartStr > endStr ? endStr : sStartStr);
                const drawEndStr = sEndStr > endStr ? endStr : (sEndStr < startStr ? startStr : sEndStr);

                const startIdx = dateList.findIndex(d => formatDateLocal(d) === drawStartStr);
                const endIdx = dateList.findIndex(d => formatDateLocal(d) === drawEndStr);

                if (startIdx !== -1 && endIdx !== -1) {
                    const gridStart = startIdx + 16;
                    const gridEnd = endIdx + 17;

                    const color = getBarColorForSiteRep(s.siteRep);
                    const patternClass = s.barPattern === 'stripe' ? 'pattern-stripe' : '';
                    const completedClass = s.completed ? 'completed-bar' : '';

                    const barText = '';

                    html += `<div class="gantt-bar ${patternClass} ${completedClass}" data-id="${s.id}" style="grid-row: ${rowIndex}; grid-column: ${gridStart} / ${gridEnd}; background-color: ${color};" title="【${s.project}】 (${barInfo.label})\n期間: ${barInfo.start} 〜 ${barInfo.end}\n備考: ${s.notes || 'なし'}">
                                ${barText}
                             </div>`;
                }
            });
        });

        if (targetSchedules.length === 0) {
            html += `<div style="grid-row: 2; grid-column: 1 / -1; padding: 25px; text-align: center; color: var(--text-muted); font-weight: bold;">選択年度の工程予定は登録されていません。</div>`;
        }

        html += `</div>`;
        container.innerHTML = html;

        // 印刷タイトル更新
        document.getElementById('print-gantt-title').textContent = `${selectedYear}年度 工程管理表`;

        // 工事の脇の「編集」ボタンクリックイベント
        container.querySelectorAll('.btn-edit-schedule-v4[data-id]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (currentCompany && currentCompany.role === 'admin') {
                    const schedId = btn.dataset.id;
                    const sched = allSchedules.find(s => s.id === schedId);
                    if (sched) {
                        startEditScheduleMode(sched);
                        // スケジュール入力タブ（工事登録タブ）に切り替える
                        const schedTabBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.dataset.target === 'schedule-input-view');
                        if (schedTabBtn) {
                            schedTabBtn.click();
                            // スムーズにフォームの一番上にスクロールさせる
                            setTimeout(() => {
                                const formEl = document.getElementById('schedule-form');
                                if (formEl) {
                                    formEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                }
                            }, 50);
                        }
                    }
                }
            });
        });
    };

    ganttYearSelect.addEventListener('change', renderGanttChart);
    const ganttBranchFilter = document.getElementById('gantt-branch-filter');
    if (ganttBranchFilter) {
        ganttBranchFilter.addEventListener('change', renderGanttChart);
    }
    const ganttSortSelect = document.getElementById('gantt-sort');
    if (ganttSortSelect) {
        ganttSortSelect.addEventListener('change', renderGanttChart);
    }

    // 工事名サジェスト（Datalist）の更新
    // 工事名（支店・現場名）サジェスト（Datalist）の更新
    const updateProjectSuggestions = () => {
        if (!currentUser) return;
        
        const projectSuggestions = new Set();
        
        // サジェストから除外する工事名・項目の判定関数
        const isExcludedProject = (proj) => {
            if (!proj) return true;
            const normalized = proj.trim();
            // 有給・有休、欠勤・休日・休み、本社、支店
            if (['有給', '暗黙', '有休', '欠勤', '休日', '休み', '本社', '支店'].includes(normalized)) {
                return true;
            }
            // 個別支店名（例：東京支店）も除外する
            if (normalized.endsWith('支店')) {
                return true;
            }
            return false;
        };
        
        // スケジュール（工事情報）から取得
        allSchedules.forEach(s => { 
            if (s.project && !isExcludedProject(s.project)) {
                projectSuggestions.add(s.project.trim()); 
            }
        });
        
        // ソートして「支店」「有休」を結合して最終候補とする
        const sortedProjects = Array.from(projectSuggestions).sort();
        
        const finalSuggestions = [
            ...sortedProjects,
            '支店',
            '有休'
        ];
        
        const datalist = document.getElementById('project-suggestions');
        if (datalist) {
            datalist.innerHTML = finalSuggestions
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
        // 確定済み(confirmed)またはステータス未定義の過去データのみをコピー対象とする
        const myReports = allReports.filter(r => {
            const actualStatus = r.actualStatus || (r.status === 'approved' ? 'approved' : r.status === 'confirmed' ? 'submitted' : r.status === 'plan' ? 'uncreated' : 'draft');
            return r.author === myName && (actualStatus === 'submitted' || actualStatus === 'approved');
        });
        myReports.sort((a, b) => (a.week < b.week ? 1 : -1)); // 降順
        
        select.innerHTML = '<option value="">過去の日報からコピーして作成...</option>';
        myReports.forEach((r, idx) => {
            select.innerHTML += `<option value="${idx}">${formatWeekRange(r.week)}</option>`;
        });
        select.dataset.reportsJson = JSON.stringify(myReports);
    };

    // リアルタイム購読の管理変数
    let reportsUnsubscribe = null;
    let prevReportStatuses = {};

    // データ読み込み（日報：リアルタイム同期版）
    window.loadReports = (isSummary = false) => {
        try {
            const cid = currentCompany ? currentCompany.companyId : currentUser.email.split('@')[1];
            const q = query(collection(db, "reports"), where("companyId", "==", cid));

            if (reportsUnsubscribe) {
                reportsUnsubscribe();
            }

            reportsUnsubscribe = onSnapshot(q, (querySnapshot) => {
                allReports = querySnapshot.docs.map(doc => {
                    const data = doc.data();
                    const actualStatus = data.actualStatus || (data.status === 'approved' ? 'approved' : data.status === 'confirmed' ? 'submitted' : data.status === 'plan' ? 'uncreated' : 'draft');
                    const planStatus = data.planStatus || 'draft';
                    if (actualStatus === 'approved' && planStatus !== 'approved') {
                        console.warn('Auto-correcting planStatus to approved for doc: ' + doc.id);
                        updateDoc(doc.ref, { 
                            planStatus: 'approved',
                            planApprovedAt: data.planApprovedAt || new Date().toISOString(),
                            actualStatus: 'approved',
                            actualApprovedAt: data.actualApprovedAt || new Date().toISOString()
                        }).catch(err => console.error(err));
                        return { 
                            id: doc.id, 
                            ...data, 
                            planStatus: 'approved', 
                            planApprovedAt: data.planApprovedAt || new Date().toISOString(),
                            actualStatus: 'approved', 
                            actualApprovedAt: data.actualApprovedAt || new Date().toISOString() 
                        };
                    }
                    return { id: doc.id, ...data };
                });
                
                // ステータス変更の検知とトースト通知
                allReports.forEach(r => {
                    // 自分自身の週報のみ通知する (一般社員の場合)
                    const isMyReport = currentUser && (r.author === currentUser.displayName || r.email === currentUser.email);
                    if (isMyReport) {
                        const key = `${r.week}`;
                        const prev = prevReportStatuses[key];
                        const currentPlanStatus = r.planStatus || 'draft';
                        const currentActualStatus = r.actualStatus || (r.status === 'plan' ? 'uncreated' : 'draft');
                        
                        if (prev) {
                            const weekRange = formatWeekRange(r.week);
                            // 予定ステータスの変更検知
                            if (prev.planStatus !== currentPlanStatus) {
                                if (currentPlanStatus === 'approved') {
                                    showToast(`🎉 ${weekRange} の【予定】が承認されました！`, 'success');
                                } else if (currentPlanStatus === 'rejected') {
                                    showToast(`⚠️ ${weekRange} の【予定】が差し戻されました。理由をご確認ください。`, 'warning', 8000);
                                } else if (currentPlanStatus === 'submitted') {
                                    showToast(`✉️ ${weekRange} の【予定】を提出しました。`, 'success');
                                }
                            }
                            // 実績ステータスの変更検知
                            if (prev.actualStatus !== currentActualStatus) {
                                if (currentActualStatus === 'approved') {
                                    showToast(`🎉 ${weekRange} の【実績】が承認されました！週報が確定しました。`, 'success');
                                } else if (currentActualStatus === 'rejected') {
                                    showToast(`⚠️ ${weekRange} の【実績】が差し戻されました。理由をご確認ください。`, 'warning', 8000);
                                } else if (currentActualStatus === 'submitted') {
                                    showToast(`✉️ ${weekRange} の【実績】を提出しました。`, 'success');
                                }
                            }
                        }
                        
                        // 状態を記憶
                        prevReportStatuses[key] = {
                            planStatus: currentPlanStatus,
                            actualStatus: currentActualStatus
                        };
                    }
                });

                updateFilterOptions();
                updateCopySelect();
                updateProjectSuggestions();
                if (isSummary) {
                    renderSummaryTable();
                } else {
                    renderTable();
                    // 現在選択されている週のレポートデータを再反映（入力ロックなどの状態変化を同期）
                    const weekInput = document.getElementById('week');
                    if (weekInput && weekInput.value) {
                        loadReportForSelectedWeek();
                    }
                }
            }, (err) => {
                console.error("Error in onSnapshot for reports:", err);
            });
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
            } else {
                const now = new Date();
                const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                if (months.includes(currentMonthStr)) {
                    summaryFilterMonth.value = currentMonthStr;
                } else if (months.length > 0) {
                    summaryFilterMonth.value = months[0];
                }
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

    // 催促通知を送信するAPI呼び出し
    const sendRemind = async (employeeUid, week, type, btnElement) => {
        if (!currentCompany) return;
        
        btnElement.disabled = true;
        btnElement.textContent = '送信中...';
        
        try {
            const baseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
                ? 'http://127.0.0.1:5005/weekly-report-93e5f/us-central1'
                : 'https://us-central1-weekly-report-93e5f.cloudfunctions.net';
                
            const response = await fetch(`${baseUrl}/sendRemindNotification`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    companyId: currentCompany.companyId,
                    employeeUid: employeeUid,
                    week: week,
                    type: type // 'plan' or 'actual'
                })
            });
            
            const result = await response.json();
            if (result.success) {
                btnElement.disabled = false; // disabledによるグレーアウトを回避
                btnElement.style.pointerEvents = 'none'; // クリック不可にする
                btnElement.textContent = '催促送信完了';
                btnElement.style.backgroundColor = '#16a34a';
                btnElement.style.color = '#ffffff';
                btnElement.style.borderColor = '#16a34a';
            } else {
                alert('催促送信に失敗しました: ' + (result.error || '不明なエラー'));
                btnElement.disabled = false;
                btnElement.textContent = '催促';
            }
        } catch (e) {
            console.error('Remind error:', e);
            alert('通信エラーが発生しました。');
            btnElement.disabled = false;
            btnElement.textContent = '催促';
        }
    };

    // 管理者用 催促パネルの描画
    const renderRemindPanel = () => {
        const container = document.getElementById('remind-panel-container');
        if (!container) return;
        
        if (!currentCompany || currentCompany.role !== 'admin') {
            container.style.display = 'none';
            return;
        }
        
        container.style.display = 'block';
        
        let weekSelect = document.getElementById('remind-week-select');
        if (!weekSelect) {
            const header = container.querySelector('h3');
            const selectWrapper = document.createElement('div');
            selectWrapper.style.margin = '10px 0 15px 0';
            selectWrapper.style.display = 'flex';
            selectWrapper.style.alignItems = 'center';
            selectWrapper.style.gap = '10px';
            selectWrapper.innerHTML = `
                <label for="remind-week-select" style="font-weight:bold;">表示対象週:</label>
                <select id="remind-week-select" style="padding:8px;font-size:0.9rem;border:1px solid var(--border);border-radius:6px;background:var(--card-bg);color:var(--text);"></select>
            `;
            header.after(selectWrapper);
            weekSelect = document.getElementById('remind-week-select');
            
            const mainWeekSelect = document.getElementById('week');
            if (mainWeekSelect) {
                Array.from(mainWeekSelect.options).forEach(opt => {
                    const newOpt = document.createElement('option');
                    newOpt.value = opt.value;
                    newOpt.textContent = opt.textContent;
                    newOpt.style.color = opt.style.color;
                    newOpt.style.fontWeight = opt.style.fontWeight;
                    weekSelect.appendChild(newOpt);
                });
                weekSelect.value = mainWeekSelect.value;
            }
            
            weekSelect.addEventListener('change', renderRemindPanel);
        }
        
        const targetWeek = weekSelect.value;
        if (!targetWeek) return;
        
        const listDiv = document.getElementById('remind-status-list');
        if (!listDiv) return;
        
        listDiv.innerHTML = '';
        
        const employees = currentCompany.employees || [];
        if (employees.length === 0) {
            listDiv.innerHTML = '<div style="grid-column: 1/-1; color: var(--text-muted); text-align: center; padding: 20px;">登録されている社員がいません。</div>';
            return;
        }
        
        employees.forEach(emp => {
            const report = allReports.find(r => r.week === targetWeek && (r.author === emp.name || r.authorEmail === emp.email));
            
            let planStatus = 'uncreated';
            let actualStatus = 'uncreated';
            let planRejectReason = '';
            let actualRejectReason = '';
            
            if (report) {
                planStatus = report.planStatus || 'draft';
                actualStatus = report.actualStatus || (report.status === 'approved' ? 'approved' : report.status === 'confirmed' ? 'submitted' : report.status === 'plan' ? 'uncreated' : 'draft');
                planRejectReason = report.planRejectReason || '';
                actualRejectReason = report.actualRejectReason || '';
            }
            
            const card = document.createElement('div');
            card.style.background = 'var(--card-bg)';
            card.style.border = '1px solid var(--border)';
            card.style.borderRadius = '8px';
            card.style.padding = '15px';
            card.style.display = 'flex';
            card.style.flexDirection = 'column';
            card.style.gap = '10px';
            
            const getStatusBadge = (status, rejectReason) => {
                let text = '未作成';
                let color = '#94a3b8';
                if (status === 'draft') {
                    text = '一時保存';
                    color = '#ea580c';
                } else if (status === 'submitted') {
                    text = '提出済';
                    color = '#2563eb';
                } else if (status === 'approved') {
                    text = '承認済';
                    color = '#16a34a';
                } else if (status === 'rejected') {
                    text = '差し戻し中';
                    color = '#dc2626';
                }
                
                let html = `<span style="background:${color}15;color:${color};border:1px solid ${color}30;padding:2px 6px;border-radius:4px;font-size:0.75rem;font-weight:bold;margin-left:5px;">${text}</span>`;
                if (status === 'rejected' && rejectReason) {
                    html += `<div style="font-size:0.75rem;color:#dc2626;margin-top:2px;">コメント: ${rejectReason}</div>`;
                }
                return html;
            };
            
            const getActionButton = (status, type) => {
                // 1. 未作成のときは催促ボタン
                if (status === 'uncreated') {
                    return `<button type="button" class="btn btn-secondary btn-small btn-remind" 
                                style="margin-left:auto;padding:2px 8px;font-size:0.75rem;background:#fee2e2;color:#dc2626;border:1px solid #fecaca;"
                                data-uid="${emp.uid}" data-type="${type}">催促</button>`;
                }
                
                // 2. 提出済のときは「承認する」ボタン
                if (status === 'submitted') {
                    return `<button type="button" class="btn btn-primary btn-small btn-view-report" 
                                style="margin-left:auto;padding:2px 8px;font-size:0.75rem;background:var(--primary-color,#2563eb);color:#fff;border:none;border-radius:4px;cursor:pointer;"
                                data-email="${emp.email}" data-name="${emp.name}" data-week="${targetWeek}">承認する</button>`;
                }
                
                // 3. 承認済のときのみ「詳細」ボタンを表示
                if (status === 'approved') {
                    return `<button type="button" class="btn btn-secondary btn-small btn-view-report" 
                                style="margin-left:auto;padding:2px 8px;font-size:0.75rem;background:#64748b;color:#fff;border:none;border-radius:4px;cursor:pointer;"
                                data-email="${emp.email}" data-name="${emp.name}" data-week="${targetWeek}">詳細</button>`;
                }
                
                // 4. 一時保存や提出済、差し戻し中はボタン不要
                return '';
            };
            
            card.innerHTML = `
                <div style="font-weight:bold;font-size:1rem;color:var(--text);border-bottom:1px solid var(--border);padding-bottom:5px;display:flex;justify-content:space-between;align-items:center;">
                    <div>👤 ${emp.name} <span style="font-size:0.75rem;color:var(--text-muted);font-weight:normal;">(${emp.branch || '所属なし'})</span></div>
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;font-size:0.85rem;">
                    <div style="display:flex;align-items:center;width:100%;">
                        <span>📅 予定:</span>
                        ${getStatusBadge(planStatus, planRejectReason)}
                        ${getActionButton(planStatus, 'plan')}
                    </div>
                    <div style="display:flex;align-items:center;width:100%;">
                        <span>✅ 実績:</span>
                        ${getStatusBadge(actualStatus, actualRejectReason)}
                        ${getActionButton(actualStatus, 'actual')}
                    </div>
                </div>
            `;
            
            card.querySelectorAll('.btn-remind').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const uid = e.target.dataset.uid;
                    const type = e.target.dataset.type;
                    sendRemind(uid, targetWeek, type, e.target);
                });
            });

            card.querySelectorAll('.btn-view-report').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const email = e.currentTarget.dataset.email;
                    const name = e.currentTarget.dataset.name;
                    const week = e.currentTarget.dataset.week;
                    openReportModal(name, email, week);
                });
            });
            
            listDiv.appendChild(card);
        });
    };

    const openReportModal = async (empName, empEmail, targetWeek) => {
        const modal = document.getElementById('report-modal');
        const modalBody = document.getElementById('modal-report-body');
        if (!modal || !modalBody) return;

        // モーダルのヘッダータイトルに社員名と対象週を動的にセット
        const modalTitle = document.getElementById('modal-title');
        if (modalTitle) {
            modalTitle.innerText = `📄 週報詳細・上長承認 (${empName} ｜ ${formatWeekRange(targetWeek)})`;
        }

        modalBody.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">読み込み中...</div>';
        modal.classList.remove('hidden');

        const btnClose = document.getElementById('btn-close-modal');
        if (btnClose) {
            btnClose.onclick = () => {
                modal.classList.add('hidden');
            };
        }

        const report = allReports.find(r => r.week === targetWeek && (r.author === empName || r.authorEmail === empEmail));

        if (!report) {
            modalBody.innerHTML = `
                <div style="text-align:center;padding:40px 20px;color:var(--text-muted);">
                    <div style="font-size:3rem;margin-bottom:15px;">📄</div>
                    <p style="font-size:1.1rem;font-weight:bold;margin-bottom:5px;">週報データが未作成です</p>
                    <p style="font-size:0.9rem;">${empName} の ${formatWeekRange(targetWeek)} の週報データはまだ一時保存もされていません。</p>
                </div>
            `;
            return;
        }

        const r = report;
        const dates = getDaysOfWeek(r.week);
        
                let printTasksHtml = '';
        daysName.forEach((day, idx) => {
            const ts = r.dailyLogs ? normalizeDailyTasks(r.dailyLogs[day]) : [];
            const dailyRep = (r.dailyReports && r.dailyReports[day]) ? r.dailyReports[day] : '';
            
            const dateLabel = `${dates ? formatDate(dates[idx]) : ''}<br>(${day})`;
            const rowSpan = ts.length || 1;

            if (ts.length > 0) {
                ts.forEach((t, tIdx) => {
                    const isFirst = tIdx === 0;
                    let rowHtml = '<tr>';
                    if (isFirst) {
                        rowHtml += `<td rowspan="${rowSpan}" style="text-align:center;font-weight:bold;white-space:nowrap;background:var(--bg-muted, #f8fafc);border:1px solid var(--border);padding:8px;vertical-align:middle;">${dateLabel}</td>`;
                    }
                    
                    // 午前/午後/夜間のバッジを表示
                    const badgeBg = t.period === 'morning' ? '#e0f2fe' : (t.period === 'afternoon' ? '#fef3c7' : '#f3e8ff');
                    const badgeColor = t.period === 'morning' ? '#0369a1' : (t.period === 'afternoon' ? '#b45309' : '#6b21a8');
                    const periodBadge = t.periodLabel ? `<span style="display:inline-block;padding:2px 6px;font-size:0.75rem;font-weight:bold;border-radius:4px;background:${badgeBg};color:${badgeColor};margin-right:8px;vertical-align:middle;">${t.periodLabel}</span>` : '';
                    
                    rowHtml += `
                        <td style="border:1px solid var(--border);padding:8px;vertical-align:middle;">${periodBadge}<span style="vertical-align:middle;">${t.project || ''}</span></td>
                        <td style="border:1px solid var(--border);padding:8px;vertical-align:middle;">${t.detail || ''}</td>
                        <td style="text-align:center;border:1px solid var(--border);padding:8px;white-space:nowrap;vertical-align:middle;">${parseFloat(t.hours||0).toFixed(1)}H</td>
                    `;
                    
                    if (isFirst) {
                        rowHtml += `<td rowspan="${rowSpan}" style="white-space: pre-wrap; font-size:0.85rem;border:1px solid var(--border);padding:8px;vertical-align:top;">${dailyRep || '-'}</td>`;
                    }
                    rowHtml += '</tr>';
                    printTasksHtml += rowHtml;
                });
            } else if (dailyRep) {
                printTasksHtml += `<tr>
                    <td style="text-align:center;font-weight:bold;white-space:nowrap;background:var(--bg-muted, #f8fafc);border:1px solid var(--border);padding:8px;vertical-align:middle;">${dateLabel}</td>
                    <td colspan="3" style="color: #64748b; font-style: italic; border:1px solid var(--border); padding:8px; text-align:center;vertical-align:middle;">作業記録なし</td>
                    <td style="white-space: pre-wrap; font-size:0.85rem; border:1px solid var(--border); padding:8px;vertical-align:top;">${dailyRep}</td>
                </tr>`;
            } else {
                printTasksHtml += `<tr>
                    <td style="text-align:center;font-weight:bold;white-space:nowrap;background:var(--bg-muted, #f8fafc);border:1px solid var(--border);padding:8px;vertical-align:middle;">${dateLabel}</td>
                    <td colspan="3" style="color: #cbd5e1; text-align:center; background:#f8fafc; border:1px solid var(--border); padding:8px;vertical-align:middle;">休み / 記録なし</td>
                    <td style="color:#cbd5e1; background:#f8fafc; text-align:center; border:1px solid var(--border); padding:8px;vertical-align:middle;">-</td>
                </tr>`;
            }
        });

        const cardEl = document.createElement('div');
        cardEl.className = 'print-report-card';
        cardEl.style.marginBottom = '0';
        cardEl.style.boxShadow = 'none';
        cardEl.style.border = 'none';

        cardEl.innerHTML = `
            <div class="print-report-header" style="background:var(--primary-color);color:#fff;border-radius:6px 6px 0 0;padding:12px 15px;font-weight:bold;font-size:1.1rem;display:flex;justify-content:space-between;">
                <div>対象期間: ${formatWeekRange(r.week)}</div>
                <div>担当者: ${r.author || ''}</div>
            </div>
            <div class="print-report-body" style="padding:20px;border:1px solid var(--border);border-top:none;border-radius:0 0 6px 6px;background:var(--card-bg);">
                <strong style="display:block;margin-bottom:12px;color:var(--text-main);font-size:1rem;">■ ${r.planStatus === 'approved' ? '業務実績' : '作業予定'}（日別詳細）</strong>
                <table class="print-task-table" style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                    <thead><tr><th style="background:var(--bg-muted);color:var(--text-main);padding:8px;border:1px solid var(--border);">日付(曜)</th><th style="background:var(--bg-muted);color:var(--text-main);padding:8px;border:1px solid var(--border);">工事名</th><th style="background:var(--bg-muted);color:var(--text-main);padding:8px;border:1px solid var(--border);">作業内容</th><th style="background:var(--bg-muted);color:var(--text-main);padding:8px;border:1px solid var(--border);">時間</th><th style="background:var(--bg-muted);color:var(--text-main);padding:8px;border:1px solid var(--border);">日次レポート・備考</th></tr></thead>
                    <tbody>${printTasksHtml || '<tr><td colspan="5" style="text-align:center; padding:10px; color:#64748b; border:1px solid var(--border);">記録なし</td></tr>'}</tbody>
                </table>
            </div>
        `;

        const planStatus = r.planStatus || 'draft';
        const actualStatus = r.actualStatus || (r.status === 'approved' ? 'approved' : r.status === 'confirmed' ? 'submitted' : r.status === 'plan' ? 'uncreated' : 'draft');
        const planRejectReason = r.planRejectReason || '';
        const actualRejectReason = r.actualRejectReason || '';

        const getStatusText = (status, rejectReason, isActual = false) => {
            if (status === 'draft') {
                return isActual 
                    ? '<span style="color:#ea580c;font-weight:bold;">未作成</span>' 
                    : '<span style="color:#ea580c;font-weight:bold;">一時保存</span>';
            }
            if (status === 'uncreated') return '<span style="color:#94a3b8;font-weight:bold;">未作成</span>';
            if (status === 'submitted') return '<span style="color:#2563eb;font-weight:bold;">提出済 (承認待ち)</span>';
            if (status === 'approved') return '<span style="color:#16a34a;font-weight:bold;">承認済み</span>';
            if (status === 'rejected') {
                let txt = '<span style="color:#dc2626;font-weight:bold;">差し戻し中</span>';
                if (rejectReason) txt += `<br><span style="font-size:0.8rem;color:#dc2626;">理由: ${rejectReason}</span>`;
                return txt;
            }
            return '未作成';
        };

        const adminPanel = document.createElement('div');
        adminPanel.className = 'admin-approval-panel no-print';
        adminPanel.style.marginTop = '20px';
        adminPanel.style.padding = '15px';
        adminPanel.style.background = 'var(--bg-muted, #f8fafc)';
        adminPanel.style.border = '1px dashed var(--primary-color)';
        adminPanel.style.borderRadius = '8px';

        const isPlanApproveDisabled = planStatus !== 'submitted';
        const isPlanRejectDisabled = planStatus !== 'submitted';
        const isActualApproveDisabled = actualStatus !== 'submitted' || planStatus !== 'approved';
        const isActualRejectDisabled = actualStatus !== 'submitted' || planStatus !== 'approved';

        adminPanel.innerHTML = `
            <h4 style="margin:0 0 12px 0; display:flex; align-items:center; gap:6px; color:var(--text-main);">🛡️ 上長承認操作パネル</h4>
            <div style="display:flex; flex-direction:column; gap:12px;">
                <div style="display:flex; align-items:center; gap:20px; flex-wrap:wrap; font-size:0.9rem;">
                    <div><strong>予定の状況:</strong> ${getStatusText(planStatus, planRejectReason, false)}</div>
                    <div style="display:flex; gap:8px;">
                        <button type="button" class="btn btn-primary btn-small btn-approve-plan" style="padding:4px 12px; font-size:0.8rem;" ${isPlanApproveDisabled ? 'disabled' : ''}>予定を承認</button>
                        <button type="button" class="btn btn-danger btn-small btn-reject-plan" style="padding:4px 12px; font-size:0.8rem;" ${isPlanRejectDisabled ? 'disabled' : ''}>予定を差し戻す</button>
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:20px; flex-wrap:wrap; font-size:0.9rem; border-top: 1px solid var(--border); padding-top: 12px;">
                    <div><strong>実績の状況:</strong> ${getStatusText(actualStatus, actualRejectReason, true)}</div>
                    <div style="display:flex; gap:8px;">
                        <button type="button" class="btn btn-primary btn-small btn-approve-actual" style="padding:4px 12px; font-size:0.8rem;" ${isActualApproveDisabled ? 'disabled' : ''}>実績を承認</button>
                        <button type="button" class="btn btn-danger btn-small btn-reject-actual" style="padding:4px 12px; font-size:0.8rem;" ${isActualRejectDisabled ? 'disabled' : ''}>実績を差し戻す</button>
                    </div>
                </div>
                
                <div class="reject-comment-area" style="display:none; flex-direction:column; gap:8px; border-top:1px solid var(--border); padding-top:12px;">
                    <label style="font-size:0.85rem; font-weight:bold; color:#dc2626;">差し戻し理由（コメント）</label>
                    <textarea class="txt-reject-reason" rows="3" placeholder="差し戻しの理由を入力してください..." style="width:100%; padding:8px; border:1px solid #fecaca; border-radius:6px; background:#fff5f5; color:#991b1b; font-size:0.85rem; resize:vertical;"></textarea>
                    <div style="display:flex; gap:8px; justify-content:flex-end;">
                        <button type="button" class="btn btn-secondary btn-small btn-cancel-reject" style="padding:4px 12px; font-size:0.8rem;">キャンセル</button>
                        <button type="button" class="btn btn-danger btn-small btn-submit-reject" style="padding:4px 12px; font-size:0.8rem; background:#dc2626; color:#fff; border:none;">差し戻しを確定</button>
                    </div>
                </div>
            </div>
        `;

        const btnApprovePlan = adminPanel.querySelector('.btn-approve-plan');
        btnApprovePlan.addEventListener('click', async () => {
            if (!confirm('予定を承認しますか？')) return;
            try {
                btnApprovePlan.disabled = true;
                await updateDoc(doc(db, "reports", r.id), {
                    planStatus: 'approved',
                    planApprovedAt: new Date().toISOString(),
                    planRejectReason: ''
                });
                alert('予定を承認しました。');
                modal.classList.add('hidden');
                await loadReports(false);
            } catch (err) {
                console.error(err);
                alert('エラーが発生しました。');
                btnApprovePlan.disabled = false;
            }
        });

        const btnApproveActual = adminPanel.querySelector('.btn-approve-actual');
        btnApproveActual.addEventListener('click', async () => {
            if (!confirm('実績を承認しますか？')) return;
            try {
                btnApproveActual.disabled = true;
                await updateDoc(doc(db, "reports", r.id), {
                    actualStatus: 'approved',
                    actualApprovedAt: new Date().toISOString(),
                    approvedAt: new Date().toISOString(),
                    actualRejectReason: '',
                    status: 'approved'
                });
                alert('実績を承認しました。');
                modal.classList.add('hidden');
                await loadReports(false);
            } catch (err) {
                console.error(err);
                alert('エラーが発生しました。');
                btnApproveActual.disabled = false;
            }
        });

        const rejectArea = adminPanel.querySelector('.reject-comment-area');
        const txtReason = adminPanel.querySelector('.txt-reject-reason');
        const btnCancelReject = adminPanel.querySelector('.btn-cancel-reject');
        const btnSubmitReject = adminPanel.querySelector('.btn-submit-reject');
        
        let activeRejectType = '';

        const showRejectArea = (type) => {
            activeRejectType = type;
            rejectArea.style.display = 'flex';
            txtReason.value = '';
            txtReason.focus();
        };

        adminPanel.querySelector('.btn-reject-plan').addEventListener('click', () => showRejectArea('plan'));
        adminPanel.querySelector('.btn-reject-actual').addEventListener('click', () => showRejectArea('actual'));

        btnCancelReject.addEventListener('click', () => {
            rejectArea.style.display = 'none';
            activeRejectType = '';
        });

        btnSubmitReject.addEventListener('click', async () => {
            const reason = txtReason.value.trim();
            if (!reason) {
                alert('差し戻し理由を入力してください。');
                return;
            }
            try {
                btnSubmitReject.disabled = true;
                const updateData = {};
                if (activeRejectType === 'plan') {
                    updateData.planStatus = 'rejected';
                    updateData.planRejectReason = reason;
                } else if (activeRejectType === 'actual') {
                    updateData.actualStatus = 'rejected';
                    updateData.actualRejectReason = reason;
                    updateData.status = 'plan';
                }
                
                await updateDoc(doc(db, "reports", r.id), updateData);
                alert('差し戻し処理が完了しました。');
                modal.classList.add('hidden');
                await loadReports(false);
            } catch (err) {
                console.error(err);
                alert('エラーが発生しました。');
                btnSubmitReject.disabled = false;
            }
        });

        cardEl.appendChild(adminPanel);
        modalBody.innerHTML = '';
        modalBody.appendChild(cardEl);
    };

    const renderTable = () => {
        const filterMonth = document.getElementById('filter-month').value;
        const filterAuthor = document.getElementById('filter-author').value;
        const filterBranchSelect = document.getElementById('filter-branch');
        const filterBranch = filterBranchSelect ? filterBranchSelect.value : '';
        const tbody = document.getElementById('reports-tbody');
        const printContainer = document.getElementById('print-details-container');
        const personalSummary = document.getElementById('personal-summary-container');
        const reportListContainer = document.getElementById('report-list-container');

        const filtered = allReports.filter(r => 
            (filterMonth === '' || getMonthStr(r.week) === filterMonth) && 
            (filterAuthor === '' || r.author === filterAuthor) &&
            (filterBranch === '' || getAuthorBranch(r.author) === filterBranch)
        );
        filtered.sort((a,b) => (a.week < b.week ? 1 : -1)); // 降順
        
        tbody.innerHTML = ''; printContainer.innerHTML = ''; if(personalSummary) personalSummary.innerHTML = ''; if(reportListContainer) reportListContainer.innerHTML = '';

        const authorProjectHours = {};

        filtered.forEach(r => {
            // 集計データの蓄積
            if (!authorProjectHours[r.author]) authorProjectHours[r.author] = {};
            const days = ['月','火','水','木','金','土','日'];
            days.forEach(day => {
                const ts = r.dailyLogs ? normalizeDailyTasks(r.dailyLogs[day]) : [];
                ts.forEach(t => {
                    if (t.project && !['有給', '有休', '欠勤', '休日'].includes(t.project)) {
                        authorProjectHours[r.author][t.project] = (authorProjectHours[r.author][t.project] || 0) + parseFloat(t.hours || 0);
                    }
                });
            });
            const tr = document.createElement('tr');
            const dates = getDaysOfWeek(r.week);
            const getDayLabel = (idx, name) => dates ? `${formatDate(dates[idx])}<br>(${name})` : name;
            const renderCell = (day) => {
                const ts = r.dailyLogs ? normalizeDailyTasks(r.dailyLogs[day]) : [];
                const tasksHtml = ts.map(t => `<div class="day-summary-cell"><strong>${t.project}</strong>${t.detail} (${parseFloat(t.hours||0).toFixed(1)}H)</div>`).join('');
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
                const ts = r.dailyLogs ? normalizeDailyTasks(r.dailyLogs[day]) : [];
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

            const cardEl = document.createElement('div');
            cardEl.className = 'print-report-card';
            cardEl.style.marginBottom = '25px';

            cardEl.innerHTML = `
                <div class="print-report-header">対象期間: ${formatWeekRange(r.week)} ｜ 担当者: ${r.author || ''}</div>
                <div class="print-report-body">
                    <strong>■ ${r.planStatus === 'approved' ? '業務実績' : '作業予定'}（日別詳細）</strong>
                    <table class="print-task-table">
                        <thead><tr><th>日付(曜)</th><th>工事名</th><th>作業内容</th><th>時間</th><th>日次レポート・備考</th></tr></thead>
                        <tbody>${printTasksHtml || '<tr><td colspan="5" style="text-align:center; padding:10px; color:#64748b;">記録なし</td></tr>'}</tbody>
                    </table>
                </div>
            `;

            // 印刷用カードの生成と追加 (承認パネルを含まないクリーンなプレビュー)
            const printCardEl = document.createElement('div');
            printCardEl.className = 'print-report-card';
            printCardEl.style.marginBottom = '25px';
            printCardEl.innerHTML = cardEl.innerHTML;
            printContainer.appendChild(printCardEl);

            // 管理者のみ承認パネルを表示
            if (currentCompany && currentCompany.role === 'admin') {
                const adminPanel = document.createElement('div');
                adminPanel.className = 'admin-action-card no-print';
                adminPanel.style = 'background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:15px; margin-top:15px; font-size:0.9rem; text-align:left; color:#000000;';
                
                const planStatus = r.planStatus || 'draft';
                const planRejectReason = r.planRejectReason || '';
                const actualStatus = r.actualStatus || (r.status === 'plan' ? 'uncreated' : 'draft');
                const actualRejectReason = r.actualRejectReason || '';

                const getStatusText = (status, rejectReason) => {
                    if (status === 'draft') return '<span style="color:#ea580c;font-weight:bold;">一時保存</span>';
                    if (status === 'uncreated') return '<span style="color:#94a3b8;font-weight:bold;">未作成</span>';
                    if (status === 'submitted') return '<span style="color:#2563eb;font-weight:bold;">提出済 (承認待ち)</span>';
                    if (status === 'approved') return '<span style="color:#16a34a;font-weight:bold;">承認済み</span>';
                    if (status === 'rejected') {
                        let txt = '<span style="color:#dc2626;font-weight:bold;">差し戻し中</span>';
                        if (rejectReason) txt += `<br><span style="font-size:0.8rem;color:#dc2626;">理由: ${rejectReason}</span>`;
                        return txt;
                    }
                    return '未作成';
                };

                const isPlanApproveDisabled = planStatus !== 'submitted';
                const isPlanRejectDisabled = planStatus !== 'submitted';
                const isActualApproveDisabled = (planStatus !== 'approved' || actualStatus !== 'submitted');
                const isActualRejectDisabled = (planStatus !== 'approved' || actualStatus !== 'submitted');
                
                adminPanel.innerHTML = `
                    <h4 style="margin:0 0 10px 0; color:#1e293b; display:flex; align-items:center; gap:6px; font-size:0.95rem; font-weight:bold;">🛡️ 上長承認操作パネル</h4>
                    <div style="display:flex; gap:20px; flex-wrap:wrap; margin-bottom:12px;">
                        <div style="flex:1; min-width:200px; padding:10px; background:#f1f5f9; border-radius:6px; border:1px solid #e2e8f0;">
                            <div style="margin-bottom:6px;"><strong>📅 予定の状況:</strong> ${getStatusText(planStatus, planRejectReason, false)}</div>
                            <div style="display:flex; gap:6px; margin-top:8px;">
                                <button type="button" class="btn btn-success btn-small btn-approve-plan" style="padding:4px 8px; font-size:0.75rem; background-color:#16a34a; color:#fff;" ${isPlanApproveDisabled ? 'disabled' : ''}>👍 承認</button>
                                <button type="button" class="btn btn-danger btn-small btn-reject-plan" style="padding:4px 8px; font-size:0.75rem; background-color:#ef4444; color:#fff;" ${isPlanRejectDisabled ? 'disabled' : ''}>👎 差し戻し</button>
                            </div>
                        </div>
                        <div style="flex:1; min-width:200px; padding:10px; background:#f1f5f9; border-radius:6px; border:1px solid #e2e8f0;">
                            <div style="margin-bottom:6px;"><strong>✅ 実績の状況:</strong> ${getStatusText(actualStatus, actualRejectReason, true)}</div>
                            <div style="display:flex; gap:6px; margin-top:8px;">
                                <button type="button" class="btn btn-success btn-small btn-approve-actual" style="padding:4px 8px; font-size:0.75rem; background-color:#16a34a; color:#fff;" ${isActualApproveDisabled ? 'disabled' : ''}>👍 承認</button>
                                <button type="button" class="btn btn-danger btn-small btn-reject-actual" style="padding:4px 8px; font-size:0.75rem; background-color:#ef4444; color:#fff;" ${isActualRejectDisabled ? 'disabled' : ''}>👎 差し戻し</button>
                            </div>
                        </div>
                    </div>
                    <!-- 差し戻し理由入力エリア (動的) -->
                    <div class="reject-input-area" style="display:none; margin-top:10px; border-top:1px dashed #cbd5e1; padding-top:10px;">
                        <label style="font-weight:bold; display:block; margin-bottom:6px; font-size:0.8rem; color:#dc2626;" class="reject-label-text">差し戻し理由</label>
                        <textarea class="reject-textarea" placeholder="差し戻しの理由を入力してください（社員画面に表示されます）" style="width:100%; height:60px; padding:8px; border-radius:6px; border:1px solid #cbd5e1; font-size:0.85rem; background:#fff; color:#000; resize:none;"></textarea>
                        <div style="display:flex; gap:8px; margin-top:8px; justify-content:flex-end;">
                            <button type="button" class="btn btn-secondary btn-small btn-cancel-reject" style="padding:4px 8px; font-size:0.75rem;">キャンセル</button>
                            <button type="button" class="btn btn-primary btn-small btn-submit-reject" style="padding:4px 8px; font-size:0.75rem; background-color:#2563eb; color:#fff;">差し戻しを確定</button>
                        </div>
                    </div>
                `;

                let activeRejectType = ''; // 'plan' or 'actual'

                const btnApprovePlan = adminPanel.querySelector('.btn-approve-plan');
                const btnRejectPlan = adminPanel.querySelector('.btn-reject-plan');
                const btnApproveActual = adminPanel.querySelector('.btn-approve-actual');
                const btnRejectActual = adminPanel.querySelector('.btn-reject-actual');
                const rejectArea = adminPanel.querySelector('.reject-input-area');
                const rejectLabel = adminPanel.querySelector('.reject-label-text');
                const rejectTextarea = adminPanel.querySelector('.reject-textarea');
                const btnCancelReject = adminPanel.querySelector('.btn-cancel-reject');
                const btnSubmitReject = adminPanel.querySelector('.btn-submit-reject');

                if (btnApprovePlan) {
                    btnApprovePlan.addEventListener('click', async () => {
                        if (!confirm(`${r.author}さんの予定を承認します。よろしいですか？`)) return;
                        try {
                            btnApprovePlan.disabled = true;
                            await updateDoc(doc(db, "reports", r.id), {
                                planStatus: 'approved',
                                planApprovedAt: new Date().toISOString(),
                                planRejectReason: ''
                            });
                            alert('予定を承認しました。');
                            await loadReports(false);
                        } catch (err) {
                            console.error('Approve plan error:', err);
                            alert('エラーが発生しました。');
                            btnApprovePlan.disabled = false;
                        }
                    });
                }

                if (btnApproveActual) {
                    btnApproveActual.addEventListener('click', async () => {
                        if (!confirm(`${r.author}さんの実績を承認します。よろしいですか？`)) return;
                        try {
                            btnApproveActual.disabled = true;
                            await updateDoc(doc(db, "reports", r.id), {
                                actualStatus: 'approved',
                                actualApprovedAt: new Date().toISOString(),
                                approvedAt: new Date().toISOString(),
                                actualRejectReason: '',
                                status: 'approved'
                            });
                            alert('実績を承認しました。');
                            await loadReports(false);
                        } catch (err) {
                            console.error('Approve actual error:', err);
                            alert('エラーが発生しました。');
                            btnApproveActual.disabled = false;
                        }
                    });
                }

                if (btnRejectPlan) {
                    btnRejectPlan.addEventListener('click', () => {
                        activeRejectType = 'plan';
                        rejectLabel.textContent = '予定の差し戻し理由';
                        rejectTextarea.value = '';
                        rejectArea.style.display = 'block';
                        rejectTextarea.focus();
                    });
                }

                if (btnRejectActual) {
                    btnRejectActual.addEventListener('click', () => {
                        activeRejectType = 'actual';
                        rejectLabel.textContent = '実績の差し戻し理由';
                        rejectTextarea.value = '';
                        rejectArea.style.display = 'block';
                        rejectTextarea.focus();
                    });
                }

                if (btnCancelReject) {
                    btnCancelReject.addEventListener('click', () => {
                        rejectArea.style.display = 'none';
                        activeRejectType = '';
                    });
                }

                if (btnSubmitReject) {
                    btnSubmitReject.addEventListener('click', async () => {
                        const reason = rejectTextarea.value.trim();
                        if (!reason) {
                            alert('差し戻し理由を入力してください。');
                            return;
                        }
                        try {
                            btnSubmitReject.disabled = true;
                            const updateData = {};
                            if (activeRejectType === 'plan') {
                                updateData.planStatus = 'rejected';
                                updateData.planRejectReason = reason;
                            } else if (activeRejectType === 'actual') {
                                updateData.actualStatus = 'rejected';
                                updateData.actualRejectReason = reason;
                                updateData.status = 'plan';
                            }
                            
                            await updateDoc(doc(db, "reports", r.id), updateData);
                            alert('差し戻し処理が完了しました。');
                            rejectArea.style.display = 'none';
                            await loadReports(false);
                        } catch (err) {
                            console.error('Reject error:', err);
                            alert('エラーが発生しました。');
                            btnSubmitReject.disabled = false;
                        }
                    });
                }

                cardEl.appendChild(adminPanel);
            }

            // 画面表示用コンテナへの自動追加は廃止 (モーダルでの個別表示に切り替えたため)
        });

        // 下部の個人別集計表を描画
        if (false && Object.keys(authorProjectHours).length > 0 && personalSummary) {
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
        renderRemindPanel();
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
            const modeText = summaryDisplayMode === 'site' ? '現場従事時間集計' : '作業時間集計';
            printTitle.textContent = `${year}年${month}月 工事別${modeText}`;
        }

        // 1. カレンダーヘッダーの生成
        let headHtml = `<tr>
            <th style="min-width: 120px; max-width: 120px; font-size: 0.8rem; background: #f1f5f9; position: sticky; left: 0; z-index: 10; padding: 6px 4px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">工事名</th>
            <th style="min-width: 80px; max-width: 80px; font-size: 0.8rem; background: #f1f5f9; position: sticky; left: 120px; z-index: 10; padding: 6px 4px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">担当者</th>`;
        
        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(year, month - 1, d);
            const dayOfWeekStr = ['日','月','火','水','木','金','土'][dateObj.getDay()];
            const isWeekend = (dateObj.getDay() === 0 || dateObj.getDay() === 6) ? 'color:red;' : '';
            headHtml += `<th style="min-width: 20px; max-width: 24px; text-align: center; font-size: 0.7rem; padding: 4px 1px; ${isWeekend}">${d}<br>${dayOfWeekStr}</th>`;
        }
        headHtml += `<th style="min-width: 50px; text-align: right; background: #f1f5f9; font-size: 0.8rem; padding: 6px 4px;">合計</th></tr>`;
        thead.innerHTML = headHtml;

        // 2. データ集計
        const projectMap = {};
        
        allReports.forEach(r => {
            // 実績承認済みのデータのみを集計対象とする（過去データとの互換性含む）
            const actualStatus = r.actualStatus || (r.status === 'approved' ? 'approved' : r.status === 'confirmed' ? 'submitted' : r.status === 'plan' ? 'uncreated' : 'draft');
            if (actualStatus !== 'approved') return;
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
                    const ts = r.dailyLogs ? normalizeDailyTasks(r.dailyLogs[day]) : [];
                    ts.forEach(t => {
                        if (!t.project || !t.hours) return;
                        const proj = t.project;
                        if (['有給', '有休', '欠勤', '休日'].includes(proj)) return;

                        // 工事別集計画面の支店フィルター
                        const summaryFilterBranchSelect = document.getElementById('summary-filter-branch');
                        const summaryFilterBranch = summaryFilterBranchSelect ? summaryFilterBranchSelect.value : '';
                        if (summaryFilterBranch && getProjectBranch(proj) !== summaryFilterBranch) {
                            return;
                        }

                        const auth = r.author || '不明';
                        
                        let hrs = 0;
                        if (t.timeline) {
                            if (summaryDisplayMode === 'site') {
                                // 現場従事時間（黒：現場管理のみ）
                                hrs = t.timeline.split('').filter(s => s === '1').length * 0.5;
                            } else {
                                // 合計時間（作業・移動・現場管理以外の業務）
                                hrs = t.timeline.split('').filter(s => s === '1' || s === '3' || s === '5').length * 0.5;
                            }
                        } else {
                            // タイムラインが存在しない過去データ等のフォールバック
                            if (summaryDisplayMode === 'site') {
                                hrs = 0;
                            } else {
                                hrs = parseFloat(t.hours || 0);
                            }
                        }
                        
                        if (hrs === 0) return;
                        
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
                
                bodyHtml += `<td style="font-weight: bold; background: #fff; position: sticky; left: 0; z-index: 5; border-right: 1px solid var(--border); font-size: 0.8rem; padding: 6px 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; max-width: 120px;">${proj}</td>`;
                bodyHtml += `<td style="background: #fff; position: sticky; left: 120px; z-index: 5; border-right: 1px solid var(--border); font-size: 0.8rem; padding: 6px 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; max-width: 80px;">${auth}</td>`;
                
                for (let d = 1; d <= daysInMonth; d++) {
                    const hrs = data.days[d];
                    const displayHrs = hrs ? hrs.toFixed(1) : '';
                    const style = hrs ? 'background-color: #f0fdf4; font-weight: bold; text-align: center;' : 'text-align: center; color: #cbd5e1;';
                    bodyHtml += `<td style="font-size: 0.72rem; padding: 4px 1px; ${style}">${hrs ? displayHrs : ''}</td>`;
                }
                
                bodyHtml += `<td style="text-align: right; font-weight: bold; color: var(--primary); background: #f8fafc; font-size: 0.8rem; padding: 6px 4px;">${data.total.toFixed(1)}H</td>`;
                bodyHtml += `</tr>`;
            });
        });
        
        tbody.innerHTML = bodyHtml;
    };

    ['filter-month', 'filter-author', 'filter-branch'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', renderTable);
    });
    ['summary-filter-month', 'summary-filter-branch'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', renderSummaryTable);
    });

    // 工事別集計の表示モード切り替えロジック
    let summaryDisplayMode = 'total'; // 'total' (合計) または 'site' (現場従事時間)
    const btnSummaryModeTotal = document.getElementById('btn-summary-mode-total');
    const btnSummaryModeSite = document.getElementById('btn-summary-mode-site');

    const updateSummaryModeButtons = () => {
        if (!btnSummaryModeTotal || !btnSummaryModeSite) return;
        if (summaryDisplayMode === 'total') {
            btnSummaryModeTotal.style.background = '#ffffff';
            btnSummaryModeTotal.style.color = '#0f172a';
            btnSummaryModeTotal.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
            
            btnSummaryModeSite.style.background = 'transparent';
            btnSummaryModeSite.style.color = '#64748b';
            btnSummaryModeSite.style.boxShadow = 'none';
        } else {
            btnSummaryModeSite.style.background = '#ffffff';
            btnSummaryModeSite.style.color = '#0f172a';
            btnSummaryModeSite.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
            
            btnSummaryModeTotal.style.background = 'transparent';
            btnSummaryModeTotal.style.color = '#64748b';
            btnSummaryModeTotal.style.boxShadow = 'none';
        }
    };

    // 初期化時のスタイル適用
    updateSummaryModeButtons();

    if (btnSummaryModeTotal) {
        btnSummaryModeTotal.addEventListener('click', () => {
            if (summaryDisplayMode === 'total') return;
            summaryDisplayMode = 'total';
            updateSummaryModeButtons();
            renderSummaryTable();
        });
    }
    if (btnSummaryModeSite) {
        btnSummaryModeSite.addEventListener('click', () => {
            if (summaryDisplayMode === 'site') return;
            summaryDisplayMode = 'site';
            updateSummaryModeButtons();
            renderSummaryTable();
        });
    }

    // 印刷ボタン処理（#print-active-areaを一時的に作成または再利用して印刷）
    const doPrint = (contentSourceId, titleText, isLandscape = false) => {
        // 既存の動的スタイルを削除
        const existingStyle = document.getElementById('print-dynamic-style');
        if (existingStyle) existingStyle.remove();

        // 印刷コンテンツを取得
        const sourceEl = document.getElementById(contentSourceId);
        if (!sourceEl) { window.print(); return; }

        // 横向き印刷用の@pageスタイルを動的に追加
        const style = document.createElement('style');
        style.id = 'print-dynamic-style';
        if (isLandscape) {
            style.innerHTML = '@media print { @page { size: A3 portrait !important; margin: 10mm !important; } }';
        } else {
            style.innerHTML = '@media print { @page { size: A4 portrait !important; margin: 10mm !important; } }';
        }
        document.head.appendChild(style);

        // #print-active-areaを取得、存在しなければ作成してbodyに追加
        // （印刷プレビュー生成中のDOM削除バグによるフリーズや白紙を防ぐため、JSでの削除は行わず常駐させ、通常時はCSSで非表示にする）
        let printArea = document.getElementById('print-active-area');
        if (!printArea) {
            printArea = document.createElement('div');
            printArea.id = 'print-active-area';
            document.body.appendChild(printArea);
        }
        // 中身を初期化
        printArea.innerHTML = '';
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
            clone.style.width = 'max-content'; // 横長グリッドが潰れないようにmax-contentにする
            
            // 子要素の gantt-grid のインラインスタイル width: 100% を max-content に上書きして、
            // 365日分のGridセルが極限まで押し潰されてブラウザが無限計算ループ（フリーズ）するのを防ぐ
            // さらに、grid-template-columns の 1fr を固定幅（24px）に書き換えて、無限ループ計算を完全に回避する
            const gridEl = clone.querySelector('.gantt-grid');
            if (gridEl) {
                gridEl.style.width = 'max-content';
                let origCols = gridEl.style.gridTemplateColumns;
                if (origCols) {
                    if (origCols.startsWith('35px ')) {
                        origCols = origCols.substring(5);
                        clone.querySelectorAll('.gantt-cell, .gantt-bar, .gantt-bar-bg-cell').forEach(cell => {
                            try {
                                const gridCol = cell.style.gridColumn;
                                if (gridCol) {
                                    const trimCol = gridCol.trim();
                                    if (trimCol === '1' || trimCol.startsWith('1 /') || trimCol.startsWith('1/')) {
                                        cell.remove();
                                    } else {
                                        const parts = trimCol.split('/');
                                        const newCol = parts.map(p => {
                                            const val = parseInt(p.trim());
                                            return isNaN(val) ? p : (val - 1).toString();
                                        }).join(' / ');
                                        cell.style.gridColumn = newCol;
                                        const leftVal = cell.style.left;
                                        if (leftVal && typeof leftVal === 'string' && leftVal.endsWith('px')) {
                                            const px = parseInt(leftVal);
                                            if (!isNaN(px)) {
                                                cell.style.left = `${px - 35}px`;
                                            }
                                        }
                                    }
                                }
                            } catch (e) {
                                console.error("Error shifting print cell:", e, cell);
                            }
                        });
                    }
                    gridEl.style.gridTemplateColumns = origCols.replace(/minmax\(0,\s*1fr\)/g, '1px').replace(/1fr/g, '1px');
                }
            }
            
            clone.style.fontSize = '8pt';
            // sticky固定が印刷時に崩れる原因となるため、全セルのpositionをstaticに戻す
            clone.querySelectorAll('th, td, .gantt-cell').forEach(el => {
                el.style.position = 'static';
                el.style.zIndex = 'auto';
            });
        }
        
        printArea.appendChild(clone);

        // レイアウトの計算を強制的に即時実行させる (Force Reflow)
        const forceReflow = printArea.offsetHeight;

        // スタイル適用とレンダリングのための十分なウェイトを挟んでから印刷を実行
        // 巨大なDOMの描画を確実に完了させて白紙プレビューを防ぐため、遅延を 800ms に設定
        setTimeout(() => {
            window.print();
            // 印刷プレビュー表示後のsetTimeout削除処理は廃止（CSSで通常時は非表示にされるため安全）
        }, 800);
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

    // 週間行動予定表（A4縦）の印刷処理
    const printWeeklyReport = () => {
        const weekInput = document.getElementById('week');
        const authorInput = document.getElementById('author');
        if (!weekInput || !authorInput) return;
        
        const weekVal = weekInput.value;
        const weekText = weekInput.options[weekInput.selectedIndex]?.text || '';
        const authorVal = authorInput.value;
        
        // 承認状態と日付の取得
        const existingReport = allReports.find(r => r.week === weekVal && r.author === authorVal);
        let isPlanApproved = false;
        let planApprovedDateStr = '';
        let isActualApproved = false;
        let actualApprovedDateStr = '';

        if (existingReport) {
            const pStatus = existingReport.planStatus || (existingReport.status === 'approved' ? 'approved' : 'draft');
            isPlanApproved = pStatus === 'approved';
            if (isPlanApproved && existingReport.planApprovedAt) {
                const pDate = new Date(existingReport.planApprovedAt);
                planApprovedDateStr = `${pDate.getMonth() + 1}/${pDate.getDate()}`;
            } else if (isPlanApproved) {
                const now = new Date();
                planApprovedDateStr = `${now.getMonth() + 1}/${now.getDate()}`;
            }

            const aStatus = existingReport.actualStatus || (existingReport.status === 'approved' ? 'approved' : 'draft');
            isActualApproved = aStatus === 'approved';
            if (isActualApproved && (existingReport.actualApprovedAt || existingReport.approvedAt)) {
                const aDate = new Date(existingReport.actualApprovedAt || existingReport.approvedAt);
                actualApprovedDateStr = `${aDate.getMonth() + 1}/${aDate.getDate()}`;
            } else if (isActualApproved) {
                const now = new Date();
                actualApprovedDateStr = `${now.getMonth() + 1}/${now.getDate()}`;
            }
        }
        
        // 画面の入力内容を収集
        const daysData = {};
        daysName.forEach(day => {
            const taskList = document.querySelector(`.task-list[data-day="${day}"]`);
            const dayCard = taskList ? taskList.closest('.day-card') : null;
            if (!dayCard) return;
            const cardData = taskList.getCardData ? taskList.getCardData() : {};
            const tasks = [];
            
            const fullTimeline = cardData.timeline || '0'.repeat(48);
            
            // 午前(morning): 5:00〜12:00 (インデックス 0〜13)
            // 午後(afternoon): 12:00〜18:00 (インデックス 14〜25)
            // 夜間(night): 18:00〜翌5:00 (インデックス 26〜47)
            const periodTimeline = (period) => {
                let start = 0;
                let end = 48;
                if (period === 'morning') {
                    start = 0;
                    end = 14;
                } else if (period === 'afternoon') {
                    start = 14;
                    end = 26;
                } else if (period === 'night') {
                    start = 26;
                    end = 48;
                }
                const prefix = '0'.repeat(start);
                const body = fullTimeline.substring(start, end);
                const suffix = '0'.repeat(48 - end);
                return prefix + body + suffix;
            };
            
            const hasLeave = !!cardData.leaveType;

            ['morning', 'afternoon', 'night'].forEach(period => {
                const proj = cardData[period]?.project || '';
                const det = cardData[period]?.detail || '';
                const rep = cardData[period]?.report || '';
                if (proj || det || rep) {
                    const taskTimeline = periodTimeline(period);
                    // 各時間帯ごとの作業・移動コマから作業時間を計算
                    const periodWorkHours = taskTimeline.split('').filter(s => s === '1' || s === '3' || s === '5').length * 0.5;
                    tasks.push({ 
                        project: proj, 
                        detail: det, 
                        report: rep,
                        hours: periodWorkHours, 
                        timeline: taskTimeline 
                    });
                }
            });
            
            if (hasLeave) {
                tasks.push({ project: cardData.leaveType, detail: '', report: '', hours: 0, timeline: '' });
            }
            
            const tl = cardData.timeline || '';
            const mr = dayCard.querySelector('.morning-report')?.value.trim() || '';
            const ar = dayCard.querySelector('.afternoon-report')?.value.trim() || '';
            const nr = dayCard.querySelector('.night-report')?.value.trim() || '';
            const reports = [];
            if (mr) reports.push(`【午前】${mr}`);
            if (ar) reports.push(`【午後】${ar}`);
            if (nr) reports.push(`【夜間】${nr}`);
            const reportText = reports.join('\n');
            daysData[day] = { tasks, reportText, timeline: tl };
        });
        
        const dates = getDaysOfWeek(weekVal);
        const formatPrintDate = (dateObj, dayName) => {
            if (!dateObj) return `${dayName}曜日`;
            return `${dateObj.getMonth() + 1}月${dateObj.getDate()}日<br>(${dayName})`;
        };
        
        let html = `<div class="weekly-print-wrapper">`;
        
        // ヘッダー（A4印刷フォーマット）
        html += `
        <div class="weekly-print-header">
            <div style="width: 200px; display: flex; flex-direction: column; gap: 4px;">
                <span style="font-size: 8.5pt; font-weight: bold; border: 1px solid #000; padding: 2px 6px; width: fit-content;">WF申請</span>
            </div>
            <div class="weekly-print-title">週間行動予定表（工事管理課）</div>
            <div>
                <table class="approval-table">
                    <thead>
                        <tr>
                            <th>&#x4E88;&#x5B9A;</th>
                            <th>&#x5B9F;&#x7E3E;</th>
                            <th>&#x62C5;&#x5F53;&#x8005;</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>
                                ${isPlanApproved ? `<div class="stamp-approved">&#x4E0A;&#x9577;<br><span>${planApprovedDateStr}</span></div>` : ''}
                            </td>
                            <td>
                                ${isActualApproved ? `<div class="stamp-approved">&#x4E0A;&#x9577;<br><span>${actualApprovedDateStr}</span></div>` : ''}
                            </td>
                            <td style="padding: 0; text-align: center; vertical-align: middle;">
                                <div style="font-weight: bold; font-size: 8pt; writing-mode: vertical-rl; text-align: center; letter-spacing: 0.5px; white-space: nowrap; line-height: 1.1; margin: 0 auto; display: inline-block;">
                                    ${(authorVal || '').replace(/\s+/g, '').substring(0, 5)}
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
        `;
        
        // サブヘッダー（対象週と凡例）
        html += `
        <div class="weekly-print-subheader">
            <div style="font-size: 9pt;">対象週: ${weekText} (${formatWeekRange(weekVal)})</div>
            <div class="legend-box">
                <div class="legend-item">
                    <span class="legend-color" style="background: #000000;"></span>
                    <span>現場管理</span>
                </div>
                <div class="legend-item">
                    <span class="legend-color" style="background: #2563eb;"></span>
                    <span>現場管理以外の業務</span>
                </div>
                <div class="legend-item">
                    <span class="legend-color" style="background: #ef4444;"></span>
                    <span>休憩</span>
                </div>
                <div class="legend-item">
                    <span class="legend-color" style="background: #16a34a;"></span>
                    <span>移動</span>
                </div>
                <div class="legend-item">
                    <span class="legend-color" style="background: #94a3b8;"></span>
                    <span>有休</span>
                </div>
            </div>
        </div>
        `;
        
        // 各曜日のデータ出力
        daysName.forEach((day, idx) => {
            const dayObj = daysData[day];
            const tasks = dayObj.tasks;
            const reportText = dayObj.reportText;
            const dateObj = dates ? dates[idx] : null;
            
            const isWeekend = day === '土' || day === '日';
            const isSlimDay = isWeekend && tasks.length === 0 && !reportText;
            const blockClass = isSlimDay ? 'print-day-block print-day-block-slim' : 'print-day-block';
            html += `<div class="${blockClass}">`;
            
            // テーブル
            html += `
            <table class="print-day-table">
                <thead>
                    <tr>
                        <th class="col-date">日時</th>
                        <th class="col-project">訪問先</th>
                        <th class="col-time">時間</th>
                        <th class="col-direct">直行直帰</th>
                        <th class="col-detail">記録</th>
                    </tr>
                </thead>
                <tbody>
            `;
            
            if (tasks.length === 0) {
                html += `
                    <tr>
                        <td class="col-date">${formatPrintDate(dateObj, day)}</td>
                        <td class="col-project">-</td>
                        <td class="col-time">-</td>
                        <td class="col-direct"></td>
                        <td class="col-detail" style="text-align: left; white-space: pre-wrap; font-size: 8.5pt; color: #2563eb;">${reportText || ''}</td>
                    </tr>
                `;
            } else {
                tasks.forEach((task, tIdx) => {
                    const timeIntervals = getTimelineIntervals(task.timeline);
                    const timeStr = timeIntervals.join('<br>') || (task.hours > 0 ? `${parseFloat(task.hours).toFixed(1)}H` : '-');
                    
                    let detailContent = task.detail || '';
                    
                    // 有休や休日などの休暇タスクでなく、かつその時間帯のレポートが存在する場合に適用
                    const isLeaveTask = ['有給', '有休', '欠勤', '休日'].includes(task.project);
                    if (!isLeaveTask && task.report) {
                        detailContent += `<div style="font-size: 8pt; color: #2563eb; margin-top: 4px; border-top: 1px dashed #94a3b8; padding-top: 3px; text-align: left; white-space: pre-wrap;">${task.report}</div>`;
                    }
                    
                    html += `
                        <tr>
                            ${tIdx === 0 ? `<td class="col-date" rowspan="${tasks.length}">${formatPrintDate(dateObj, day)}</td>` : ''}
                            <td class="col-project" style="text-align: left; font-weight: bold;">${task.project || ''}</td>
                            <td class="col-time" style="font-size: 8pt;">${timeStr}</td>
                            <td class="col-direct"></td>
                            <td class="col-detail" style="text-align: left; white-space: pre-wrap; font-size: 8.5pt;">${detailContent}</td>
                        </tr>
                    `;
                });
            }
            
            html += `
                </tbody>
            </table>
            `;
            
            // マージタイムライン
            let mergedTimeline = Array(48).fill(0);
            let dayTotal = 0;
            let daySiteTotal = 0;
            const tlStr = dayObj.timeline || '';
            if (tlStr && tlStr.length === 48) {
                for (let i = 0; i < 48; i++) {
                    mergedTimeline[i] = parseInt(tlStr[i]) || 0;
                }
                dayTotal = tlStr.split('').filter(s => s === '1' || s === '3' || s === '5').length * 0.5;
                daySiteTotal = tlStr.split('').filter(s => s === '1').length * 0.5;
            }
            
            html += `
            <div class="print-timeline-row">
                <div class="print-timeline-label">時間</div>
                <div class="print-timeline-hours">
                    <div class="print-timeline-header-cells">
            `;
            for (let h = 5; h < 29; h++) {
                const displayHour = h % 24;
                html += `<div class="print-timeline-hour-cell">${displayHour}</div>`;
            }
            html += `
                    </div>
                    <div class="print-timeline-grid-cells">
            `;
            for (let i = 0; i < 48; i++) {
                const state = mergedTimeline[i];
                html += `<div class="print-timeline-cell" data-state="${state}"></div>`;
            }
            html += `
                    </div>
                </div>
                <div class="print-timeline-total">計 ${dayTotal.toFixed(1)}H<br>(現場従事 ${daySiteTotal.toFixed(1)}H)</div>
            </div>
            `;
            
            html += `</div>`; // .print-day-block
        });
        
        html += `</div>`; // .weekly-print-wrapper
        
        // 印刷用一時エリアを取得
        const printContainer = document.getElementById('print-weekly-action-container');
        if (printContainer) {
            printContainer.innerHTML = html;
        }

        // 既存の動的スタイルを削除
        const existingStyle = document.getElementById('print-dynamic-style');
        if (existingStyle) existingStyle.remove();

        // 印刷用のスタイル（A4縦）を動的に注入
        const style = document.createElement('style');
        style.id = 'print-dynamic-style';
        style.innerHTML = `
            @media print {
                @page { size: A4 portrait !important; margin: 6mm 10mm !important; }
                
                /* html, body を紙の横幅100%に強制し、横幅が半分に縮むのを防止する */
                html, body {
                    width: 100% !important;
                    min-width: 100% !important;
                    max-width: 100% !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    overflow: visible !important;
                }
                
                /* ガントチャート印刷用の一時エリアやメインアプリを完全に非表示にし、さらに幅計算に干渉しないようサイズを0にする */
                #app-container,
                #login-container,
                #loading-container,
                #print-active-area,
                .no-print {
                    display: none !important;
                    width: 0 !important;
                    height: 0 !important;
                    overflow: hidden !important;
                    position: absolute !important;
                    top: -9999px !important;
                    left: -9999px !important;
                }
                
                /* 週報専用コンテナの幅は安定した100%に戻す */
                #print-weekly-action-container {
                    display: block !important;
                    width: 100% !important;
                    min-width: 100% !important;
                    max-width: 100% !important;
                    position: static !important;
                    background: white !important;
                    color: black !important;
                    font-family: "Hiragino Kaku Gothic ProN", "MS Gothic", sans-serif !important;
                }
                
                .weekly-print-wrapper {
                    width: calc(100% - 4px) !important;
                    max-width: calc(100% - 4px) !important;
                    margin: 0 auto !important;
                    box-sizing: border-box !important;
                }
                .weekly-print-header { display: flex !important; justify-content: space-between !important; align-items: flex-end !important; width: 100% !important; margin-bottom: 4px !important; height: 90px !important; box-sizing: border-box !important; }
                .weekly-print-title { font-size: 13pt !important; font-weight: bold !important; text-align: center !important; letter-spacing: 2px !important; text-decoration: underline !important; text-underline-offset: 3px !important; margin: 0 !important; padding-bottom: 2px !important; white-space: nowrap !important; }
                
                /* 押印欄の横幅引き伸ばしバグの修正（幅を126pxおよびセル42pxに完全固定） */
                .approval-table { border-collapse: collapse !important; width: 126px !important; min-width: 126px !important; max-width: 126px !important; margin: 0 0 0 auto !important; table-layout: fixed !important; }
                .approval-table th { font-size: 7.5pt !important; font-weight: bold !important; color: #000 !important; padding: 2px 3px !important; border: 1px solid #000 !important; background: #f1f5f9 !important; text-align: center !important; width: 42px !important; min-width: 42px !important; max-width: 42px !important; white-space: nowrap !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                .approval-table td { border: 1px solid #000 !important; width: 42px !important; min-width: 42px !important; max-width: 42px !important; height: 56px !important; text-align: center !important; vertical-align: middle !important; font-size: 7.5pt !important; padding: 2px !important; box-sizing: border-box !important; }
                
                .stamp-approved { font-size: 7.5pt !important; font-weight: bold !important; color: #dc2626 !important; border: 1.8px solid #dc2626 !important; border-radius: 50% !important; width: 35px !important; height: 35px !important; display: flex !important; align-items: center !important; justify-content: center !important; flex-direction: column !important; margin: 0 auto !important; line-height: 1.1 !important; }
                .stamp-approved span { font-size: 5.5pt !important; font-weight: normal !important; margin-top: 1px !important; }
                .weekly-print-subheader { display: flex !important; justify-content: space-between !important; align-items: center !important; font-size: 7.8pt !important; margin-bottom: 3px !important; font-weight: bold !important; }
                .legend-box { display: flex !important; gap: 10px !important; align-items: center !important; }
                .legend-item { display: flex !important; align-items: center !important; gap: 3px !important; }
                .legend-color { width: 12px !important; height: 12px !important; border: 1px solid #000 !important; display: inline-block !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                .print-day-block { border: 1px solid #000 !important; margin-bottom: 4px !important; page-break-inside: avoid !important; }
                
                /* 明示的に曜日テーブルの幅を100%に指定 */
                .print-day-table { width: 100% !important; border-collapse: collapse !important; table-layout: fixed !important; }
                .print-day-table th, .print-day-table td { border: 1px solid #000 !important; padding: 2px 4px !important; font-size: 8pt !important; vertical-align: middle !important; height: 22px !important; box-sizing: border-box !important; }
                .print-day-table th { background: #f1f5f9 !important; font-weight: bold !important; text-align: center !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                .col-date { width: 12% !important; text-align: center !important; font-weight: bold !important; }
                .col-project { width: 22% !important; }
                .col-time { width: 12% !important; text-align: center !important; }
                .col-direct { width: 12% !important; text-align: center !important; vertical-align: middle !important; }
                .col-detail { width: 42% !important; }
                .print-timeline-row { display: flex !important; align-items: stretch !important; border-top: 1px solid #000 !important; background: #fff !important; height: 24px !important; }
                .print-timeline-label { width: 12% !important; font-size: 7.2pt !important; text-align: center !important; font-weight: bold !important; border-right: 1px solid #000 !important; display: flex !important; align-items: center !important; justify-content: center !important; background: #f8fafc !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                .print-timeline-hours { flex: 1 !important; display: flex !important; flex-direction: column !important; border-right: 1px solid #000 !important; }
                .print-timeline-header-cells { display: flex !important; justify-content: space-between !important; font-size: 5.5pt !important; height: 10px !important; line-height: 10px !important; border-bottom: 1px solid #000 !important; padding: 0 4px !important; }
                .print-timeline-hour-cell { width: 0 !important; overflow: visible !important; display: flex !important; justify-content: center !important; font-size: 5.5pt !important; white-space: nowrap !important; }
                .print-timeline-grid-cells { display: flex !important; height: 12px !important; padding: 0 4px !important; }
                .print-timeline-cell { flex: 1 !important; border-right: 1px dashed #ccc !important; height: 100% !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                .print-timeline-cell:nth-child(2n) { border-right: 1px solid #000 !important; }
                .print-timeline-cell:last-child { border-right: none !important; }
                .print-timeline-cell[data-state="0"] { background: #fff !important; }
                .print-timeline-cell[data-state="1"] { background: #000 !important; }
                .print-timeline-cell[data-state="2"] { background: #ef4444 !important; }
                .print-timeline-cell[data-state="3"] { background: #16a34a !important; }
                .print-timeline-cell[data-state="4"] { background: #94a3b8 !important; }
                .print-timeline-cell[data-state="5"] { background: #2563eb !important; }
                .print-timeline-total { width: 15% !important; font-size: 7.2pt !important; text-align: center !important; font-weight: bold !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; line-height: 1.2 !important; }
                
                .print-day-block-slim { margin-bottom: 2px !important; }
                .print-day-block-slim .print-day-table td, .print-day-block-slim .print-day-table th { height: 16px !important; padding: 1px 4px !important; font-size: 7.8pt !important; }
                .print-day-block-slim .print-timeline-row { display: none !important; }
            }
        `;
        document.head.appendChild(style);

        // 印刷モードのクラスを body に追加してスタイルの干渉を防ぐ
        document.body.classList.add('print-weekly-mode');

        // 印刷ダイアログが閉じた後のクリーンアップ処理を定義
        const cleanup = () => {
            document.body.classList.remove('print-weekly-mode');
            if (printContainer) printContainer.innerHTML = '';
            if (style) style.remove();
            window.removeEventListener('afterprint', cleanup);
        };
        // 印刷完了・キャンセルイベントを監視
        window.addEventListener('afterprint', cleanup);

        setTimeout(() => {
            window.print();
        }, 150);
    };

    const btnPrintWeekly = document.getElementById('btn-print-weekly-top');
    if (btnPrintWeekly) {
        btnPrintWeekly.addEventListener('click', printWeeklyReport);
    }

    // 週の予定と実績のExcel出力
    const btnExportWeekly = document.getElementById('btn-export-weekly');
    if (btnExportWeekly) {
        btnExportWeekly.addEventListener('click', async () => {
            if (typeof ExcelJS === 'undefined') {
                return alert('Excelライブラリの読み込みに失敗しました。ページを再読み込みしてください。');
            }
            
            const weekInput = document.getElementById('week');
            const authorInput = document.getElementById('author');
            if (!weekInput || !authorInput) return;
            
            const weekVal = weekInput.value;
            const weekText = weekInput.options[weekInput.selectedIndex]?.text || '';
            const authorVal = authorInput.value;
            if (!weekVal || !authorVal) {
                return alert('対象週または担当者が正しく選択されていません。');
            }
            
            // 常に画面の最新のDOMデータから収集してエクスポートする
            const daysData = {};
            daysName.forEach(day => {
                const taskList = document.querySelector(`.task-list[data-day="${day}"]`);
                const dayCard = taskList ? taskList.closest('.day-card') : null;
                if (!dayCard) return;
                const cardData = taskList.getCardData ? taskList.getCardData() : {};
                const tasks = [];
                ['morning', 'afternoon', 'night'].forEach(period => {
                    const proj = cardData[period]?.project || '';
                    const det = cardData[period]?.detail || '';
                    if (proj || det) tasks.push({ project: proj, detail: det, hours: 0, timeline: cardData.timeline || '' });
                });
                if (cardData.leaveType) tasks.push({ project: cardData.leaveType, detail: '', hours: 0, timeline: '' });
                const tl = cardData.timeline || '';
                const workHours = tl ? tl.split('').filter(s => s === '1' || s === '3').length * 0.5 : 0;
                if (tasks.length > 0 && !cardData.leaveType) tasks[0].hours = workHours;
                const reportText = dayCard.querySelector('.day-report-text')?.value.trim() || '';
                daysData[day] = { tasks, reportText };
            });
            
            
            const dates = getDaysOfWeek(weekVal);
            if (!dates || dates.length < 7) {
                return alert('週の日付データの取得に失敗しました。');
            }
            
            const originalText = btnExportWeekly.textContent;
            btnExportWeekly.disabled = true;
            btnExportWeekly.textContent = '出力中...';
            
            try {
                const response = await fetch('template-weekly.xlsx');
                if (!response.ok) throw new Error('テンプレートファイルの取得に失敗しました。');
                
                const arrayBuffer = await response.arrayBuffer();
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.load(arrayBuffer);
                
                const sheet = workbook.worksheets[0];
                
                const startMonday = dates[0];
                const yyyy = startMonday.getFullYear();
                const mm = String(startMonday.getMonth() + 1).padStart(2, '0');
                const dd = String(startMonday.getDate()).padStart(2, '0');
                sheet.name = `${yyyy}${mm}${dd}`;
                
                const sheetsToRemove = workbook.worksheets.filter((s, idx) => idx > 0);
                sheetsToRemove.forEach(s => workbook.removeWorksheet(s.id));
                
                const authorCell = sheet.getCell('BI3');
                if (authorCell) {
                    authorCell.value = authorVal;
                }
                
                const dayConfig = {
                    '月': { startRow: 10, dateCell: 'B10' },
                    '火': { startRow: 22, dateCell: 'B22' },
                    '水': { startRow: 34, dateCell: 'B34' },
                    '木': { startRow: 46, dateCell: 'B46' },
                    '金': { startRow: 58, dateCell: 'B58' },
                    '土': { startRow: 70, dateCell: 'B70' },
                    '日': { startRow: 80, dateCell: 'B80' }
                };
                
                daysName.forEach((day, idx) => {
                    const config = dayConfig[day];
                    const dateVal = dates[idx];
                    
                    const dateCell = sheet.getCell(config.dateCell);
                    if (dateCell) {
                        const yr = dateVal.getFullYear();
                        const mt = String(dateVal.getMonth() + 1).padStart(2, '0');
                        const dy = String(dateVal.getDate()).padStart(2, '0');
                        dateCell.value = `${yr}-${mt}-${dy}`;
                    }
                    
                    const dayObj = daysData[day];
                    const tasks = dayObj.tasks;
                    const reportText = dayObj.reportText;
                    
                    // 予定行のクリア (月〜土の予定行。日付セルの3行上の行)
                    if (day !== '日') {
                        const planRow = config.startRow - 3;
                        sheet.getCell(planRow, 5).value = null;
                        sheet.getCell(planRow, 13).value = null;
                        sheet.getCell(planRow, 17).value = null;
                        sheet.getCell(planRow, 21).value = null;
                    }

                    const maxRows = (day === '日') ? 2 : 5; // 月〜土は最大5行の実績入力枠があるため5に変更
                    for (let rIdx = 0; rIdx < maxRows; rIdx++) {
                        const targetRow = config.startRow + rIdx; // 1行ずれていたのを修正。日付セルの行（月曜なら10行目）から実績を書き込む
                        
                        const cellProj = sheet.getCell(targetRow, 5);
                        const cellTime = sheet.getCell(targetRow, 13);
                        const cellDirect = sheet.getCell(targetRow, 17);
                        const cellDetail = sheet.getCell(targetRow, 21);
                        
                        const task = tasks[rIdx];
                        if (task) {
                            cellProj.value = task.project || null;
                            cellTime.value = task.hours > 0 ? parseFloat(task.hours) : null;
                            cellDirect.value = null;
                            
                            let detailText = task.detail || '';
                            if (rIdx === tasks.length - 1 && reportText) {
                                detailText += (detailText ? '\n' : '') + `📝 日次報告: ${reportText}`;
                            }
                            cellDetail.value = detailText || null;
                        } else {
                            cellProj.value = null;
                            cellTime.value = null;
                            cellDirect.value = null;
                            if (rIdx === 0 && reportText) {
                                cellDetail.value = `📝 日次報告: ${reportText}`;
                            } else {
                                cellDetail.value = null;
                            }
                        }
                    }
                    
                    let earlyHours = 0;
                    let overtimeHours = 0;
                    let totalHours = 0;
                    
                    let mergedTimeline = Array(48).fill(0);
                    tasks.forEach(task => {
                        totalHours += parseFloat(task.hours || 0);
                        if (task.timeline) {
                            let tlStr = task.timeline;
                            if (tlStr.length === 40) {
                                tlStr = tlStr + '00000000'; // 互換性のため40文字のタイムラインに末尾8文字補完
                            }
                            if (tlStr.length === 48) {
                                for (let i = 0; i < 48; i++) {
                                    const val = parseInt(tlStr[i]);
                                    if (val === 1) {
                                        mergedTimeline[i] = 1;
                                    } else if (val === 2 && mergedTimeline[i] !== 1) {
                                        mergedTimeline[i] = 2;
                                    }
                                }
                            }
                        }
                    });
                    
                    for (let i = 0; i < 14; i++) {
                        if (mergedTimeline[i] === 1) {
                            earlyHours += 0.5;
                        }
                    }
                    for (let i = 38; i < 48; i++) {
                        if (mergedTimeline[i] === 1) {
                            overtimeHours += 0.5;
                        }
                    }
                    
                    // 日曜日はタイムライングリッドが config.startRow + 5 行目（85行目）にあるのを考慮
                    const gridRowIndex = (day === '日') ? (config.startRow + 5) : (config.startRow + 8);
                    
                    const earlyCell = sheet.getCell(gridRowIndex, 4);
                    if (earlyCell) {
                        earlyCell.value = earlyHours > 0 ? earlyHours : 0;
                    }
                    
                    if (day !== '土') {
                        const overtimeCell = sheet.getCell(gridRowIndex, 65);
                        if (overtimeCell) {
                            overtimeCell.value = overtimeHours > 0 ? overtimeHours : 0;
                        }
                    }
                    
                    const totalCell = sheet.getCell(gridRowIndex, 66);
                    if (totalCell) {
                        totalCell.value = totalHours > 0 ? totalHours : 0;
                    }
                    // タイムラインセル（I列 9 〜 BL列 64）の範囲のみを塗りつぶし対象に制限して他の合計セルなどのスタイル破壊を防止
                    for (let col = 9; col <= 64; col++) {
                        const timeVal = 7.0 + (col - 9) * 0.25;
                        
                        let tlIdx = 0;
                        let state = 0;
                        // 24時以降（翌日）は今日のタイムラインデータが存在しないため背景を塗らない
                        if (timeVal < 24.0) {
                            tlIdx = Math.floor(timeVal * 2);
                            state = (tlIdx >= 0 && tlIdx < 48) ? mergedTimeline[tlIdx] : 0;
                        }
                        
                        const cell = sheet.getCell(gridRowIndex, col);
                        cell.style = Object.create(cell.style);
                        
                        if (state === 1) {
                            cell.fill = {
                                type: 'pattern',
                                pattern: 'solid',
                                fgColor: { argb: 'FF111111' } // 完全な黒 FF000000 から FF111111 に変更してExcelの自動判定バグを回避
                            };
                        } else if (state === 2) {
                            cell.fill = {
                                type: 'pattern',
                                pattern: 'solid',
                                fgColor: { argb: 'FFEF4444' }
                            };
                        } else {
                            cell.fill = {
                                type: 'pattern',
                                pattern: 'none'
                            };
                        }
                    }
                });
                
                const buffer = await workbook.xlsx.writeBuffer();
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = window.URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = `週報_${authorVal}_${weekVal}.xlsx`;
                anchor.click();
                window.URL.revokeObjectURL(url);
                
            } catch (err) {
                console.error('Excel Export Error:', err);
                alert('Excel出力中にエラーが発生しました: ' + err.message);
            } finally {
                btnExportWeekly.disabled = false;
                btnExportWeekly.textContent = originalText;
            }
        });
    }


    // Excel Export (Gantt)
    const btnExportGantt = document.getElementById('btn-export-gantt');
    if (btnExportGantt) {
        btnExportGantt.addEventListener('click', async () => {
            if (typeof ExcelJS === 'undefined') return alert('ExcelJSライブラリの読み込みに失敗しました。');
            
            // ボタン連打防止
            btnExportGantt.disabled = true;
            const originalText = btnExportGantt.textContent;
            btnExportGantt.textContent = '⏳ 出力中...';
            
            const isValidDate = (d) => d instanceof Date && !isNaN(d.getTime());
            
            const selectedYear = parseInt(ganttYearSelect.value, 10);
            if (isNaN(selectedYear)) return alert('年度が選択されていません。');

            const startStr = `${selectedYear}-04-01`;
            const endStr = `${selectedYear + 1}-03-31`;

            // 日付リスト生成
            const dateList = [];
            const current = new Date(selectedYear, 3, 1);
            const end = new Date(selectedYear + 1, 2, 31);
            while (current <= end) {
                dateList.push(new Date(current));
                current.setDate(current.getDate() + 1);
            }

            const targetSchedules = allSchedules.filter(s => s.start <= endStr && s.end >= startStr);
            targetSchedules.sort((a, b) => (a.start || '') > (b.start || '') ? 1 : ((a.start || '') < (b.start || '') ? -1 : 0));

            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet(`${selectedYear}年度 工程管理表`);

            // 印刷設定（A3縦、横幅を1ページに収める自動縮小設定）
            sheet.pageSetup = {
                paperSize: 8, // A3
                orientation: 'portrait', // 縦
                fitToPage: true,
                fitToWidth: 1, // 横幅を1ページに収める
                fitToHeight: 0 // 縦幅は自動で複数ページ許可
            };
            sheet.views = [
                { state: 'normal', showGridLines: true } // グリッド線を表示
            ];

            // カラーコード変換ヘルパー
            const hexToARGB = (hex) => {
                if (!hex) return 'FF16A34A';
                return 'FF' + hex.replace('#', '').toUpperCase();
            };

            // 列幅の設定 (A3縦印刷のために全体的に大幅スリム化、全16列分に対応)
            const leftWidths = [18, 12, 15, 8, 8, 8, 8, 8, 10, 8, 10, 10, 10, 10, 10, 6];
            sheet.columns = [
                ...leftWidths.map(w => ({ width: w })),
                ...dateList.map(() => ({ width: 0.8 })) // タイムライン列をさらに極細化
            ];

            // 資格者サマリーの抽出と構築（現在選択中の支店フィルターと連動）
            const selectedBranch = ganttBranchFilter ? ganttBranchFilter.value : '';
            const branchFilteredMembers = selectedBranch 
                ? allMembers.filter(m => m.branch === selectedBranch)
                : allMembers;

            const list1stConst = [];
            const list1stCivil = [];
            const list2ndConstBody = [];
            const listPractical = [];

            branchFilteredMembers.forEach(m => {
                const name = m.name || '';
                const quals = m.qualifications || [];
                
                let nameWithDed = name;
                if (m.isDedicated === 'branch') {
                    nameWithDed += '（支店専任）';
                } else if (m.isDedicated === 'non_dedicated') {
                    nameWithDed += '（非専任）';
                }

                if (quals.includes('q1b')) list1stConst.push(nameWithDed);
                if (quals.includes('q1c')) list1stCivil.push(nameWithDed);
                if (quals.includes('q2b_躯体')) list2ndConstBody.push(nameWithDed);
                if (quals.includes('exp')) listPractical.push(nameWithDed);
            });

            const totalCols = 16 + dateList.length;

            // ----------------------------------------
            // 行1: タイトル
            // ----------------------------------------
            const rowT = sheet.getRow(1);
            rowT.height = 35;
            sheet.mergeCells(1, 1, 1, totalCols);
            const titleCell = rowT.getCell(1);
            titleCell.value = `工程管理表　${selectedYear}年度`;
            titleCell.font = { name: 'MS Gothic', size: 16, bold: true };
            titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

            // ----------------------------------------
            // 行2: 資格者サマリー1
            // ----------------------------------------
            const rowS1 = sheet.getRow(2);
            rowS1.height = 18;
            sheet.mergeCells(2, 1, 2, totalCols);
            const s1Cell = rowS1.getCell(1);
            s1Cell.value = ` 🏅 資格保有者サマリー： ≪1級建築≫ ${list1stConst.join('・') || '-'} (${list1stConst.length}名)  /  ≪1級土木≫ ${list1stCivil.join('・') || '-'} (${list1stCivil.length}名)`;
            s1Cell.font = { name: 'MS Gothic', size: 9, bold: true, color: { argb: 'FF1E3A8A' } };
            s1Cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
            s1Cell.alignment = { horizontal: 'left', vertical: 'middle' };

            // ----------------------------------------
            // 行3: 資格者サマリー2
            // ----------------------------------------
            const rowS2 = sheet.getRow(3);
            rowS2.height = 18;
            sheet.mergeCells(3, 1, 3, totalCols);
            const s2Cell = rowS2.getCell(1);
            s2Cell.value = `                      ≪2級躯体≫ ${list2ndConstBody.join('・') || '-'} (${list2ndConstBody.length}名)  /  ≪実務経験≫ ${listPractical.join('・') || '-'} (${listPractical.length}名)   【主任技術者の専任配置の要件：請負4500万円以上】`;
            s2Cell.font = { name: 'MS Gothic', size: 9, bold: true, color: { argb: 'FF1E3A8A' } };
            s2Cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
            s2Cell.alignment = { horizontal: 'left', vertical: 'middle' };

            // ----------------------------------------
            // 行4: 空行 (余白)
            // ----------------------------------------
            const rowSpacer = sheet.getRow(4);
            rowSpacer.height = 10;

            // ----------------------------------------
            // 行5: 月ヘッダー (元の行1が4行シフト)
            // ----------------------------------------
            const row5 = sheet.getRow(5);
            row5.height = 25;
            
            // 左側結合
            sheet.mergeCells(5, 1, 5, 16);
            const detailHeaderCell = row5.getCell(1);
            detailHeaderCell.value = '工程詳細情報';
            detailHeaderCell.font = { name: 'MS Gothic', size: 10, bold: true };
            detailHeaderCell.alignment = { horizontal: 'center', vertical: 'middle' };
            detailHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
            detailHeaderCell.border = {
                top: { style: 'medium' }, left: { style: 'medium' }, right: { style: 'thin' }, bottom: { style: 'thin' }
            };

            // 右側月ヘッダー結合
            let startCol = 17;
            dateList.forEach((d, idx) => {
                const m = d.getMonth() + 1;
                const nextDate = dateList[idx + 1];
                const isLastDay = !nextDate || nextDate.getMonth() !== d.getMonth();

                if (isLastDay) {
                    const endCol = idx + 17; // 1-indexed column index
                    sheet.mergeCells(5, startCol, 5, endCol);
                    const mCell = row5.getCell(startCol);
                    mCell.value = `${m}月`;
                    mCell.font = { name: 'MS Gothic', size: 10, bold: true };
                    mCell.alignment = { horizontal: 'center', vertical: 'middle' };
                    mCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
                    
                    // 月の右境界線を太くする
                    mCell.border = {
                        top: { style: 'medium' },
                        bottom: { style: 'thin' },
                        left: { style: startCol === 17 ? 'thin' : 'none' },
                        right: { style: !nextDate ? 'medium' : 'medium' }
                    };
                    startCol = endCol + 1;
                }
            });

            // ----------------------------------------
            // 行6: 詳細項目ヘッダー ＆ カレンダー日ヘッダー (元の行2が4行シフト)
            // ----------------------------------------
            const row6 = sheet.getRow(6);
            row6.height = 20;

            const leftHeaders = [
                "工事名", "元請", "現場住所", "柱脚", "製作", "建て方本締め", "床スタッド", "現場溶接", 
                "管理補助", "数量メモ", "営業担当", "工務担当", "現場担当", "主任技術者", "専任区分", "完了"
            ];
            
            leftHeaders.forEach((lh, idx) => {
                const cell = row6.getCell(idx + 1);
                cell.value = lh;
                cell.font = { name: 'MS Gothic', size: 9, bold: true };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                cell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'medium' },
                    left: idx === 0 ? { style: 'medium' } : { style: 'thin' },
                    right: { style: 'thin' }
                };
            });

            dateList.forEach((d, idx) => {
                const colIdx = idx + 17;
                const cell = row6.getCell(colIdx);
                const day = d.getDay();
                const isSat = day === 6;
                const isSun = day === 0;

                const nextDate = dateList[idx + 1];
                const isLastDay = !nextDate || nextDate.getMonth() !== d.getMonth();

                const borderObj = {
                    top: { style: 'thin' },
                    bottom: { style: 'medium' }
                };
                if (isLastDay) {
                    borderObj.right = { style: 'medium' };
                }
                cell.border = borderObj;

                if (isSat) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F0FA' } }; // 薄い青
                } else if (isSun) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEECEC' } }; // 薄い赤
                }
            });

            // ----------------------------------------
            // データ行レンダリング
            // ----------------------------------------
            targetSchedules.forEach((s, index) => {
                const rowIndex = index + 7;
                const row = sheet.getRow(rowIndex);
                row.height = 24;

                const displayAssign = '';
                const displayCompleted = s.completed ? '✓' : '-';

                // 住所に作業所住所を設定
                const displayAddress = s.workAddress || s.address || '-';

                // 施工体制の5グループを解決
                const supVals = getGanttSupplierValues(s);

                const leftValues = [
                    s.project || '', s.client || '-', displayAddress,
                    supVals.pedestal, supVals.fab, supVals.erectionBolting, supVals.deckStud, supVals.welding,
                    s.subcontractor || '-', s.memoQty || '-', s.salesRep || '-', s.constRep || '-', s.siteRep || '-', s.chiefTech || '-',
                    displayAssign, displayCompleted
                ];

                leftValues.forEach((val, idx) => {
                    const cell = row.getCell(idx + 1);
                    cell.value = val;
                    cell.font = { name: 'MS Gothic', size: 9 };
                    cell.alignment = { 
                        horizontal: (idx >= 14) ? 'center' : 'left',
                        vertical: 'middle',
                        wrapText: (idx === 2 || (idx >= 3 && idx <= 7)) ? true : false
                    };
                    cell.border = {
                        top: { style: 'thin' },
                        bottom: { style: 'thin' },
                        left: idx === 0 ? { style: 'medium' } : { style: 'thin' },
                        right: { style: 'thin' }
                    };
                    // 完了かつ完了カラムなら緑色太字
                    if (idx === 15 && s.completed) {
                        cell.font = { name: 'MS Gothic', size: 9, bold: true, color: { argb: 'FF16A34A' } };
                    }
                });

                // カレンダー背景セルの初期化 (土日・月境界の描画 - 高速化のため不要な平日白塗りや罫線をスキップ)
                dateList.forEach((d, idx) => {
                    const colIdx = idx + 17;
                    const cell = row.getCell(colIdx);
                    const day = d.getDay();
                    const isSat = day === 6;
                    const isSun = day === 0;

                    const nextDate = dateList[idx + 1];
                    const isLastDay = !nextDate || nextDate.getMonth() !== d.getMonth();

                    if (isLastDay) {
                        cell.border = {
                            right: { style: 'medium' }
                        };
                    }

                    if (isSat) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F0FA' } };
                    } else if (isSun) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEECEC' } };
                    }
                });

                // 工程バーの書き込み
                const startLimit = new Date(startStr);
                const endLimit = new Date(endStr);

                // 描画するバーの期間のリスト
                const barsToDraw = [];
                
                // 建て方①
                if (s.dateErection1Start && s.dateErection1End) {
                    const st = new Date(s.dateErection1Start);
                    const ed = new Date(s.dateErection1End);
                    if (isValidDate(st) && isValidDate(ed)) {
                        barsToDraw.push({ start: st, end: ed });
                    }
                }
                // 建て方②
                if (s.dateErection2Start && s.dateErection2End) {
                    const st = new Date(s.dateErection2Start);
                    const ed = new Date(s.dateErection2End);
                    if (isValidDate(st) && isValidDate(ed)) {
                        barsToDraw.push({ start: st, end: ed });
                    }
                }

                barsToDraw.forEach(barInfo => {
                    const drawStart = barInfo.start < startLimit ? startLimit : barInfo.start;
                    const drawEnd = barInfo.end > endLimit ? endLimit : barInfo.end;

                    const drawStartStr = drawStart.toISOString().split('T')[0];
                    const drawEndStr = drawEnd.toISOString().split('T')[0];

                    const startIdx = dateList.findIndex(d => d.toISOString().split('T')[0] === drawStartStr);
                    const endIdx = dateList.findIndex(d => d.toISOString().split('T')[0] === drawEndStr);

                    if (startIdx !== -1 && endIdx !== -1) {
                        const barStartCol = startIdx + 17;
                        const barEndCol = endIdx + 17;

                        // バーに該当する各セルにスタイルを適用
                        const colorARGB = hexToARGB(getBarColorForSiteRep(s.siteRep));
                        
                        for (let c = barStartCol; c <= barEndCol; c++) {
                            const cell = row.getCell(c);
                            
                            if (s.barPattern === 'stripe') {
                                cell.fill = {
                                    type: 'pattern',
                                    pattern: 'lightDown',
                                    fgColor: { argb: colorARGB },
                                    bgColor: { argb: 'FFFFFFFF' }
                                };
                            } else {
                                cell.fill = {
                                    type: 'pattern',
                                    pattern: 'solid',
                                    fgColor: { argb: colorARGB }
                                };
                            }

                            cell.font = {
                                name: 'MS Gothic',
                                size: 8,
                                bold: true,
                                color: { argb: 'FFFFFFFF' },
                                strike: s.completed ? true : false
                            };
                        }

                        // 重複マージによるファイル破損を防ぐためセル結合(mergeCells)は行わず、各セルを単体で塗りつぶす仕様に変更します。
                    }
                });
            });

            // 右側の最後の列の右境界線を太線にする
            const leftColCount = 16;
            const lastColIdx = leftColCount + dateList.length;
            for (let r = 5; r <= targetSchedules.length + 6; r++) {
                const cell = sheet.getRow(r).getCell(lastColIdx);
                cell.border = {
                    ...cell.border,
                    right: { style: 'medium' }
                };
            }
            // 最終行の下境界線を太線にする
            const lastRowIdx = targetSchedules.length + 6;
            if (lastRowIdx > 6) {
                const lastRow = sheet.getRow(lastRowIdx);
                for (let c = 1; c <= lastColIdx; c++) {
                    const cell = lastRow.getCell(c);
                    cell.border = {
                        ...cell.border,
                        bottom: { style: 'medium' }
                    };
                }
            }

            // ブロードキャスト書き出し
            try {
                const buffer = await workbook.xlsx.writeBuffer();
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${selectedYear}年度_工程管理表.xlsx`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (err) {
                console.error("Excel export error: ", err);
                alert("Excel出力中にエラーが発生しました。");
            } finally {
                // ボタンの無効化解除
                btnExportGantt.disabled = false;
                btnExportGantt.textContent = originalText;
            }
        });
    }

    // Excel Export (List)
    const btnExportList = document.getElementById('btn-export');
    if (btnExportList) {
        btnExportList.addEventListener('click', () => {
            if (typeof XLSX === 'undefined') return alert('Excelライブラリの読み込みに失敗しました。');
            const filterMonth = document.getElementById('filter-month').value;
            const filterAuthor = document.getElementById('filter-author').value;
            const filtered = allReports.filter(r => {
                const actualStatus = r.actualStatus || (r.status === 'approved' ? 'approved' : r.status === 'confirmed' ? 'submitted' : r.status === 'plan' ? 'uncreated' : 'draft');
                return (actualStatus === 'submitted' || actualStatus === 'approved') &&
                       (filterMonth === '' || getMonthStr(r.week) === filterMonth) && 
                       (filterAuthor === '' || r.author === filterAuthor);
            });
            const rows = [];
            const authorProjectHours = {};

            filtered.forEach(r => {
                const days = ['月','火','水','木','金','土','日'];
                days.forEach(day => {
                    const tasks = r.dailyLogs ? normalizeDailyTasks(r.dailyLogs[day]) : [];
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
                            
                            if (t.project && !['有給', '有休', '欠勤', '休日'].includes(t.project)) {
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

// 全角英数字・全角スペースを半角に変換するヘルパー関数
function toHalfWidth(str) {
    if (!str) return '';
    let result = str.replace(/　/g, ' ');
    return result.replace(/[０-９ａ-ｚＡ-Ｚ]/g, function(s) {
        return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
    });
}

// --- 予定・工程入力フォーム未保存監視ヘルパー (グローバル定義) ---
function getScheduleFormDataString() {
    const projectEl = document.getElementById('sched-project');
    if (!projectEl) return '';
    const data = {
        project: projectEl.value.trim(),
        client: document.getElementById('sched-client')?.value.trim() || '',
        clientDirector: document.getElementById('sched-client-director')?.value.trim() || '',
        clientRep: document.getElementById('sched-client-rep')?.value.trim() || '',
        officeAddress: document.getElementById('sched-office-address')?.value.trim() || '',
        workAddress: document.getElementById('sched-work-address')?.value.trim() || '',
        // 施工予定日
        datePedestal1Start: document.getElementById('sched-date-pedestal1-start')?.value || '',
        datePedestal1End: document.getElementById('sched-date-pedestal1-end')?.value || '',
        datePedestal2Start: document.getElementById('sched-date-pedestal2-start')?.value || '',
        datePedestal2End: document.getElementById('sched-date-pedestal2-end')?.value || '',
        dateErection1Start: document.getElementById('sched-date-erection1-start')?.value || '',
        dateErection1End: document.getElementById('sched-date-erection1-end')?.value || '',
        dateErection2Start: document.getElementById('sched-date-erection2-start')?.value || '',
        dateErection2End: document.getElementById('sched-date-erection2-end')?.value || '',
        // その他工種
        dateRoofStart: document.getElementById('sched-date-roof-start')?.value || '',
        dateRoofEnd: document.getElementById('sched-date-roof-end')?.value || '',
        dateWallStart: document.getElementById('sched-date-wall-start')?.value || '',
        dateWallEnd: document.getElementById('sched-date-wall-end')?.value || '',
        // 施工体制
        constPedestal1: document.getElementById('sched-const-pedestal1')?.value.trim() || '',
        constPedestal1Separate: !!document.getElementById('sched-const-pedestal1-separate')?.checked,
        constPedestal2: document.getElementById('sched-const-pedestal2')?.value.trim() || '',
        constPedestal2Separate: !!document.getElementById('sched-const-pedestal2-separate')?.checked,
        constFab1: document.getElementById('sched-const-fab1')?.value.trim() || '',
        constFab1Separate: !!document.getElementById('sched-const-fab1-separate')?.checked,
        constDrawing: document.getElementById('sched-const-drawing')?.value.trim() || '',
        constDrawingSeparate: !!document.getElementById('sched-const-drawing-separate')?.checked,
        constFab2: document.getElementById('sched-const-fab2')?.value.trim() || '',
        constFab2Separate: !!document.getElementById('sched-const-fab2-separate')?.checked,
        constErection: document.getElementById('sched-const-erection')?.value.trim() || '',
        constErectionSeparate: !!document.getElementById('sched-const-erection-separate')?.checked,
        constBolting: document.getElementById('sched-const-bolting')?.value.trim() || '',
        constBoltingSeparate: !!document.getElementById('sched-const-bolting-separate')?.checked,
        constDeck: document.getElementById('sched-const-deck')?.value.trim() || '',
        constDeckSeparate: !!document.getElementById('sched-const-deck-separate')?.checked,
        constStud: document.getElementById('sched-const-stud')?.value.trim() || '',
        constStudSeparate: !!document.getElementById('sched-const-stud-separate')?.checked,
        constWelding: document.getElementById('sched-const-welding')?.value.trim() || '',
        constWeldingSeparate: !!document.getElementById('sched-const-welding-separate')?.checked,
        constCrane: document.getElementById('sched-const-crane')?.value.trim() || '',
        constCraneSeparate: !!document.getElementById('sched-const-crane-separate')?.checked,

        subcontractor: document.getElementById('sched-subcontractor')?.value.trim() || '',
        memoQty: toHalfWidth(document.getElementById('sched-memo-qty')?.value.trim() || ''),
        salesRep: document.getElementById('sched-sales-rep')?.value || '',
        constRep: document.getElementById('sched-const-rep')?.value || '',
        siteRep: document.getElementById('sched-site-rep')?.value || '',
        chiefTech: document.getElementById('sched-chief-tech')?.value || '',
        barPattern: document.getElementById('sched-bar-pattern')?.value || 'solid',
        completed: !!document.getElementById('sched-completed')?.checked,
        notes: document.getElementById('sched-notes')?.value.trim() || ''
    };
    return JSON.stringify(data);
}

function checkUnsavedScheduleChanges() {
    const currentDataStr = getScheduleFormDataString();
    console.log("[UnsavedScheduleCheck] lastSaved:", lastSavedScheduleDataString);
    console.log("[UnsavedScheduleCheck] current:", currentDataStr);
    
    if (!lastSavedScheduleDataString) {
        console.log("[UnsavedScheduleCheck] Skipped: lastSaved is empty");
        return false;
    }
    const form = document.getElementById('schedule-form');
    if (!form) {
        console.log("[UnsavedScheduleCheck] Skipped: form not found");
        return false;
    }

    // 新規登録モード（sched-idが空）で、工事名（sched-project）が空の場合は警告をスキップ
    const idVal = document.getElementById('sched-id')?.value || '';
    const projVal = document.getElementById('sched-project')?.value.trim() || '';
    if (!idVal && !projVal) {
        console.log("[UnsavedScheduleCheck] Skipped: new mode and project is empty");
        return false;
    }

    const isDirty = currentDataStr !== lastSavedScheduleDataString;
    console.log("[UnsavedScheduleCheck] isDirty:", isDirty);
    return isDirty;
}

function showUnsavedScheduleChangesModal({ onSaveAndLeave, onLeaveWithoutSaving, onCancel }) {
    const existing = document.getElementById('unsaved-schedule-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'unsaved-schedule-modal';
    modal.style = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.4);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        font-family: inherit;
    `;

    modal.innerHTML = `
        <div style="
            background: var(--bg-card, #ffffff);
            color: var(--text, #000000);
            padding: 24px;
            border-radius: 12px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.15);
            max-width: 440px;
            width: 90%;
            border: 1px solid var(--border, #e2e8f0);
            animation: unsavedModalScale 0.2s ease-out;
        ">
            <h3 style="margin-top: 0; font-size: 1.15rem; font-weight: bold; display: flex; align-items: center; gap: 8px;">
                ⚠️ 編集中の工事情報があります
            </h3>
            <p style="margin: 16px 0 24px; font-size: 0.9rem; line-height: 1.5; color: var(--text-muted, #475569);">
                入力された工事情報の変更内容が保存されていません。移動する前に変更を保存しますか？
            </p>
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <button id="unsaved-sched-save-btn" style="
                    padding: 10px 16px;
                    background: var(--primary, #2563eb);
                    color: white;
                    border: none;
                    border-radius: 6px;
                    font-size: 0.9rem;
                    font-weight: bold;
                    cursor: pointer;
                    transition: background 0.15s;
                ">はい、保存して移動する</button>
                
                <button id="unsaved-sched-discard-btn" style="
                    padding: 10px 16px;
                    background: #f1f5f9;
                    color: #475569;
                    border: 1px solid #e2e8f0;
                    border-radius: 6px;
                    font-size: 0.9rem;
                    font-weight: bold;
                    cursor: pointer;
                    transition: background 0.15s;
                ">保存せずに移動する</button>
                
                <button id="unsaved-sched-cancel-btn" style="
                    padding: 10px 16px;
                    background: transparent;
                    color: #64748b;
                    border: none;
                    border-radius: 6px;
                    font-size: 0.9rem;
                    cursor: pointer;
                ">キャンセル（編集を続ける）</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const cleanup = () => modal.remove();

    document.getElementById('unsaved-sched-save-btn').onclick = async () => {
        cleanup();
        await onSaveAndLeave();
    };
    document.getElementById('unsaved-sched-discard-btn').onclick = () => {
        cleanup();
        onLeaveWithoutSaving();
    };
    document.getElementById('unsaved-sched-cancel-btn').onclick = () => {
        cleanup();
        onCancel();
    };
}

// --- 予定・工程入力フォーム編集モード制御 ---
function startEditScheduleMode(sched) {
    const idInput = document.getElementById('sched-id');
    const titleEl = document.getElementById('schedule-form-title');
    const submitBtn = document.getElementById('sched-submit-btn');
    const cancelBtn = document.getElementById('sched-cancel-btn');

    if (!idInput || !titleEl || !submitBtn) return;

    idInput.value = sched.id;
    titleEl.textContent = '✏️ 工事情報の編集・修正';
    submitBtn.textContent = '変更を保存する';
    if (cancelBtn) cancelBtn.classList.remove('hidden');

    document.getElementById('sched-project').value = sched.project || '';
    document.getElementById('sched-branch').value = sched.branch || ''; // 担当支店を追加
    document.getElementById('sched-client').value = sched.client || '';
    document.getElementById('sched-client-director').value = sched.clientDirector || '';
    document.getElementById('sched-client-rep').value = sched.clientRep || '';
    document.getElementById('sched-office-address').value = sched.officeAddress || '';
    document.getElementById('sched-work-address').value = sched.workAddress || '';
    document.getElementById('sched-start').value = sched.start || '';
    document.getElementById('sched-end').value = sched.end || '';

    // 施工予定日
    document.getElementById('sched-date-pedestal1-start').value = sched.datePedestal1Start || '';
    document.getElementById('sched-date-pedestal1-end').value = sched.datePedestal1End || '';
    document.getElementById('sched-date-pedestal2-start').value = sched.datePedestal2Start || '';
    document.getElementById('sched-date-pedestal2-end').value = sched.datePedestal2End || '';
    document.getElementById('sched-date-erection1-start').value = sched.dateErection1Start || '';
    document.getElementById('sched-date-erection1-end').value = sched.dateErection1End || '';
    document.getElementById('sched-date-erection2-start').value = sched.dateErection2Start || '';
    document.getElementById('sched-date-erection2-end').value = sched.dateErection2End || '';

    // その他工種
    document.getElementById('sched-date-roof-start').value = sched.dateRoofStart || '';
    document.getElementById('sched-date-roof-end').value = sched.dateRoofEnd || '';
    document.getElementById('sched-date-wall-start').value = sched.dateWallStart || '';
    document.getElementById('sched-date-wall-end').value = sched.dateWallEnd || '';

    // 施工体制
    const setValueAndSync = (id, val, separateId, isSeparate) => {
        const input = document.getElementById(id);
        const cb = document.getElementById(separateId);
        if (input && cb) {
            input.value = val || '';
            cb.checked = !!isSeparate;
            input.disabled = !!isSeparate;
            if (isSeparate) {
                input.style.backgroundColor = 'var(--border)';
                input.style.color = 'var(--text-muted)';
            } else {
                input.style.backgroundColor = '';
                input.style.color = '';
            }
        }
    };

    setValueAndSync('sched-const-pedestal1', sched.constPedestal1, 'sched-const-pedestal1-separate', sched.constPedestal1Separate);
    setValueAndSync('sched-const-pedestal2', sched.constPedestal2, 'sched-const-pedestal2-separate', sched.constPedestal2Separate);
    setValueAndSync('sched-const-fab1', sched.constFab1, 'sched-const-fab1-separate', sched.constFab1Separate);
    setValueAndSync('sched-const-drawing', sched.constDrawing, 'sched-const-drawing-separate', sched.constDrawingSeparate);
    setValueAndSync('sched-const-fab2', sched.constFab2, 'sched-const-fab2-separate', sched.constFab2Separate);
    setValueAndSync('sched-const-erection', sched.constErection, 'sched-const-erection-separate', sched.constErectionSeparate);
    setValueAndSync('sched-const-bolting', sched.constBolting, 'sched-const-bolting-separate', sched.constBoltingSeparate);
    setValueAndSync('sched-const-deck', sched.constDeck, 'sched-const-deck-separate', sched.constDeckSeparate);
    setValueAndSync('sched-const-stud', sched.constStud, 'sched-const-stud-separate', sched.constStudSeparate);
    setValueAndSync('sched-const-welding', sched.constWelding, 'sched-const-welding-separate', sched.constWeldingSeparate);
    setValueAndSync('sched-const-crane', sched.constCrane, 'sched-const-crane-separate', sched.constCraneSeparate);

    document.getElementById('sched-subcontractor').value = sched.subcontractor || '';
    document.getElementById('sched-memo-qty').value = sched.memoQty || '';
    document.getElementById('sched-sales-rep').value = sched.salesRep || '';
    document.getElementById('sched-const-rep').value = sched.constRep || '';
    document.getElementById('sched-site-rep').value = sched.siteRep || '';
    document.getElementById('sched-chief-tech').value = sched.chiefTech || '';
    document.getElementById('sched-bar-pattern').value = sched.barPattern || 'solid';
    document.getElementById('sched-completed').checked = !!sched.completed;
    document.getElementById('sched-notes').value = sched.notes || '';
    document.getElementById('sched-author').value = sched.author || '';

    // タブ切り替え
    const tabBtn = document.querySelector('.tab-btn[data-target="schedule-input-view"]');
    if (tabBtn) tabBtn.click();

    // 編集初期状態を保存して変更監視を開始
    lastSavedScheduleDataString = getScheduleFormDataString();
}

function resetScheduleEditMode() {
    const idInput = document.getElementById('sched-id');
    const titleEl = document.getElementById('schedule-form-title');
    const submitBtn = document.getElementById('sched-submit-btn');
    const cancelBtn = document.getElementById('sched-cancel-btn');
    const schedForm = document.getElementById('schedule-form');

    if (idInput) idInput.value = '';
    if (titleEl) titleEl.textContent = '工事を登録';
    if (submitBtn) submitBtn.textContent = '工事を登録';
    if (cancelBtn) cancelBtn.classList.add('hidden');
    if (schedForm) {
        schedForm.reset();
        // ログインユーザー名を設定
        if (currentUser) {
            const nameDisplay = currentUser.displayName || currentUser.email.split('@')[0];
            const authorEl = document.getElementById('sched-author');
            if (authorEl) authorEl.value = nameDisplay;
        }
        // 別途チェックボックスのリセット同期
        document.querySelectorAll('.separate-checkbox').forEach(cb => {
            cb.checked = false;
            const targetId = cb.id.replace('-separate', '');
            const input = document.getElementById(targetId);
            if (input) {
                input.disabled = false;
                input.style.backgroundColor = '';
                input.style.color = '';
            }
        });
    }
    // リセット（新規登録状態）の初期値を保存して変更監視を初期化
    lastSavedScheduleDataString = getScheduleFormDataString();
}

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
        background: rgba(0,0,0,0.6); z-index: 9999;
        display: flex; justify-content: center; align-items: center; padding: 20px;
        box-sizing: border-box;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
        background: white; color: #1e293b;
        border-radius: 12px; padding: 30px; width: 100%; max-width: 650px;
        max-height: 90vh; overflow-y: auto;
        box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
        box-sizing: border-box;
    `;

    // 役割・資格別プルダウン生成
    const makeOptions = (roleKey, currentVal) => {
        let optHtml = `<option value="">選択してください</option>`;
        const employees = (currentCompany && currentCompany.employees) ? currentCompany.employees : [];

        if (roleKey === 'tech') {
            // 主任技術者は資格を保有しているメンバー全員を対象とする
            const filtered = allMembers.filter(m => 
                (m.qualifications && m.qualifications.length > 0) || 
                (m.customQualifications && m.customQualifications.trim() !== "")
            );
            filtered.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
            filtered.forEach(m => {
                const selected = m.name === currentVal ? 'selected' : '';
                optHtml += `<option value="${m.name}" ${selected}>${m.name}</option>`;
            });
        } else {
            // 営業, 工務, 現場（旧site）は社員登録から
            let targetRole = '';
            if (roleKey === 'sales') targetRole = '営業';
            else if (roleKey === 'const') targetRole = '工務';
            else if (roleKey === 'site') targetRole = '現場';

            const filtered = employees.filter(emp => (emp.employeeRole || emp.role) === targetRole);
            filtered.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
            filtered.forEach(emp => {
                if (!emp.name) return;
                const selected = emp.name === currentVal ? 'selected' : '';
                optHtml += `<option value="${emp.name}" ${selected}>${emp.name}</option>`;
            });
        }

        // 現在の値が選択肢に含まれていなければ追加（互換性担保）
        if (currentVal && !optHtml.includes(`value="${currentVal}"`)) {
            optHtml += `<option value="${currentVal}" selected>${currentVal}</option>`;
        }

        return optHtml;
    };

    // 支店プルダウンの生成
    const makeBranchOptions = (currentVal) => {
        const branches = currentCompany ? (currentCompany.branches || []) : [];
        let optHtml = `<option value="">選択してください</option>`;
        branches.forEach(branch => {
            const selected = branch === currentVal ? 'selected' : '';
            optHtml += `<option value="${branch}" ${selected}>${branch}</option>`;
        });
        return optHtml;
    };

    modal.innerHTML = `
        <h3 style="margin-bottom: 20px; font-size: 1.3rem; border-bottom: 2px solid #2563eb; padding-bottom: 10px; color: #1e293b; font-weight: bold;">
            ✏️ 工程の編集・修正
        </h3>
        
        <div style="display: grid; grid-template-columns: 2fr 1.5fr 1fr 1fr; gap: 15px; margin-bottom: 15px;">
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">工事名 <span style="color:red">*</span></label>
                <input type="text" id="edit-project" value="${(sched.project || '').replace(/"/g, '&quot;')}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
            <div style="display: none;">
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">担当支店</label>
                <select id="edit-branch" style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b; height:42px;">
                    ${makeBranchOptions(sched.branch)}
                </select>
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">元請業者名</label>
                <input type="text" id="edit-client" value="${(sched.client || '').replace(/"/g, '&quot;')}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">所長名</label>
                <input type="text" id="edit-client-director" value="${(sched.clientDirector || '').replace(/"/g, '&quot;')}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">担当者名</label>
                <input type="text" id="edit-client-rep" value="${(sched.clientRep || '').replace(/"/g, '&quot;')}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">現場事務所住所</label>
                <input type="text" id="edit-office-address" value="${(sched.officeAddress || '').replace(/"/g, '&quot;')}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">作業所住所</label>
                <input type="text" id="edit-work-address" value="${(sched.workAddress || '').replace(/"/g, '&quot;')}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
        </div>

        <!-- 互換性のための非表示フィールド（全体開始日・終了日） -->
        <input type="hidden" id="edit-start" value="${sched.start || ''}">
        <input type="hidden" id="edit-end" value="${sched.end || ''}">

        <!-- 施工予定日セクション -->
        <div style="margin-top: 20px; margin-bottom: 10px; border-bottom: 2px solid #2563eb; padding-bottom: 5px;">
            <h4 style="font-size: 1rem; color: #2563eb; margin: 0; font-weight: bold;">施工予定日</h4>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b; font-size:0.9rem;">柱脚工事①</label>
                <div style="display:flex; align-items:center; gap:5px;">
                    <input type="date" id="edit-date-pedestal1-start" value="${sched.datePedestal1Start || ''}" style="flex:1; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem;">
                    <span>〜</span>
                    <input type="date" id="edit-date-pedestal1-end" value="${sched.datePedestal1End || ''}" style="flex:1; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem;">
                </div>
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b; font-size:0.9rem;">柱脚工事②</label>
                <div style="display:flex; align-items:center; gap:5px;">
                    <input type="date" id="edit-date-pedestal2-start" value="${sched.datePedestal2Start || ''}" style="flex:1; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem;">
                    <span>〜</span>
                    <input type="date" id="edit-date-pedestal2-end" value="${sched.datePedestal2End || ''}" style="flex:1; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem;">
                </div>
            </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b; font-size:0.9rem;">鉄骨建て方①</label>
                <div style="display:flex; align-items:center; gap:5px;">
                    <input type="date" id="edit-date-erection1-start" value="${sched.dateErection1Start || ''}" style="flex:1; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem;">
                    <span>〜</span>
                    <input type="date" id="edit-date-erection1-end" value="${sched.dateErection1End || ''}" style="flex:1; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem;">
                </div>
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b; font-size:0.9rem;">鉄骨建て方②</label>
                <div style="display:flex; align-items:center; gap:5px;">
                    <input type="date" id="edit-date-erection2-start" value="${sched.dateErection2Start || ''}" style="flex:1; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem;">
                    <span>〜</span>
                    <input type="date" id="edit-date-erection2-end" value="${sched.dateErection2End || ''}" style="flex:1; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem;">
                </div>
            </div>
        </div>

        <!-- 施工体制セクション -->
        <div style="margin-top: 20px; margin-bottom: 10px; border-bottom: 2px solid #2563eb; padding-bottom: 5px;">
            <h4 style="font-size: 1rem; color: #2563eb; margin: 0; font-weight: bold;">施工体制</h4>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 15px; margin-bottom: 15px;">
            <div class="form-group">
                <label style="display:flex; justify-content:space-between; align-items:center; font-weight:600; margin-bottom:3px; font-size:0.85rem; color:#1e293b;">
                    <span>柱脚工事①</span>
                    <span style="font-size:0.75rem; font-weight:normal; display:flex; align-items:center; gap:3px;">
                        <input type="checkbox" id="edit-const-pedestal1-separate" class="edit-separate-checkbox" ${sched.constPedestal1Separate ? 'checked' : ''}> 別途
                    </span>
                </label>
                <input type="text" id="edit-const-pedestal1" value="${(sched.constPedestal1 || '').replace(/"/g, '&quot;')}" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; color:#1e293b;">
            </div>
            <div class="form-group">
                <label style="display:flex; justify-content:space-between; align-items:center; font-weight:600; margin-bottom:3px; font-size:0.85rem; color:#1e293b;">
                    <span>柱脚工事②</span>
                    <span style="font-size:0.75rem; font-weight:normal; display:flex; align-items:center; gap:3px;">
                        <input type="checkbox" id="edit-const-pedestal2-separate" class="edit-separate-checkbox" ${sched.constPedestal2Separate ? 'checked' : ''}> 別途
                    </span>
                </label>
                <input type="text" id="edit-const-pedestal2" value="${(sched.constPedestal2 || '').replace(/"/g, '&quot;')}" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; color:#1e293b;">
            </div>
            <div class="form-group">
                <label style="display:flex; justify-content:space-between; align-items:center; font-weight:600; margin-bottom:3px; font-size:0.85rem; color:#1e293b;">
                    <span>鉄骨製作①</span>
                    <span style="font-size:0.75rem; font-weight:normal; display:flex; align-items:center; gap:3px;">
                        <input type="checkbox" id="edit-const-fab1-separate" class="edit-separate-checkbox" ${sched.constFab1Separate ? 'checked' : ''}> 別途
                    </span>
                </label>
                <input type="text" id="edit-const-fab1" value="${(sched.constFab1 || '').replace(/"/g, '&quot;')}" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; color:#1e293b;">
            </div>
            <div class="form-group">
                <label style="display:flex; justify-content:space-between; align-items:center; font-weight:600; margin-bottom:3px; font-size:0.85rem; color:#1e293b;">
                    <span>施工図</span>
                    <span style="font-size:0.75rem; font-weight:normal; display:flex; align-items:center; gap:3px;">
                        <input type="checkbox" id="edit-const-drawing-separate" class="edit-separate-checkbox" ${sched.constDrawingSeparate ? 'checked' : ''}> 別途
                    </span>
                </label>
                <input type="text" id="edit-const-drawing" value="${(sched.constDrawing || '').replace(/"/g, '&quot;')}" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; color:#1e293b;">
            </div>
            <div class="form-group">
                <label style="display:flex; justify-content:space-between; align-items:center; font-weight:600; margin-bottom:3px; font-size:0.85rem; color:#1e293b;">
                    <span>鉄骨製作②</span>
                    <span style="font-size:0.75rem; font-weight:normal; display:flex; align-items:center; gap:3px;">
                        <input type="checkbox" id="edit-const-fab2-separate" class="edit-separate-checkbox" ${sched.constFab2Separate ? 'checked' : ''}> 別途
                    </span>
                </label>
                <input type="text" id="edit-const-fab2" value="${(sched.constFab2 || '').replace(/"/g, '&quot;')}" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; color:#1e293b;">
            </div>
            <div class="form-group">
                <label style="display:flex; justify-content:space-between; align-items:center; font-weight:600; margin-bottom:3px; font-size:0.85rem; color:#1e293b;">
                    <span>建て方工事</span>
                    <span style="font-size:0.75rem; font-weight:normal; display:flex; align-items:center; gap:3px;">
                        <input type="checkbox" id="edit-const-erection-separate" class="edit-separate-checkbox" ${sched.constErectionSeparate ? 'checked' : ''}> 別途
                    </span>
                </label>
                <input type="text" id="edit-const-erection" value="${(sched.constErection || '').replace(/"/g, '&quot;')}" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; color:#1e293b;">
            </div>
            <div class="form-group">
                <label style="display:flex; justify-content:space-between; align-items:center; font-weight:600; margin-bottom:3px; font-size:0.85rem; color:#1e293b;">
                    <span>本締め工事</span>
                    <span style="font-size:0.75rem; font-weight:normal; display:flex; align-items:center; gap:3px;">
                        <input type="checkbox" id="edit-const-bolting-separate" class="edit-separate-checkbox" ${sched.constBoltingSeparate ? 'checked' : ''}> 別途
                    </span>
                </label>
                <input type="text" id="edit-const-bolting" value="${(sched.constBolting || '').replace(/"/g, '&quot;')}" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; color:#1e293b;">
            </div>
            <div class="form-group">
                <label style="display:flex; justify-content:space-between; align-items:center; font-weight:600; margin-bottom:3px; font-size:0.85rem; color:#1e293b;">
                    <span>床版工事</span>
                    <span style="font-size:0.75rem; font-weight:normal; display:flex; align-items:center; gap:3px;">
                        <input type="checkbox" id="edit-const-deck-separate" class="edit-separate-checkbox" ${sched.constDeckSeparate ? 'checked' : ''}> 別途
                    </span>
                </label>
                <input type="text" id="edit-const-deck" value="${(sched.constDeck || '').replace(/"/g, '&quot;')}" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; color:#1e293b;">
            </div>
            <div class="form-group">
                <label style="display:flex; justify-content:space-between; align-items:center; font-weight:600; margin-bottom:3px; font-size:0.85rem; color:#1e293b;">
                    <span>スタッド工事</span>
                    <span style="font-size:0.75rem; font-weight:normal; display:flex; align-items:center; gap:3px;">
                        <input type="checkbox" id="edit-const-stud-separate" class="edit-separate-checkbox" ${sched.constStudSeparate ? 'checked' : ''}> 別途
                    </span>
                </label>
                <input type="text" id="edit-const-stud" value="${(sched.constStud || '').replace(/"/g, '&quot;')}" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; color:#1e293b;">
            </div>
            <div class="form-group">
                <label style="display:flex; justify-content:space-between; align-items:center; font-weight:600; margin-bottom:3px; font-size:0.85rem; color:#1e293b;">
                    <span>現場溶接工事</span>
                    <span style="font-size:0.75rem; font-weight:normal; display:flex; align-items:center; gap:3px;">
                        <input type="checkbox" id="edit-const-welding-separate" class="edit-separate-checkbox" ${sched.constWeldingSeparate ? 'checked' : ''}> 別途
                    </span>
                </label>
                <input type="text" id="edit-const-welding" value="${(sched.constWelding || '').replace(/"/g, '&quot;')}" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; color:#1e293b;">
            </div>
            <div class="form-group">
                <label style="display:flex; justify-content:space-between; align-items:center; font-weight:600; margin-bottom:3px; font-size:0.85rem; color:#1e293b;">
                    <span>建て方重機</span>
                    <span style="font-size:0.75rem; font-weight:normal; display:flex; align-items:center; gap:3px;">
                        <input type="checkbox" id="edit-const-crane-separate" class="edit-separate-checkbox" ${sched.constCraneSeparate ? 'checked' : ''}> 別途
                    </span>
                </label>
                <input type="text" id="edit-const-crane" value="${(sched.constCrane || '').replace(/"/g, '&quot;')}" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; color:#1e293b;">
            </div>
        </div>

        <!-- その他工種セクション -->
        <div style="margin-top: 20px; margin-bottom: 10px; border-bottom: 2px solid #2563eb; padding-bottom: 5px;">
            <h4 style="font-size: 1rem; color: #2563eb; margin: 0; font-weight: bold;">その他工種</h4>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b; font-size:0.9rem;">屋根工事</label>
                <div style="display:flex; align-items:center; gap:5px;">
                    <input type="date" id="edit-date-roof-start" value="${sched.dateRoofStart || ''}" style="flex:1; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem;">
                    <span>〜</span>
                    <input type="date" id="edit-date-roof-end" value="${sched.dateRoofEnd || ''}" style="flex:1; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem;">
                </div>
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b; font-size:0.9rem;">外壁工事</label>
                <div style="display:flex; align-items:center; gap:5px;">
                    <input type="date" id="edit-date-wall-start" value="${sched.dateWallStart || ''}" style="flex:1; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem;">
                    <span>〜</span>
                    <input type="date" id="edit-date-wall-end" value="${sched.dateWallEnd || ''}" style="flex:1; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem;">
                </div>
            </div>
        </div>

        <!-- 数量・担当者セクション -->
        <div style="margin-top: 20px; margin-bottom: 10px; border-bottom: 2px solid #2563eb; padding-bottom: 5px;">
            <h4 style="font-size: 1rem; color: #2563eb; margin: 0; font-weight: bold;">数量・担当者</h4>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">管理補助</label>
                <input type="text" id="edit-subcontractor" value="${(sched.subcontractor || '').replace(/"/g, '&quot;')}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">数量（ｔ、㎡）</label>
                <input type="text" id="edit-memo-qty" value="${(sched.memoQty || '').replace(/"/g, '&quot;')}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; margin-bottom: 15px;">
            <div>
                <label style="display:block; font-weight:600; margin-bottom:3px; color:#1e293b; font-size:0.85rem;">営業担当</label>
                <select id="edit-sales-rep" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; color:#1e293b;">
                    ${makeOptions('sales', sched.salesRep)}
                </select>
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:3px; color:#1e293b; font-size:0.85rem;">工務担当</label>
                <select id="edit-const-rep" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; color:#1e293b;">
                    ${makeOptions('const', sched.constRep)}
                </select>
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:3px; color:#1e293b; font-size:0.85rem;">現場担当</label>
                <select id="edit-site-rep" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; color:#1e293b;">
                    ${makeOptions('site', sched.siteRep)}
                </select>
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:3px; color:#1e293b; font-size:0.85rem;">主任技術者</label>
                <select id="edit-chief-tech" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; color:#1e293b;">
                    ${makeOptions('tech', sched.chiefTech)}
                </select>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr 0.8fr; gap: 10px; align-items: center; margin-bottom: 15px;">
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">バーの色</label>
                <select id="edit-bar-color" style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; color:#1e293b;">
                    <option value="#16a34a" style="background:#16a34a; color:#fff;" ${sched.barColor === '#16a34a' ? 'selected' : ''}>緑</option>
                    <option value="#2563eb" style="background:#2563eb; color:#fff;" ${sched.barColor === '#2563eb' ? 'selected' : ''}>青</option>
                    <option value="#ea580c" style="background:#ea580c; color:#fff;" ${sched.barColor === '#ea580c' ? 'selected' : ''}>オレンジ</option>
                    <option value="#9333ea" style="background:#9333ea; color:#fff;" ${sched.barColor === '#9333ea' ? 'selected' : ''}>紫</option>
                    <option value="#db2777" style="background:#db2777; color:#fff;" ${sched.barColor === '#db2777' ? 'selected' : ''}>ピンク</option>
                    <option value="#ca8a04" style="background:#ca8a04; color:#fff;" ${sched.barColor === '#ca8a04' ? 'selected' : ''}>黄</option>
                </select>
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">バーの模様</label>
                <select id="edit-bar-pattern" style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; color:#1e293b;">
                    <option value="solid" ${sched.barPattern === 'solid' ? 'selected' : ''}>通常 (塗りつぶし)</option>
                    <option value="stripe" ${sched.barPattern === 'stripe' ? 'selected' : ''}>ストライプ (斜線)</option>
                </select>
            </div>
            <div style="display:flex; align-items:center; gap:8px; margin-top:25px; justify-content:center;">
                <input type="checkbox" id="edit-completed" style="width:20px; height:20px; margin:0;" ${sched.completed ? 'checked' : ''}>
                <label for="edit-completed" style="margin:0; font-weight:bold; white-space:nowrap; cursor:pointer; color:#1e293b;">工程完了</label>
            </div>
        </div>

        <div style="margin-bottom: 20px;">
            <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">登録者（編集不可）</label>
            <input type="text" id="edit-author" value="${(sched.author || '').replace(/"/g, '&quot;')}" readonly
                style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; background:#f1f5f9; color:#64748b;">
        </div>

        <div style="margin-bottom: 20px;">
            <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">作業内容・備考</label>
            <textarea id="edit-notes" rows="2"
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

    // オートコンプリートの無効化とEnterキー送信防止
    modal.querySelectorAll('input').forEach(inp => inp.setAttribute('autocomplete', 'off'));
    modal.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
            e.preventDefault();
        }
    });

    // 編集モーダル内での別途工事グレーアウト制御
    const syncEditSeparate = (cb) => {
        const targetId = cb.id.replace('-separate', '');
        const input = document.getElementById(targetId);
        if (input) {
            input.disabled = cb.checked;
            if (cb.checked) {
                input.style.backgroundColor = 'var(--border)';
                input.style.color = 'var(--text-muted)';
            } else {
                input.style.backgroundColor = '';
                input.style.color = '';
            }
        }
    };
    modal.querySelectorAll('.edit-separate-checkbox').forEach(cb => {
        syncEditSeparate(cb);
        cb.addEventListener('change', () => syncEditSeparate(cb));
    });

    // オーバーレイ背景クリックで閉じる
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    // キャンセルボタン
    document.getElementById('edit-cancel-btn').addEventListener('click', () => overlay.remove());

    // 保存ボタン
    document.getElementById('edit-save-btn').addEventListener('click', async () => {
        const saveBtn = document.getElementById('edit-save-btn');
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';

        // 各種日付取得とチェック
        const p1Start = document.getElementById('edit-date-pedestal1-start').value;
        const p1End = document.getElementById('edit-date-pedestal1-end').value;
        if (p1Start && p1End && p1Start > p1End) { alert('柱脚工事①の終了日は開始日より後の日付にしてください。'); saveBtn.disabled = false; saveBtn.innerHTML = '💾 保存する'; return; }

        const p2Start = document.getElementById('edit-date-pedestal2-start').value;
        const p2End = document.getElementById('edit-date-pedestal2-end').value;
        if (p2Start && p2End && p2Start > p2End) { alert('柱脚工事②の終了日は開始日より後の日付にしてください。'); saveBtn.disabled = false; saveBtn.innerHTML = '💾 保存する'; return; }

        const e1Start = document.getElementById('edit-date-erection1-start').value;
        const e1End = document.getElementById('edit-date-erection1-end').value;
        if (e1Start && e1End && e1Start > e1End) { alert('鉄骨建て方①の終了日は開始日より後の日付にしてください。'); saveBtn.disabled = false; saveBtn.innerHTML = '💾 保存する'; return; }

        const e2Start = document.getElementById('edit-date-erection2-start').value;
        const e2End = document.getElementById('edit-date-erection2-end').value;
        if (e2Start && e2End && e2Start > e2End) { alert('鉄骨建て方②の終了日は開始日より後の日付にしてください。'); saveBtn.disabled = false; saveBtn.innerHTML = '💾 保存する'; return; }

        const rStart = document.getElementById('edit-date-roof-start').value;
        const rEnd = document.getElementById('edit-date-roof-end').value;
        if (rStart && rEnd && rStart > rEnd) { alert('屋根工事の終了日は開始日より後の日付にしてください。'); saveBtn.disabled = false; saveBtn.innerHTML = '💾 保存する'; return; }

        const wStart = document.getElementById('edit-date-wall-start').value;
        const wEnd = document.getElementById('edit-date-wall-end').value;
        if (wStart && wEnd && wStart > wEnd) { alert('外壁工事の終了日は開始日より後の日付にしてください。'); saveBtn.disabled = false; saveBtn.innerHTML = '💾 保存する'; return; }

        // 全体期間の自動決定（建て方①と建て方②を基準に自動算出）
        const resolvedStart = e1Start || e2Start || '';
        const resolvedEnd = e2End || e1End || '';

        // 作業所住所の取得
        const workAddressVal = document.getElementById('edit-work-address').value.trim();

        const updatedData = {
            companyId: currentCompany ? currentCompany.companyId : currentUser.email.split('@')[1],
            project: document.getElementById('edit-project').value.trim(),
            branch: document.getElementById('edit-branch').value, // 担当支店を追加
            client: document.getElementById('edit-client').value.trim(),
            clientDirector: document.getElementById('edit-client-director').value.trim(),
            clientRep: document.getElementById('edit-client-rep').value.trim(),
            address: workAddressVal, // 互換性のため
            officeAddress: document.getElementById('edit-office-address').value.trim(),
            workAddress: workAddressVal,
            start: resolvedStart,
            end: resolvedEnd,
            // 日付
            datePedestal1Start: p1Start,
            datePedestal1End: p1End,
            datePedestal2Start: p2Start,
            datePedestal2End: p2End,
            dateErection1Start: e1Start,
            dateErection1End: e1End,
            dateErection2Start: e2Start,
            dateErection2End: e2End,
            dateRoofStart: rStart,
            dateRoofEnd: rEnd,
            dateWallStart: wStart,
            dateWallEnd: wEnd,
            // 施工体制
            constPedestal1: document.getElementById('edit-const-pedestal1').value.trim(),
            constPedestal1Separate: document.getElementById('edit-const-pedestal1-separate').checked,
            constPedestal2: document.getElementById('edit-const-pedestal2').value.trim(),
            constPedestal2Separate: document.getElementById('edit-const-pedestal2-separate').checked,
            constFab1: document.getElementById('edit-const-fab1').value.trim(),
            constFab1Separate: document.getElementById('edit-const-fab1-separate').checked,
            constDrawing: document.getElementById('edit-const-drawing').value.trim(),
            constDrawingSeparate: document.getElementById('edit-const-drawing-separate').checked,
            constFab2: document.getElementById('edit-const-fab2').value.trim(),
            constFab2Separate: document.getElementById('edit-const-fab2-separate').checked,
            constErection: document.getElementById('edit-const-erection').value.trim(),
            constErectionSeparate: document.getElementById('edit-const-erection-separate').checked,
            constBolting: document.getElementById('edit-const-bolting').value.trim(),
            constBoltingSeparate: document.getElementById('edit-const-bolting-separate').checked,
            constDeck: document.getElementById('edit-const-deck').value.trim(),
            constDeckSeparate: document.getElementById('edit-const-deck-separate').checked,
            constStud: document.getElementById('edit-const-stud').value.trim(),
            constStudSeparate: document.getElementById('edit-const-stud-separate').checked,
            constWelding: document.getElementById('edit-const-welding').value.trim(),
            constWeldingSeparate: document.getElementById('edit-const-welding-separate').checked,
            constCrane: document.getElementById('edit-const-crane').value.trim(),
            constCraneSeparate: document.getElementById('edit-const-crane-separate').checked,

            subcontractor: document.getElementById('edit-subcontractor').value.trim(),
            memoQty: toHalfWidth(document.getElementById('edit-memo-qty').value.trim()),
            salesRep: document.getElementById('edit-sales-rep').value,
            constRep: document.getElementById('edit-const-rep').value,
            siteRep: document.getElementById('edit-site-rep').value,
            chiefTech: document.getElementById('edit-chief-tech').value,
            assignType: "none",
            barColor: document.getElementById('edit-bar-color').value,
            barPattern: document.getElementById('edit-bar-pattern').value,
            completed: document.getElementById('edit-completed').checked,
            notes: document.getElementById('edit-notes').value.trim(),
        };

        if (!updatedData.project) {
            alert('工事名は必須です。');
            saveBtn.disabled = false;
            saveBtn.innerHTML = '💾 保存する';
            return;
        }
        if (updatedData.memoQty && !/^[0-9]+(\.[0-9]+)?$/.test(updatedData.memoQty)) {
            alert('数量は数字で入力してください。（例: 150）');
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

// パスワードの表示・非表示切り替えイベントハンドラ
document.addEventListener('DOMContentLoaded', () => {
    const eyeSvg = `<svg class="eye-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 20px; height: 20px;"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>`;
    const eyeSlashSvg = `<svg class="eye-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 20px; height: 20px;"><path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.388 4.17 5.322 7.178 9.963 7.178.892 0 1.761-.137 2.585-.395m6-.046c.118-.119.231-.242.34-.368a10.457 10.457 0 0 0 2.045-3.777c-1.388-4.17-5.322-7.178-9.963-7.178-.925 0-1.82.146-2.665.418m11.233 11.233-18-18" /><path stroke-linecap="round" stroke-linejoin="round" d="M8.684 8.684A3 3 0 1 0 12.32 12.32" /></svg>`;
    
    document.querySelectorAll('.toggle-password-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const input = document.getElementById(targetId);
            if (input) {
                if (input.type === 'password') {
                    input.type = 'text';
                    btn.innerHTML = eyeSlashSvg; // スラッシュ付き目のアイコン（非表示）に変更
                } else {
                    input.type = 'password';
                    btn.innerHTML = eyeSvg; // 通常の目のアイコン（表示）に変更
                }
            }
        });
    });

    // パスワード強制変更フォームの制御
    const pwdForm = document.getElementById('password-change-form');
    if (pwdForm) {
        pwdForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newPassword = document.getElementById('new-password').value;
            const newPasswordConfirm = document.getElementById('new-password-confirm').value;
            const errorMsg = document.getElementById('password-change-error');
            const submitBtn = pwdForm.querySelector('button[type="submit"]');
            
            errorMsg.className = 'message error hidden';
            errorMsg.textContent = '';
            
            if (newPassword !== newPasswordConfirm) {
                errorMsg.className = 'message error';
                errorMsg.textContent = 'パスワードが一致しません。';
                return;
            }
            if (newPassword.length < 6) {
                errorMsg.className = 'message error';
                errorMsg.textContent = 'パスワードは6文字以上で設定してください。';
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = 'パスワードを設定中...';

            try {
                // Firebase Auth パスワードの更新
                await updatePassword(auth.currentUser, newPassword);
                
                // Firestore の社員オブジェクトから mustChangePassword: true を削除 (または false に変更)
                if (currentCompany && currentCompany.companyId) {
                    await loadLatestCompanyInfo(); // 最新情報に更新
                    const employees = currentCompany.employees || [];
                    const updatedEmployees = employees.map(emp => {
                        if (emp.uid === currentUser.uid) {
                            const newEmp = { ...emp };
                            delete newEmp.mustChangePassword; // フラグを消去
                            return newEmp;
                        }
                        return emp;
                    });
                    
                    const compDocRef = doc(db, "companies", currentCompany.companyId);
                    await updateDoc(compDocRef, { employees: updatedEmployees });
                }
                
                const successMsg = document.getElementById('password-change-success');
                if (successMsg) {
                    successMsg.className = 'message success';
                    successMsg.textContent = 'パスワードの初期設定が完了しました！システムを開始します...';
                    successMsg.classList.remove('hidden');
                }
                setTimeout(() => {
                    const modal = document.getElementById('password-change-modal');
                    if (modal) {
                        modal.style.display = 'none';
                    }
                    if (successMsg) {
                        successMsg.classList.add('hidden');
                    }
                }, 1500);
            } catch (err) {
                console.error("Password change failed", err);
                errorMsg.className = 'message error';
                errorMsg.classList.remove('hidden');
                if (err.code === 'auth/requires-recent-login') {
                    errorMsg.textContent = 'セキュリティ上の理由により、再ログインが必要です。一度ログアウトし、再度ログインしてから変更してください。';
                } else {
                    errorMsg.textContent = 'パスワードの変更に失敗しました: ' + err.message;
                }
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'パスワードを設定して利用開始';
            }
        });
    }

    // パスワード強制変更モーダル内のログアウト処理
    const btnPassChangeLogout = document.getElementById('btn-password-change-logout');
    if (btnPassChangeLogout) {
        btnPassChangeLogout.addEventListener('click', () => {
            signOut(auth).catch(err => console.error(err));
        });
    }

    // PWAアプリ内インストールボタン制御
    let deferredPrompt = null;
    const btnInstallApp = document.getElementById('btn-install-app');

    window.addEventListener('beforeinstallprompt', (e) => {
        // ブラウザのデフォルトバナーを抑止
        e.preventDefault();
        // イベントオブジェクトを保持
        deferredPrompt = e;
        // インストールボタンを表示
        if (btnInstallApp) {
            btnInstallApp.style.display = 'inline-flex';
        }
    });

    if (btnInstallApp) {
        btnInstallApp.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            // プロンプトをポップアップ表示
            deferredPrompt.prompt();
            // ユーザーの決定を待つ
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`User response to PWA install: ${outcome}`);
            deferredPrompt = null;
            btnInstallApp.style.display = 'none';
        });
    }

    // すでにスタンドアロン起動している場合はボタンを非表示
    // 施工体制の「別途工事」チェックボックスによるグレーアウト制御
    const syncSeparateInput = (checkbox) => {
        const targetId = checkbox.id.replace('-separate', '');
        const input = document.getElementById(targetId);
        if (input) {
            input.disabled = checkbox.checked;
            if (checkbox.checked) {
                input.style.backgroundColor = 'var(--border)';
                input.style.color = 'var(--text-muted)';
            } else {
                input.style.backgroundColor = '';
                input.style.color = '';
            }
        }
    };

    const initSeparateCheckboxes = () => {
        document.querySelectorAll('.separate-checkbox').forEach(cb => {
            syncSeparateInput(cb);
            cb.addEventListener('change', () => syncSeparateInput(cb));
        });
    };
    initSeparateCheckboxes();

    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
        if (btnInstallApp) btnInstallApp.style.display = 'none';
    }
});

