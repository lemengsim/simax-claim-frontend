/**
 * redeploy_gas_webhook.js
 * =============================================================================
 * 透過 Google Apps Script REST API，強制建立新版部署（解決 GAS UI 破損無法重新部署）
 *
 * 執行方式：
 *   node /home/order/simax-momo-engine/redeploy_gas_webhook.js
 *
 * 說明：
 *   GAS Web App 有「版本」概念。UI 損壞時無法從介面點「管理部署作業」，
 *   但可以直接呼叫 Apps Script API 的 deployments.create 建立新部署，
 *   讓最新的已儲存程式碼生效。
 *
 * 前提：
 *   1. .env 裡有 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN
 *   2. 這個 OAuth Client 已在 GCP Console 加入 Apps Script API 授權範圍
 *      （若未加，請先至 GCP Console → API 和服務 → 已啟用的 API，確認
 *        「Apps Script API」已啟用）
 *
 * 若此腳本失敗（scope 不夠），請改用手動步驟（見腳本底部說明）。
 * =============================================================================
 */

'use strict';
require('dotenv').config();
const { google } = require('googleapis');

// ── GAS Script ID（從 Web App URL 解析）─────────────────────────────────────
// Web App URL: https://script.google.com/macros/s/<DEPLOY_ID>/exec
// Script ID 在 GAS 編輯器的 URL 裡：
//   https://script.google.com/home/projects/<SCRIPT_ID>/edit
// ⚠️  請在下方填入正確的 Script ID（從 GAS 編輯器 URL 取得）
const SCRIPT_ID = process.env.GAS_SCRIPT_ID || 'YOUR_SCRIPT_ID_HERE';

// 新版部署說明
const DEPLOY_DESC = `SheetsWebhook v16cols 強制重新部署 ${new Date().toISOString()}`;

