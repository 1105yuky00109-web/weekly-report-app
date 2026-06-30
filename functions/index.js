// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const Stripe = require('stripe');
require('dotenv').config();

admin.initializeApp();
const db = admin.firestore();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ------------------------------------------------------------
// 1. createCheckoutSession
// ------------------------------------------------------------
// 重複しない会社IDを自動生成する（c_ + 8桁のランダム英数字）
async function generateUniqueCompanyId(database) {
  let isUnique = false;
  let companyId = '';
  let attempts = 0;
  while (!isUnique && attempts < 10) {
    attempts++;
    const randomStr = Math.random().toString(36).substring(2, 10);
    companyId = `c_${randomStr}`;
    const doc = await database.collection('companies').doc(companyId).get();
    if (!doc.exists) {
      isUnique = true;
    }
  }
  if (!isUnique) {
    throw new Error('会社IDの自動生成に失敗しました。時間をおいて再度お試しください。');
  }
  return companyId;
}

exports.api = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }
  const {
    companyName,
    plan, // stripe price id
    adminName,
    adminEmail,
    password,
  } = req.body;
  if (!companyName || !plan || !adminEmail || !adminName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  let companyId;
  try {
    companyId = await generateUniqueCompanyId(db);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  // Create Stripe Checkout Session
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: plan, quantity: 1 }],
      customer_email: adminEmail,
      metadata: {
        companyName,
        companyId,
        adminName,
        adminEmail,
        password,
        plan,
      },
      success_url: `${process.env.HOST_URL || 'https://weekly-report-93e5f.web.app'}/onboarding-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.HOST_URL || 'https://weekly-report-93e5f.web.app'}/onboarding.html`,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('Stripe error', e);
    res.status(500).json({ error: e.message });
  }
});

// ------------------------------------------------------------
// 2. Stripe webhook handler
// ------------------------------------------------------------
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET; // set in .env
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  // Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const {
      companyName,
      companyId,
      adminName,
      adminEmail,
      password,
    } = session.metadata;
    // Retrieve planId from display_items or line_items or fallback
    const planId = (session.line_items && session.line_items.data && session.line_items.data[0] && session.line_items.data[0].price && session.line_items.data[0].price.id) ||
                   (session.display_items && session.display_items[0] && session.display_items[0].price && session.display_items[0].price.id) ||
                   session.metadata.plan ||
                   '';
    // Create Firebase Auth user for admin
    let adminUid;
    try {
      const userRecord = await admin.auth().createUser({
        email: adminEmail,
        password: password || undefined,
        displayName: adminName,
      });
      adminUid = userRecord.uid;
    } catch (e) {
      console.error('Auth user creation failed', e);
      // If user already exists, fetch uid
      const userRecord = await admin.auth().getUserByEmail(adminEmail);
      adminUid = userRecord.uid;
    }
    // Create company document
    const companyRef = db.collection('companies').doc(companyId);
    const planMap = {
      'price_1TaP0sJdCQkwItViebEBEhJa': { name: 'スタータープラン', maxUsers: 20 },
      'price_1TaP6jJdCQkwItViM7RoBetq': { name: 'スタンダードプラン', maxUsers: 100 },
    };
    const planInfo = planMap[planId] || {};
    await companyRef.set({
      companyId,
      companyName,
      planId,
      planName: planInfo.name || 'カスタム',
      maxUsers: planInfo.maxUsers,
      ownerUid: adminUid,
      adminEmails: [adminEmail],
      stripeCustomerId: customerId,
      createdAt: FieldValue.serverTimestamp(),
      status: 'active',
    });
    // Store subscription info
    const subId = session.subscription || 'sub_default';
    await companyRef.collection('subscriptions').doc(subId).set({
      subscriptionId: session.subscription || null,
      status: session.payment_status || null,
      currentPeriodEnd: session.current_period_end || null,
    });
    console.log(`Company ${companyId} created for ${adminEmail}`);

    // Gmailによる登録完了メール送信処理
    try {
      const nodemailer = require('nodemailer');
      const smtpUser = 'areva.noreply@gmail.com';
      const smtpPass = process.env.SMTP_PASS;

      const loginUrl = `${process.env.HOST_URL || 'https://weekly-report-93e5f.web.app'}/index.html`;

      const mailOptions = {
        from: `日報アプリ管理部 <${smtpUser}>`,
        to: adminEmail,
        subject: `【重要】${companyName}様 アカウント登録完了のお知らせ`,
        text: `${adminName} 様

この度はシステムをご契約いただき、誠にありがとうございます。
管理者様のアカウントおよび会社データのセットアップが完了いたしました。

以下のログイン情報にてシステムをご利用いただけます。

----------------------------------------
■ ログインURL
${loginUrl}

■ 管理者ログイン用メールアドレス
${adminEmail}
----------------------------------------
※ パスワードは登録時にご自身で設定された任意のパスワードとなります。

ログイン後、管理者メニューよりユーザー（社員）の追加や予定表の設定を行ってください。

本メールはシステムより自動送信されています。
`,
      };

      if (smtpPass) {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
        });

        await transporter.sendMail(mailOptions);
        console.log(`[Email] 登録完了メールを ${adminEmail} 宛に送信しました。`);
      } else {
        console.log('--- [SMTP_PASSが未設定のためメール送信をシミュレートしました] ---');
        console.log('宛先:', adminEmail);
        console.log('件名:', mailOptions.subject);
        console.log('本文:\n', mailOptions.text);
        console.log('------------------------------------------------------------------');
      }
    } catch (mailErr) {
      console.error('メール送信処理中にエラーが発生しました:', mailErr);
    }
  }
  res.json({ received: true });
});

