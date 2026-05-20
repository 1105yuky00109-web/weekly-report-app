// Netlifyビルド時に環境変数をapp.jsに注入するスクリプト
// node build-inject.js で実行

const fs = require('fs');
const path = require('path');

const appJsPath = path.join(__dirname, 'public', 'app.js');
let content = fs.readFileSync(appJsPath, 'utf-8');

// 環境変数からFirebase設定を取得
const config = {
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.FIREBASE_APP_ID || ''
};

// app.js内のfirebaseConfigブロックを環境変数の値で置き換える
const newConfig = `const firebaseConfig = {
    apiKey: "${config.apiKey}",
    authDomain: "${config.authDomain}",
    projectId: "${config.projectId}",
    storageBucket: "${config.storageBucket}",
    messagingSenderId: "${config.messagingSenderId}",
    appId: "${config.appId}"
};`;

// 既存のfirebaseConfigブロックを正規表現で置換
content = content.replace(
    /const firebaseConfig = \{[\s\S]*?\};/,
    newConfig
);

fs.writeFileSync(appJsPath, content, 'utf-8');
console.log('✅ Firebase設定の注入が完了しました。');
