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
import { getAuth, onAuthStateChanged, signOut, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Firebase初期化
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ローカル実行時はエミュレータに接続する
if (location.hostname === "localhost") {
    connectFirestoreEmulator(db, "localhost", 8084);
    connectAuthEmulator(auth, "http://localhost:9101");
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

// 認証監視
onAuthStateChanged(auth, async (user) => {
    if (!user || !checkIsDeveloper(user)) {
        // 開発者以外（または未ログイン）は index.html へリダイレクト
        console.warn("Unauthorized access to system-admin. Redirecting to index.html...");
        window.location.href = "index.html";
        return;
    }

    // 企業一覧のロードと描画
    try {
        const querySnapshot = await getDocs(collection(db, "companies"));
        const companyListDiv = document.getElementById('company-list');
        const loadingDiv = document.getElementById('loading');

        if (querySnapshot.empty) {
            loadingDiv.textContent = "登録されている企業がありません。";
            return;
        }

        let html = '';
        querySnapshot.forEach((docSnap) => {
            const company = docSnap.data();
            const companyId = docSnap.id;
            const companyName = company.companyName || "名称未設定の企業";
            const ownerUid = company.ownerUid || "未設定";
            const membersCount = (company.memberEmails || []).length;
            const adminsCount = (company.adminEmails || []).length;

            html += `
                <div class="company-card">
                    <div class="company-name">${escapeHTML(companyName)}</div>
                    <div class="company-info">
                        <strong>会社ID:</strong> ${escapeHTML(companyId)}<br>
                        <strong>管理者:</strong> ${escapeHTML(adminsCount)}名<br>
                        <strong>社員:</strong> ${escapeHTML(membersCount)}名<br>
                        <strong>Owner UID:</strong> <span style="font-size:0.8rem;color:#888;">${escapeHTML(ownerUid)}</span>
                    </div>
                    <button class="btn-impersonate" data-id="${escapeHTML(companyId)}">
                        👤 入力画面へ
                    </button>
                </div>
            `;
        });

        companyListDiv.innerHTML = html;
        loadingDiv.style.display = 'none';
        companyListDiv.style.display = 'grid';

        // 代理ログインボタンのイベントリスナー
        companyListDiv.querySelectorAll('.btn-impersonate').forEach(btn => {
            btn.onclick = () => {
                const companyId = btn.dataset.id;
                sessionStorage.setItem('impersonate_company_id', companyId);
                // 別タブで index.html（ログイン後のメイン画面）を開く
                window.open('index.html', '_blank');
            };
        });

    } catch (e) {
        console.error("Error loading companies:", e);
        document.getElementById('loading').textContent = "データの読み込み中にエラーが発生しました。";
    }
});

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}