// ------------------------------------------------------------
// 3. addEmployee (管理者による社員追加API)
// ------------------------------------------------------------
exports.addEmployee = functions.https.onRequest(async (req, res) => {
  // CORSヘッダーの設定（ローカルエミュレータなどのクロスドメインからのリクエスト対応用）
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const {
    companyId,
    adminEmail,
    adminUid,
    employeeName,
    employeeEmail,
    employeeBranch,
    employeeRole // 追加
  } = req.body;

  if (!companyId || !adminEmail || !adminUid || !employeeName || !employeeEmail || !employeeBranch || !employeeRole) {
    return res.status(400).json({ error: '必須項目が不足しています。' });
  }

  try {
    // 1. 管理者の権限確認 (Firestoreから会社情報を取得し、ownerUidまたはadminEmailsが一致するか確認)
    const companyRef = db.collection('companies').doc(companyId);
    const companyDoc = await companyRef.get();
    if (!companyDoc.exists) {
      return res.status(404).json({ error: '指定された会社が見つかりません。' });
    }

    const companyData = companyDoc.data();
    const isAdmin = companyData.ownerUid === adminUid || (companyData.adminEmails && companyData.adminEmails.includes(adminEmail));
    if (!isAdmin) {
      return res.status(403).json({ error: '社員を追加する権限がありません。' });
    }

    // 1.5 プランの上限人数チェック (管理者 + 社員数)
    const maxUsers = companyData.maxUsers || 20;
    const currentEmployeesCount = (companyData.employees || []).length;
    const adminCount = (companyData.adminEmails || []).length;
    const totalUsersCount = adminCount + currentEmployeesCount;
    if (totalUsersCount >= maxUsers) {
      return res.status(400).json({ error: `契約プランの上限人数（最大${maxUsers}名）に達しているため、これ以上登録できません。` });
    }

    // 2. 仮パスワード（英数字混ざり12桁）をサーバーサイドで自動生成
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$';
    let tempPassword = '';
    for (let i = 0; i < 12; i++) {
      tempPassword += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    // 3. 社員の Firebase Auth ユーザーを作成
    let employeeUid;
    try {
      const userRecord = await admin.auth().createUser({
        email: employeeEmail,
        password: tempPassword,
        displayName: employeeName
      });
      employeeUid = userRecord.uid;
    } catch (authErr) {
      console.error('Auth user creation failed', authErr);
      if (authErr.code === 'auth/email-already-exists') {
        return res.status(400).json({ error: 'このメールアドレスはすでに他のアカウントで使用されています。' });
      }
      return res.status(500).json({ error: `Authユーザーの作成に失敗しました: ${authErr.message}` });
    }

    // 4. 会社ドキュメントの memberEmails および employees 配列に追加 (初回ログイン時にパスワード変更を求めるフラグを付与)
    await companyRef.update({
      memberEmails: FieldValue.arrayUnion(employeeEmail),
      employees: FieldValue.arrayUnion({
        uid: employeeUid,
        name: employeeName,
        email: employeeEmail,
        branch: employeeBranch,
        role: employeeRole, // 追加
        createdAt: new Date().toISOString(),
        mustChangePassword: true
      })
    });

    console.log(`Employee ${employeeEmail} successfully registered for company ${companyId}`);

    // 5. 社員宛ての登録案内メール自動送信
    try {
      const nodemailer = require('nodemailer');
      const smtpUser = 'areva.noreply@gmail.com';
      const smtpPass = process.env.SMTP_PASS;
      const loginUrl = `${process.env.HOST_URL || 'https://weekly-report-93e5f.web.app'}/index.html`;

      const mailOptions = {
        from: `週次日報アプリ管理部 <${smtpUser}>`,
        to: employeeEmail,
        subject: '【重要】週次日報＆予定管理システム アカウント登録完了のお知らせ',
        text: `${employeeName} 様

いつもシステムをご利用いただき、ありがとうございます。
管理者様により、あなたのアカウントがシステムに登録されました。

以下のログイン情報および手順に従って、システムをご利用ください。

----------------------------------------
■ ログインURL
${loginUrl}

■ ログイン用メールアドレス
${employeeEmail}

■ 初期仮パスワード
${tempPassword}
----------------------------------------

【重要】セキュリティ向上のため、初めてログインされた直後にご自身で新しいパスワードを設定する画面が表示されます。
メールに記載された上記の仮パスワードでログインし、画面の指示に従って新しいパスワードを設定してください。

本メールはシステムより自動送信されています。
`,
      };

      if (smtpPass) {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
        });
        await transporter.sendMail(mailOptions);
        console.log(`[Email] 社員宛て登録案内メールを ${employeeEmail} 宛に送信しました。`);
      } else {
        console.log('--- [SMTP_PASSが未設定のため社員宛てメール送信をシミュレートしました] ---');
        console.log('宛先:', employeeEmail);
        console.log('件名:', mailOptions.subject);
        console.log('本文:\n', mailOptions.text);
        console.log('------------------------------------------------------------------');
      }
    } catch (mailErr) {
      console.error('メール送信処理中にエラーが発生しました:', mailErr);
    }

    res.json({ success: true, uid: employeeUid, tempPassword: tempPassword });
  } catch (err) {
    console.error('addEmployee error', err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// 4. checkEmailRegistered (未ログイン状態でのメールアドレス登録確認用)
// ------------------------------------------------------------
exports.checkEmailRegistered = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'メールアドレスが指定されていません。' });
  }

  try {
    // Auth上にそのメールアドレスが存在するかチェック
    await admin.auth().getUserByEmail(email);
    res.json({ registered: true });
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      return res.json({ registered: false });
    }
    console.error('checkEmailRegistered error', error);
    res.status(500).json({ error: error.message });
  }
});

