// public/system-admin.js
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
import { getAuth, onAuthStateChanged, signOut, connectAuthEmulator, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, updateDoc, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Firebase初期化
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ローカル実行時はエミュレータに接続する
const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
if (isLocal) {
    connectFirestoreEmulator(db, "127.0.0.1", 8084);
    connectAuthEmulator(auth, "http://127.0.0.1:9101");
}

const DEVELOPER_EMAILS = ['steelworks@areva.co.jp'];

const checkIsDeveloper = (user) => {
    if (!user) return false;
    if (user.email) {
        const emailLower = user.email.toLowerCase().trim();
        if (DEVELOPER_EMAILS.includes(emailLower)) return true;
    }
    return false;
};

let allCompanies = [];
let allSchedules = [];

// 認証監視
onAuthStateChanged(auth, async (user) => {
    if (!user || !checkIsDeveloper(user)) {
        // 開発者以外（または未ログイン）は index.html へリダイレクト
        console.warn("Unauthorized access to system-admin. Redirecting to index.html...");
        window.location.href = "index.html";
        return;
    }

    // ヘッダーUI制御
    document.getElementById('dev-email-display').textContent = user.email;
    
    // 動作確認画面へ戻るボタンの表示（ローカル環境のみ表示）
    const backBtn = document.getElementById('btn-back-to-system');
    if (backBtn) {
        backBtn.style.display = isLocal ? 'inline-flex' : 'none';
    }

    // ログアウト処理
    document.getElementById('btn-dev-logout').onclick = async () => {
        if (confirm("ログアウトしますか？")) {
            await signOut(auth);
            window.location.href = "index.html";
        }
    };

    // データの読み込みと初期描画
    await loadAndRenderData();
});

async function loadAndRenderData() {
    const loadingDiv = document.getElementById('loading');
    const companyListDiv = document.getElementById('company-list');

    try {
        loadingDiv.style.display = 'block';
        loadingDiv.textContent = "データを読み込み中...";
        companyListDiv.style.display = 'none';

        // 1. 会社一覧とスケジュール一覧を同時に非同期取得
        const [companiesSnapshot, schedulesSnapshot] = await Promise.all([
            getDocs(collection(db, "companies")),
            getDocs(collection(db, "schedules"))
        ]);

        allCompanies = [];
        companiesSnapshot.forEach(docSnap => {
            const data = docSnap.data();
            data.companyId = docSnap.id;
            allCompanies.push(data);
        });

        allSchedules = [];
        schedulesSnapshot.forEach(docSnap => {
            const data = docSnap.data();
            data.id = docSnap.id;
            allSchedules.push(data);
        });

        // 2. 会社ごとのスケジュール件数集計
        const scheduleCounts = {};
        allSchedules.forEach(sched => {
            const cid = sched.companyId;
            if (cid) {
                scheduleCounts[cid] = (scheduleCounts[cid] || 0) + 1;
            }
        });

        // 3. ドロップダウン（絞り込み用）の初期化
        const filterSelect = document.getElementById('select-company-filter');
        filterSelect.innerHTML = '<option value="all">全社データ表示</option>';
        allCompanies.forEach(comp => {
            const opt = document.createElement('option');
            opt.value = comp.companyId;
            opt.textContent = comp.companyName || comp.companyId;
            filterSelect.appendChild(opt);
        });

        // 4. 企業カードグリッドの描画
        renderCompanyCards(scheduleCounts);

        // 5. 全社工事予定テーブルの初期描画（全件表示）
        renderSchedulesTable('all');

        loadingDiv.style.display = 'none';
        companyListDiv.style.display = 'grid';

        // 6. コントロールパネルのイベント登録
        document.getElementById('btn-reload-data').onclick = () => {
            loadAndRenderData();
        };

        document.getElementById('btn-show-all-data').onclick = () => {
            filterSelect.value = 'all';
            renderSchedulesTable('all');
        };

        filterSelect.onchange = (e) => {
            renderSchedulesTable(e.target.value);
        };

    } catch (e) {
        console.error("Error loading data:", e);
        loadingDiv.innerHTML = `
            <div style="color:#ef4444;text-align:left;padding:15px;background:#fee2e2;border-radius:8px;border:1px solid #fca5a5;">
                <strong>データの読み込み中にエラーが発生しました:</strong><br>
                <span>${e.message}</span><br>
                <pre style="margin-top:10px;font-size:0.8rem;white-space:pre-wrap;">${e.stack || ''}</pre>
            </div>
        `;
    }
}

// 企業カードを描画する関数
function renderCompanyCards(scheduleCounts) {
    const companyListDiv = document.getElementById('company-list');
    let html = '';

    allCompanies.forEach((company, index) => {
        const companyId = company.companyId;
        const companyName = company.companyName || "名称未設定の企業";
        const membersCount = (company.memberEmails || []).length;
        const schedulesCount = scheduleCounts[companyId] || 0;
        const adminEmailsStr = (company.adminEmails || []).join(', ');
        
        // カード枠線の色バリエーションを循環させる
        const styleClass = `style-${index % 4}`;

        html += `
            <div class="company-card ${styleClass}" data-id="${escapeHTML(companyId)}">
                <div class="company-name">${escapeHTML(companyName)}</div>
                <div class="company-info">
                    <strong>会社ID:</strong> <span class="badge-cid">${escapeHTML(companyId)}</span><br>
                    <strong>👥 登録社員数:</strong> ${escapeHTML(membersCount)} 名<br>
                    <strong>🏗️ 登録工事数:</strong> ${escapeHTML(schedulesCount)} 件<br>
                    <strong>🔑 管理者:</strong> <span style="font-size:0.85rem;color:#475569;">${escapeHTML(adminEmailsStr)}</span>
                </div>
                <div class="card-buttons">
                    <button class="btn-card-action btn-enter" data-action="enter" data-id="${escapeHTML(companyId)}">
                        🔑 入力画面に入る
                    </button>
                    <button class="btn-card-action btn-edit-mail" data-action="edit-mail" data-id="${escapeHTML(companyId)}">
                        ✏️ 管理者メール変更
                    </button>
                    <button class="btn-card-action btn-reset-pw" data-action="reset-pw" data-id="${escapeHTML(companyId)}">
                        📧 パスワードリセット送信
                    </button>
                </div>
                <div class="card-footer-tip">クリックで絞り込み →</div>
            </div>
        `;
    });

    companyListDiv.innerHTML = html;

    // 各種カードボタン＆カード自体のクリックイベント登録
    companyListDiv.querySelectorAll('.company-card').forEach(card => {
        const companyId = card.dataset.id;

        // カード本体のクリック時（工事テーブルの絞り込み）
        card.onclick = (e) => {
            // ボタンのクリック時はカードのクリック処理を発火させない
            if (e.target.closest('button')) return;
            
            const filterSelect = document.getElementById('select-company-filter');
            filterSelect.value = companyId;
            renderSchedulesTable(companyId);
            
            // スクロールしてテーブルを見せる
            document.querySelector('.data-section').scrollIntoView({ behavior: 'smooth' });
        };

        // ボタン群のアクション登録
        card.querySelectorAll('.btn-card-action').forEach(btn => {
            btn.onclick = async (e) => {
                e.stopPropagation(); // バブリング防止
                const action = btn.dataset.action;
                const comp = allCompanies.find(c => c.companyId === companyId);
                if (!comp) return;

                if (action === 'enter') {
                    // 1. 代理ログイン（代理閲覧）
                    sessionStorage.setItem('impersonate_company_id', companyId);
                    window.open('index.html', '_blank');
                } else if (action === 'edit-mail') {
                    // 2. 管理者メールの変更
                    const currentEmails = (comp.adminEmails || []).join(', ');
                    const newEmail = prompt(`「${comp.companyName || companyId}」の新しい管理者メールアドレスを入力してください（カンマ区切りで複数指定可能）:`, currentEmails);
                    if (newEmail !== null) {
                        const emailsArray = newEmail.split(',').map(m => m.trim()).filter(Boolean);
                        if (emailsArray.length === 0) {
                            alert("メールアドレスは最低1つ登録されている必要があります。");
                            return;
                        }
                        try {
                            await updateDoc(doc(db, "companies", companyId), {
                                adminEmails: emailsArray
                            });
                            alert("管理者メールアドレスを更新しました！");
                            loadAndRenderData(); // 再ロード
                        } catch (err) {
                            console.error(err);
                            alert("更新に失敗しました: " + err.message);
                        }
                    }
                } else if (action === 'reset-pw') {
                    // 3. パスワードリセットメールの送信
                    const firstAdmin = (comp.adminEmails || [])[0];
                    if (!firstAdmin) {
                        alert("この会社には管理者メールアドレスが設定されていません。");
                        return;
                    }
                    if (confirm(`管理者「${firstAdmin}」宛てにパスワードリセットメールを送信しますか？`)) {
                        try {
                            await sendPasswordResetEmail(auth, firstAdmin);
                            alert(`パスワード再設定メールを ${firstAdmin} 宛てに送信しました！`);
                        } catch (err) {
                            console.error(err);
                            alert("送信に失敗しました: " + err.message);
                        }
                    }
                }
            };
        });
    });
}

// スケジュール一覧テーブルを描画・フィルタリングする関数
function renderSchedulesTable(filterCompanyId) {
    const tbody = document.getElementById('schedules-table-body');
    const countDisplay = document.getElementById('data-count-display');

    // フィルタリング処理
    const filtered = allSchedules.filter(sched => {
        if (filterCompanyId === 'all') return true;
        return sched.companyId === filterCompanyId;
    });

    countDisplay.textContent = `全 ${filtered.length} 件`;

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align:center; color:#94a3b8;">表示するスケジュールデータがありません。</td>
            </tr>
        `;
        return;
    }

    // 会社名マッピング辞書の作成
    const companyNameMap = {};
    allCompanies.forEach(comp => {
        companyNameMap[comp.companyId] = comp.companyName || comp.companyId;
    });

    let html = '';
    filtered.forEach(sched => {
        const cname = companyNameMap[sched.companyId] || sched.companyId || "不明な企業";
        const author = sched.author || "不明";
        const projectName = sched.project || "名称未設定";
        
        // 作成日時のフォーマット
        let dateStr = "未設定";
        if (sched.timestamp) {
            try {
                dateStr = new Date(sched.timestamp).toLocaleString('ja-JP');
            } catch (e) {}
        }

        html += `
            <tr>
                <td>
                    <span class="badge-cid">${escapeHTML(sched.companyId)}</span>
                    <strong>${escapeHTML(cname)}</strong>
                </td>
                <td>${escapeHTML(author)}</td>
                <td>${escapeHTML(projectName)}</td>
                <td>${escapeHTML(dateStr)}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    const valStr = String(str);
    return valStr.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}