async function main() {
  if (SCRIPT_ID === 'YOUR_SCRIPT_ID_HERE') {
    console.error('❌ 請在 .env 設定 GAS_SCRIPT_ID，或直接修改本腳本的 SCRIPT_ID 變數');
    console.error('   Script ID 在 GAS 編輯器 URL：https://script.google.com/home/projects/<SCRIPT_ID>/edit');
    process.exit(1);
  }

  // ── 建立 OAuth2 Client ────────────────────────────────────────────────────
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground'
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

  const script = google.script({ version: 'v1', auth: oauth2 });

  console.log(`[redeploy] Script ID: ${SCRIPT_ID}`);
  console.log('[redeploy] 正在查詢現有部署...');

  // ── 1. 列出現有部署，找到 Web App 的 deployment ─────────────────────────
  let existingDeploymentId = null;
  try {
    const listRes = await script.projects.deployments.list({ scriptId: SCRIPT_ID });
    const deployments = listRes.data.deployments || [];
    console.log(`[redeploy] 找到 ${deployments.length} 個現有部署`);

    // 找到 WEB_APP 類型的部署
    const webAppDeploy = deployments.find(d =>
      d.deploymentConfig?.deploymentType === 'WEB_APP' ||
      d.deploymentConfig?.description?.includes('exec')
    );
    if (webAppDeploy) {
      existingDeploymentId = webAppDeploy.deploymentId;
      console.log(`[redeploy] 找到現有 Web App 部署：${existingDeploymentId}`);
    }
  } catch (err) {
    // 可能是 scope 不足或 API 未啟用
    if (err.message.includes('insufficientPermissions') || err.message.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
      console.error('❌ OAuth token 缺少 Apps Script API 範圍');
      console.error('   請依照以下步驟取得新的 refresh token（包含 script.deployments 範圍）：');
      printManualSteps();
      process.exit(1);
    }
    console.warn(`[redeploy] 列出部署失敗（繼續嘗試建立新部署）: ${err.message}`);
  }

  // ── 2. 先建立新版本 ───────────────────────────────────────────────────────
  console.log('[redeploy] 建立新版本...');
  let versionNumber;
  try {
    const verRes = await script.projects.versions.create({
      scriptId: SCRIPT_ID,
      requestBody: { description: DEPLOY_DESC },
    });
    versionNumber = verRes.data.versionNumber;
    console.log(`[redeploy] ✅ 版本建立成功：v${versionNumber}`);
  } catch (err) {
    console.error(`❌ 建立版本失敗: ${err.message}`);
    if (err.message.includes('scope') || err.message.includes('permission')) {
      printManualSteps();
    }
    process.exit(1);
  }

  // ── 3. 更新現有部署（或建立新部署）────────────────────────────────────────
  const deployConfig = {
    versionNumber,
    manifestFileName: 'appsscript',
    description: DEPLOY_DESC,
  };

  if (existingDeploymentId) {
    // 更新現有 Web App 部署到最新版本
    console.log(`[redeploy] 更新現有部署 ${existingDeploymentId} 至 v${versionNumber}...`);
    try {
      const updateRes = await script.projects.deployments.update({
        scriptId:     SCRIPT_ID,
        deploymentId: existingDeploymentId,
        requestBody:  {
          deploymentConfig: {
            ...deployConfig,
            scriptId: SCRIPT_ID,
          },
        },
      });
      const newUrl = updateRes.data.entryPoints?.[0]?.webApp?.url || '（未知）';
      console.log(`\n✅ 部署更新成功！`);
      console.log(`   部署 ID  : ${updateRes.data.deploymentId}`);
      console.log(`   Web App URL: ${newUrl}`);
      console.log(`\n⚠️  如果 Web App URL 改變，請同時更新：`);
      console.log(`   1. VM .env 的 SHEETS_WEBHOOK_URL（若有設定）`);
      console.log(`   2. sheets-writer.js 的 fallback URL（第 47 行）`);
    } catch (err) {
      console.error(`❌ 更新部署失敗: ${err.message}`);
      process.exit(1);
    }
  } else {
    // 建立全新部署
    console.log('[redeploy] 建立全新 Web App 部署...');
    try {
      const createRes = await script.projects.deployments.create({
        scriptId: SCRIPT_ID,
        requestBody: {
          versionNumber,
          manifestFileName: 'appsscript',
          description: DEPLOY_DESC,
        },
      });
      const newUrl = createRes.data.entryPoints?.[0]?.webApp?.url || '（需到 GAS 查看）';
      console.log(`\n✅ 新部署建立成功！`);
      console.log(`   部署 ID  : ${createRes.data.deploymentId}`);
      console.log(`   Web App URL: ${newUrl}`);
      console.log(`\n⚠️  Web App URL 已更新，請同時更新：`);
      console.log(`   VM .env：SHEETS_WEBHOOK_URL=${newUrl}`);
      console.log(`   以及 sheets-writer.js fallback URL`);
    } catch (err) {
      console.error(`❌ 建立部署失敗: ${err.message}`);
      process.exit(1);
    }
  }
}

function printManualSteps() {
  console.log('\n── 手動重新部署 GAS 的替代方案 ──────────────────────────────────');
  console.log('方法一（最簡單）：使用 Google Apps Script 編輯器，換個不同帳號/瀏覽器');
  console.log('  1. 開啟 script.google.com，登入 order@simax-esim.com');
  console.log('  2. 在網址列輸入腳本專案 URL（含 Script ID）直接開啟');
  console.log('  3. 上方選單 → 部署 → 管理部署作業');
  console.log('  4. 點鉛筆圖示 → 版本選「新版本」→ 儲存');
  console.log('');
  console.log('方法二（clasp）：');
  console.log('  npm install -g @google/clasp');
  console.log('  clasp login --creds ~/.gcloud/application_default_credentials.json');
  console.log('  clasp deploy --scriptId <SCRIPT_ID>');
  console.log('───────────────────────────────────────────────────────────────────\n');
}

main().catch(err => {
  console.error(`[redeploy] 未預期錯誤: ${err.message}`);
  process.exit(1);
});