// 週表記 (例: 2026-W22) を 日付範囲 (例: 2026/05/25 〜 2026/05/31) に変換する
function formatWeekString(weekStr) {
  if (!weekStr || !weekStr.includes('-W')) return weekStr;
  try {
    const [yearStr, weekNumStr] = weekStr.split('-W');
    const year = parseInt(yearStr, 10);
    const week = parseInt(weekNumStr, 10);
    
    // その年の1月4日は必ず第1週に含まれる (ISO 8601規格)
    const jan4 = new Date(year, 0, 4);
    const dayOfJan4 = jan4.getDay();
    
    // 1月4日の属する週の月曜日を求める
    const jan4Mon = new Date(jan4);
    jan4Mon.setDate(jan4.getDate() - (dayOfJan4 === 0 ? 6 : dayOfJan4 - 1));
    
    // 対象の週の月曜日を求める
    const targetMon = new Date(jan4Mon);
    targetMon.setDate(jan4Mon.getDate() + (week - 1) * 7);
    
    // 日曜日を求める
    const targetSun = new Date(targetMon);
    targetSun.setDate(targetMon.getDate() + 6);
    
    const format = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const date = String(d.getDate()).padStart(2, '0');
      return `${y}/${m}/${date}`;
    };
    
    return `${format(targetMon)} 〜 ${format(targetSun)}`;
  } catch (e) {
    console.error('Error formatting week string:', e);
    return weekStr;
  }
}

// ------------------------------------------------------------
// 5. onReportWrite (週報の提出トリガー)
// ------------------------------------------------------------
exports.onReportWrite = functions.firestore
  .document('companies/{companyId}/reports/{reportId}')
  .onWrite(async (change, context) => {
    const { companyId, reportId } = context.params;
    const beforeData = change.before.exists ? change.before.data() : null;
    const afterData = change.after.exists ? change.after.data() : null;

    if (!afterData) return null; // 削除時は通知しない

    // 提出ステータスへの変化を確認
    const isPlanSubmitted = afterData.planStatus === 'submitted' && (!beforeData || beforeData.planStatus !== 'submitted');
    const isActualSubmitted = afterData.actualStatus === 'submitted' && (!beforeData || beforeData.actualStatus !== 'submitted');

    // 承認・差し戻しステータスへの変化を確認
    const isPlanApproved = afterData.planStatus === 'approved' && (!beforeData || beforeData.planStatus !== 'approved');
    const isPlanRejected = afterData.planStatus === 'rejected' && (!beforeData || beforeData.planStatus !== 'rejected');
    const isActualApproved = afterData.actualStatus === 'approved' && (!beforeData || beforeData.actualStatus !== 'approved');
    const isActualRejected = afterData.actualStatus === 'rejected' && (!beforeData || beforeData.actualStatus !== 'rejected');

    if (!isPlanSubmitted && !isActualSubmitted && !isPlanApproved && !isPlanRejected && !isActualApproved && !isActualRejected) {
      return null;
    }

    // 会社の管理者情報・社員情報を取得
    const companyRef = db.collection('companies').doc(companyId);
    const companyDoc = await companyRef.get();
    if (!companyDoc.exists) return null;
    const companyData = companyDoc.data();

    const authorName = afterData.author || '社員';
    const weekVal = afterData.week || '';
    const formattedWeek = formatWeekString(weekVal);

    // 1. 社員から提出があった場合、管理者に Push 通知を送る
    if (isPlanSubmitted || isActualSubmitted) {
      const adminTokens = companyData.adminFcmTokens || [];
      if (adminTokens.length > 0) {
        let title = '週報提出のお知らせ';
        let body = '';
        if (isPlanSubmitted && isActualSubmitted) {
          body = `${authorName}さんが${formattedWeek}の「予定」および「実績」を提出しました。`;
        } else if (isPlanSubmitted) {
          body = `${authorName}さんが${formattedWeek}の「予定」を提出しました。`;
        } else {
          body = `${authorName}さんが${formattedWeek}の「実績」を提出しました。`;
        }

        const adminMessages = adminTokens.map(token => ({
          token: token,
          notification: { title, body },
          data: {
            click_action: '/',
            companyId: companyId,
            reportId: reportId,
            badgeCount: '1'
          }
        }));

        try {
          const response = await admin.messaging().sendEach(adminMessages);
          console.log(`Successfully sent ${response.successCount} messages to admin.`);
          
          // 無効トークンのクリーンアップ
          const invalidTokens = [];
          response.responses.forEach((resp, idx) => {
            if (!resp.success) {
              const errCode = resp.error.code;
              if (errCode === 'messaging/invalid-registration-token' || errCode === 'messaging/registration-token-not-registered') {
                invalidTokens.push(adminTokens[idx]);
              }
            }
          });

          if (invalidTokens.length > 0) {
            const updatedTokens = adminTokens.filter(t => !invalidTokens.includes(t));
            await companyRef.update({ adminFcmTokens: updatedTokens });
          }
        } catch (err) {
          console.error('Error sending FCM to admin:', err);
        }
      }

      // 1.5. 社員から提出があった場合、管理者にメール通知を送る
      const adminEmails = companyData.adminEmails || [];
      if (adminEmails.length > 0) {
        try {
          const nodemailer = require('nodemailer');
          const smtpUser = 'areva.noreply@gmail.com';
          const smtpPass = process.env.SMTP_PASS;
          const loginUrl = `${process.env.HOST_URL || 'https://weekly-report-93e5f.web.app'}/index.html`;

          let subject = '';
          if (isPlanSubmitted && isActualSubmitted) {
            subject = `【週報提出】${authorName}さんが「予定」および「実績」を提出しました`;
          } else if (isPlanSubmitted) {
            subject = `【週報提出】${authorName}さんが「予定」を提出しました`;
          } else {
            subject = `【週報提出】${authorName}さんが「実績」を提出しました`;
          }

          const mailOptions = {
            from: `週次日報＆予定管理システム <${smtpUser}>`,
            to: adminEmails.join(','),
            subject: subject,
            text: `管理者 様
いつもお疲れ様です。社員より週報の提出がありましたのでお知らせいたします。

社員名： ${authorName}
対象週： ${formattedWeek}

以下のログインURLよりシステムにアクセスし、確認・承認を行ってください。

----------------------------------------
■ ログインURL
${loginUrl}
----------------------------------------

本メールはシステムより自動送信されています。
`
          };

          if (smtpPass) {
            const transporter = nodemailer.createTransport({
              service: 'gmail',
              auth: {
                user: smtpUser,
                pass: smtpPass
              }
            });
            await transporter.sendMail(mailOptions);
            console.log(`Sent submission notification email to admin(s): ${adminEmails.join(',')}`);
          }
        } catch (mailErr) {
          console.error('Error sending submission email to admin:', mailErr);
        }
      }
    }

    // 2. 上長が承認・差し戻しした場合、社員に Push 通知を送る
    if (isPlanApproved || isPlanRejected || isActualApproved || isActualRejected) {
      const employee = companyData.employees ? companyData.employees.find(e => e.email === afterData.email || e.uid === afterData.uid) : null;
      const empTokens = employee ? (employee.fcmTokens || []) : [];

      if (empTokens.length > 0) {
        let title = '週報ステータス更新';
        let body = '';
        if (isPlanApproved) body = `${formattedWeek}の「予定」が承認されました。`;
        else if (isPlanRejected) body = `${formattedWeek}の「予定」が差し戻されました。理由をご確認ください。`;
        else if (isActualApproved) body = `${formattedWeek}の「実績」が承認され、週報が確定しました。`;
        else if (isActualRejected) body = `${formattedWeek}の「実績」が差し戻されました。理由をご確認ください。`;

        const empMessages = empTokens.map(token => ({
          token: token,
          notification: { title, body },
          data: {
            click_action: '/',
            companyId: companyId,
            reportId: reportId,
            badgeCount: '1'
          }
        }));

        try {
          const response = await admin.messaging().sendEach(empMessages);
          console.log(`Successfully sent ${response.successCount} messages to employee.`);
          
          // 無効トークンのクリーンアップ
          const invalidEmpTokens = [];
          response.responses.forEach((resp, idx) => {
            if (!resp.success) {
              const errCode = resp.error.code;
              if (errCode === 'messaging/invalid-registration-token' || errCode === 'messaging/registration-token-not-registered') {
                invalidEmpTokens.push(empTokens[idx]);
              }
            }
          });

          if (invalidEmpTokens.length > 0) {
            const updatedEmployees = companyData.employees.map(emp => {
              if (emp.email === afterData.email || emp.uid === afterData.uid) {
                return { ...emp, fcmTokens: emp.fcmTokens.filter(t => !invalidEmpTokens.includes(t)) };
              }
              return emp;
            });
            await companyRef.update({ employees: updatedEmployees });
          }
        } catch (err) {
          console.error('Error sending FCM to employee:', err);
        }
      }
    }

    return null;
  });

// ------------------------------------------------------------
// 6. sendRemindNotification (管理者からの催促通知API)
// ------------------------------------------------------------
exports.sendRemindNotification = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const { companyId, employeeUid, week, type } = req.body;
  if (!companyId || !employeeUid || !week || !type) {
    return res.status(400).json({ error: '必須項目が不足しています。' });
  }

  try {
    const companyRef = db.collection('companies').doc(companyId);
    const companyDoc = await companyRef.get();
    if (!companyDoc.exists) {
      return res.status(404).json({ error: '会社が見つかりません。' });
    }

    const companyData = companyDoc.data();
    const employee = companyData.employees ? companyData.employees.find(e => e.uid === employeeUid) : null;
    if (!employee) {
      return res.status(404).json({ error: '社員が見つかりません。' });
    }

    const tokens = employee.fcmTokens || [];
    const targetTypeJP = type === 'plan' ? '予定' : '実績';
    const formattedWeek = formatWeekString(week);
    const title = '週報提出の催促';
    const body = `${formattedWeek}の週報の「${targetTypeJP}」の提出が未完了です。至急ご入力・ご提出をお願いします。`;

    // 1. FCMプッシュ送信
    if (tokens.length > 0) {
      const messages = tokens.map(token => ({
        token: token,
        notification: { title, body },
        data: { click_action: '/' }
      }));

      try {
        const response = await admin.messaging().sendEach(messages);
        console.log(`Sent remind messages: ${response.successCount}`);
        
        // 無効トークンのクリーンアップ
        const invalidTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const errCode = resp.error.code;
            if (errCode === 'messaging/invalid-registration-token' || errCode === 'messaging/registration-token-not-registered') {
              invalidTokens.push(tokens[idx]);
            }
          }
        });

        if (invalidTokens.length > 0) {
          const updatedEmployees = companyData.employees.map(emp => {
            if (emp.uid === employeeUid) {
              return { ...emp, fcmTokens: emp.fcmTokens.filter(t => !invalidTokens.includes(t)) };
            }
            return emp;
          });
          await companyRef.update({ employees: updatedEmployees });
        }
      } catch (fcmErr) {
        console.error('FCM remind error', fcmErr);
      }
    }

    // 2. メールでの催促送信
    try {
      const nodemailer = require('nodemailer');
      const smtpUser = 'areva.noreply@gmail.com';
      const smtpPass = process.env.SMTP_PASS;
      const loginUrl = `${process.env.HOST_URL || 'https://weekly-report-93e5f.web.app'}/index.html`;

      const mailOptions = {
        from: `工事週報管理システム <${smtpUser}>`,
        to: employee.email,
        subject: `【催促】${formattedWeek}の週報（${targetTypeJP}）提出のお願い`,
        text: `${employee.name} 様
いつもお疲れ様です。管理者より週報提出の催促通知が届いています。

対象週： ${formattedWeek}
未提出： ${targetTypeJP}

以下のログインURLよりシステムにアクセスし、至急ご提出をお願いいたします。

----------------------------------------
■ ログインURL
${loginUrl}
----------------------------------------

※すでに提出済みの場合は行き違いですのでご容赦ください。
本メールはシステムより自動送信されています。
`
      };

      if (smtpPass) {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: smtpUser,
            pass: smtpPass
          }
        });
        await transporter.sendMail(mailOptions);
        console.log(`Sent remind email to ${employee.email}`);
      }
    } catch (mailErr) {
      console.error('Email remind error', mailErr);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('sendRemindNotification error', err);
    res.status(500).json({ error: err.message });
  }
});


// 祝日データを取得するヘルパー
const https = require('https');
function fetchHolidays() {
  return new Promise((resolve, reject) => {
    https.get('https://holidays-jp.github.io/api/v1/date.json', (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// 日付からISO週番号 (例: 2026-W22) を計算する
function getISOWeek(date) {
  const tempDate = new Date(date.valueOf());
  tempDate.setDate(tempDate.getDate() + 4 - (tempDate.getDay() || 7));
  const yearStart = new Date(tempDate.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((tempDate - yearStart) / 86400000) + 1) / 7);
  const year = tempDate.getFullYear();
  return `${year}-W${String(weekNo).padStart(2, '0')}`;
}

// 前週のISO週表記を計算する
function getPrevWeekISO(weekStr) {
  const [yearStr, weekNumStr] = weekStr.split('-W');
  let year = parseInt(yearStr, 10);
  let week = parseInt(weekNumStr, 10);
  week--;
  if (week <= 0) {
    year--;
    const dec28 = new Date(year, 11, 28);
    const tempDate = new Date(dec28.valueOf());
    tempDate.setDate(tempDate.getDate() + 4 - (tempDate.getDay() || 7));
    const yearStart = new Date(tempDate.getFullYear(), 0, 1);
    week = Math.ceil((((tempDate - yearStart) / 86400000) + 1) / 7);
  }
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// 毎週月曜（祝日の場合は平日の最初の曜日）の朝9時・11時に未提出者へ自動催促メールを送信
exports.scheduledWeeklyRemind = functions.pubsub
  .schedule('0 9,11 * * 1-5') // 月曜〜金曜の9:00と11:00 (JST)
  .timeZone('Asia/Tokyo')
  .onRun(async (context) => {
    const now = new Date();
    // 日本時間 (JST) での日付をパース
    const jstDate = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Tokyo"}));
    const y = jstDate.getFullYear();
    const m = String(jstDate.getMonth() + 1).padStart(2, '0');
    const d = String(jstDate.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`;

    let holidays = {};
    try {
      holidays = await fetchHolidays();
    } catch (e) {
      console.error('祝日データの取得に失敗しました。リマインド処理は継続します:', e);
    }

    // 1. 今日が祝日の場合はスキップ
    if (holidays[todayStr]) {
      console.log(`今日は祝日 (${holidays[todayStr]}) のため、自動リマインドをスキップします。`);
      return null;
    }

    // 2. 今日が週の「最初の営業日」であるか判定
    const dayOfWeek = jstDate.getDay(); // 1:月, 2:火, 3:水, 4:木, 5:金
    let hasPrevBusinessDayInWeek = false;
    for (let i = 1; i < dayOfWeek; i++) {
      const prevDate = new Date(jstDate);
      prevDate.setDate(jstDate.getDate() - (dayOfWeek - i));
      const py = prevDate.getFullYear();
      const pm = String(prevDate.getMonth() + 1).padStart(2, '0');
      const pd = String(prevDate.getDate()).padStart(2, '0');
      const prevStr = `${py}-${pm}-${pd}`;
      if (!holidays[prevStr]) {
        hasPrevBusinessDayInWeek = true;
        break;
      }
    }

    if (hasPrevBusinessDayInWeek) {
      console.log("今週の最初の営業日ではないため、自動リマインドをスキップします。");
      return null;
    }

    console.log(`今週の最初の営業日 (${todayStr}) の自動リマインド処理を開始します。`);

    // 今週と先週の週表記を取得
    const thisWeek = getISOWeek(jstDate);
    const lastWeek = getPrevWeekISO(thisWeek);
    const thisWeekFormatted = formatWeekString(thisWeek);
    const lastWeekFormatted = formatWeekString(lastWeek);

    const nodemailer = require('nodemailer');
    const smtpUser = 'areva.noreply@gmail.com';
    const smtpPass = process.env.SMTP_PASS;
    const loginUrl = `${process.env.HOST_URL || 'https://weekly-report-93e5f.web.app'}/index.html`;

    if (!smtpPass) {
      console.log('SMTP_PASS が設定されていないため、メール送信をシミュレートします。');
    }

    // 全ての会社ドキュメントを取得
    const companiesSnapshot = await db.collection('companies').get();
    for (const companyDoc of companiesSnapshot.docs) {
      const companyId = companyDoc.id;
      const companyData = companyDoc.data();
      const employees = companyData.employees || [];

      if (employees.length === 0) continue;

      // この会社のレポートドキュメント（今週と先週分）を取得
      const reportsSnapshot = await companyDoc.ref.collection('reports')
        .where('week', 'in', [thisWeek, lastWeek])
        .get();

      const reports = reportsSnapshot.docs.map(doc => doc.data());

      for (const employee of employees) {
        // 管理者アカウントは除外（roleがadminである場合、またはadminEmailsに含まれるメールアドレスは除外）
        const isAdmin = companyData.adminEmails && companyData.adminEmails.includes(employee.email);
        if (isAdmin) continue;

        // 今週の予定レポートを取得
        const thisWeekReport = reports.find(r => r.author === employee.name && r.week === thisWeek);
        // 先週の実績レポートを取得
        const lastWeekReport = reports.find(r => r.author === employee.name && r.week === lastWeek);

        // 未提出項目の確認
        const needPlan = !thisWeekReport || (thisWeekReport.planStatus !== 'submitted' && thisWeekReport.planStatus !== 'approved');
        const needActual = !lastWeekReport || (lastWeekReport.actualStatus !== 'submitted' && lastWeekReport.actualStatus !== 'approved');

        if (needPlan || needActual) {
          // リマインドメール送信
          let unsubmittedList = [];
          if (needPlan) unsubmittedList.push(`・今週の予定 (${thisWeekFormatted})`);
          if (needActual) unsubmittedList.push(`・先週の実績 (${lastWeekFormatted})`);

          const mailOptions = {
            from: `週次日報＆予定管理システム <${smtpUser}>`,
            to: employee.email,
            subject: '【自動通知】週報（予定・実績）未提出のお知らせ',
            text: `${employee.name} 様

いつもお疲れ様です。
システムによる週報自動チェックの結果、以下の提出が確認できておりません。

【未提出の項目】
${unsubmittedList.join('\n')}

以下のログインURLよりシステムにアクセスし、至急ご提出をお願いいたします。

----------------------------------------
■ ログインURL
${loginUrl}
----------------------------------------

※すでに提出済みの場合は、行き違いですので何卒ご容赦ください。
本メールはシステムより自動送信されています。
`
          };

          if (smtpPass) {
            try {
              const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                  user: smtpUser,
                  pass: smtpPass
                }
              });
              await transporter.sendMail(mailOptions);
              console.log(`[Auto Remind] Sent remind email to ${employee.email} for company ${companyId}`);
            } catch (mailErr) {
              console.error(`[Auto Remind] Failed to send email to ${employee.email}:`, mailErr);
            }
          } else {
            console.log(`[Simulated Auto Remind] Send email to: ${employee.email}, Subject: ${mailOptions.subject}, Content:\n${mailOptions.text}`);
          }
        }
      }
    }

    return null;
  });

// ------------------------------------------------------------
// 7. deleteEmployee (管理者による社員削除API)
// ------------------------------------------------------------
exports.deleteEmployee = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const { companyId, adminEmail, adminUid, employeeUid, employeeEmail, employeeName } = req.body;

  if (!companyId || !adminEmail || !adminUid || !employeeName) {
    return res.status(400).json({ error: '必須項目が不足しています。' });
  }

  try {
    const companyRef = db.collection('companies').doc(companyId);
    const companyDoc = await companyRef.get();
    if (!companyDoc.exists) {
      return res.status(404).json({ error: '指定された会社が見つかりません。' });
    }

    const companyData = companyDoc.data();
    const isAdmin = companyData.ownerUid === adminUid || (companyData.adminEmails && companyData.adminEmails.includes(adminEmail));
    if (!isAdmin) {
      return res.status(403).json({ error: '社員を削除する権限がありません。' });
    }

    const targetEmail = (employeeEmail && employeeEmail !== 'undefined') ? employeeEmail : null;
    const targetUid = (employeeUid && employeeUid !== 'undefined') ? employeeUid : null;

    // Firebase Auth ユーザーの削除（uidが存在する場合のみ）
    if (targetUid) {
      try {
        await admin.auth().deleteUser(targetUid);
      } catch (authErr) {
        console.warn(`Auth user delete failed or user not found: ${targetUid}`, authErr);
      }
    }

    // Firestore から社員を削除
    const updatedMemberEmails = targetEmail
      ? (companyData.memberEmails || []).filter(e => e !== targetEmail)
      : (companyData.memberEmails || []);

    const updatedEmployees = (companyData.employees || []).filter(emp => {
      if (targetUid && emp.uid === targetUid) return false;
      if (targetEmail && emp.email === targetEmail) return false;
      if ((!emp.uid || emp.uid === 'undefined') && (!emp.email || emp.email === 'undefined') && emp.name === employeeName) return false;
      return true;
    });

    await companyRef.update({
      memberEmails: updatedMemberEmails,
      employees: updatedEmployees
    });

    console.log(`Employee ${employeeName} (${employeeEmail}) successfully deleted from company ${companyId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('deleteEmployee error', err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// 8. updateEmployee (管理者による社員編集API)
// ------------------------------------------------------------
exports.updateEmployee = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const {
    companyId,
    adminEmail,
    adminUid,
    employeeUid,
    oldEmail,
    oldName,
    employeeName,
    employeeEmail,
    employeeBranch,
    employeeRole // 追加
  } = req.body;

  if (!companyId || !adminEmail || !adminUid || !employeeName || !employeeEmail || !employeeBranch || !employeeRole) {
    return res.status(400).json({ error: '必須項目が不足しています。' });
  }

  try {
    const companyRef = db.collection('companies').doc(companyId);
    const companyDoc = await companyRef.get();
    if (!companyDoc.exists) {
      return res.status(404).json({ error: '指定された会社が見つかりません。' });
    }

    const companyData = companyDoc.data();
    const isAdmin = companyData.ownerUid === adminUid || (companyData.adminEmails && companyData.adminEmails.includes(adminEmail));
    if (!isAdmin) {
      return res.status(403).json({ error: '社員を編集する権限がありません。' });
    }

    const targetUid = (employeeUid && employeeUid !== 'undefined') ? employeeUid : null;
    const targetOldEmail = (oldEmail && oldEmail !== 'undefined') ? oldEmail : null;
    const targetOldName = (oldName && oldName !== 'undefined') ? oldName : null;

    let finalUid = targetUid;
    let tempPassword = '';

    if (targetUid) {
      // 1. Firebase Auth ユーザー情報の更新
      try {
        await admin.auth().updateUser(targetUid, {
          email: employeeEmail,
          displayName: employeeName
        });
      } catch (authErr) {
        console.error('Auth user update failed', authErr);
        if (authErr.code === 'auth/email-already-exists') {
          return res.status(400).json({ error: 'このメールアドレスはすでに他のアカウントで使用されています。' });
        }
        return res.status(500).json({ error: `Authユーザーの更新に失敗しました: ${authErr.message}` });
      }
    } else {
      // 2. uidが存在しない旧データに対し、新しくAuthアカウントを作成（メールアドレスが有効な場合）
      if (employeeEmail && employeeEmail !== 'undefined') {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$';
        for (let i = 0; i < 12; i++) {
          tempPassword += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        try {
          const userRecord = await admin.auth().createUser({
            email: employeeEmail,
            password: tempPassword,
            displayName: employeeName
          });
          finalUid = userRecord.uid;
        } catch (authErr) {
          console.error('Auth user creation during edit failed', authErr);
          if (authErr.code === 'auth/email-already-exists') {
            return res.status(400).json({ error: 'このメールアドレスはすでに他のアカウントで使用されています。' });
          }
          return res.status(500).json({ error: `Authユーザーの新規登録に失敗しました: ${authErr.message}` });
        }
      }
    }

    // 3. Firestore の更新
    // memberEmailsの更新 (古いメールを除去、新しいメールを追加)
    const updatedMemberEmails = (companyData.memberEmails || []).filter(e => e !== targetOldEmail);
    if (employeeEmail && !updatedMemberEmails.includes(employeeEmail)) {
      updatedMemberEmails.push(employeeEmail);
    }

    const updatedEmployees = (companyData.employees || []).map(emp => {
      let isTarget = false;
      if (targetUid && emp.uid === targetUid) isTarget = true;
      else if (targetOldEmail && emp.email === targetOldEmail) isTarget = true;
      else if ((!emp.uid || emp.uid === 'undefined') && (!emp.email || emp.email === 'undefined') && emp.name === targetOldName) isTarget = true;

      if (isTarget) {
        const updated = {
          ...emp,
          name: employeeName,
          email: employeeEmail,
          branch: employeeBranch,
          role: employeeRole // 追加
        };
        if (finalUid) updated.uid = finalUid;
        if (tempPassword) {
          updated.mustChangePassword = true;
          updated.createdAt = new Date().toISOString();
        }
        return updated;
      }
      return emp;
    });

    await companyRef.update({
      memberEmails: updatedMemberEmails,
      employees: updatedEmployees
    });

    // 4. アカウントが新規作成された場合、案内メールを送信
    if (tempPassword) {
      try {
        const nodemailer = require('nodemailer');
        const smtpUser = 'areva.noreply@gmail.com';
        const smtpPass = process.env.SMTP_PASS;
        const loginUrl = `${process.env.HOST_URL || 'https://weekly-report-93e5f.web.app'}/index.html`;

        const mailOptions = {
          from: `週次日報アプリ管理部 <${smtpUser}>`,
          to: employeeEmail,
          subject: '【重要】週次日報＆予定管理システム アカウント登録完了のお知らせ',
          text: `${employeeName} 様

いつもシステムをご利用いただき、ありがとうございます。
管理者様により、あなたのアカウントがシステムに登録されました。

以下のログイン情報および手順に従って、システムをご利用ください。

----------------------------------------
■ ログインURL
${loginUrl}

■ ログイン用メールアドレス
${employeeEmail}

■ 初期仮パスワード
${tempPassword}
----------------------------------------

【重要】セキュリティ向上のため、初めてログインされた直後にご自身で新しいパスワードを設定する画面が表示されます。
メールに記載された上記の仮パスワードでログインし、画面の指示に従って新しいパスワードを設定してください。

本メールはシステムより自動送信されています。
`,
        };

        if (smtpPass) {
          const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
              user: smtpUser,
              pass: smtpPass,
            },
          });
          await transporter.sendMail(mailOptions);
          console.log(`[Email] 新規作成された社員宛て登録案内メールを ${employeeEmail} 宛に送信しました。`);
        }
      } catch (mailErr) {
        console.error('メール送信処理中にエラーが発生しました:', mailErr);
      }
    }

    console.log(`Employee successfully updated to ${employeeEmail} / ${employeeName} / ${employeeBranch}`);
    res.json({ success: true, tempPassword: tempPassword || null });
  } catch (err) {
    console.error('updateEmployee error', err);
    res.status(500).json({ error: err.message });
  }
});


