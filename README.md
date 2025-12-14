# LIQUI MOLY Taiwan AI 聊天機器人

這是 LIQUI MOLY Taiwan 的 AI 產品諮詢助理，可以協助消費者：
- 根據車型推薦適合的機油產品
- 解答產品使用方式與應用情境
- 提供購買管道資訊

## 功能特色

- 🤖 **AI 智慧問答**：整合 Gemini AI，自動推薦合適產品
- 📋 **用戶資料收集**：對話前收集姓名、Email、問題類別
- 💾 **對話紀錄儲存**：所有對話自動儲存至 Wix CMS
- ⏱️ **閒置自動結束**：10 分鐘無活動自動結束對話
- 🔍 **症狀智能推薦**：根據用戶描述的症狀推薦產品

## 專案架構

```
liqui-moly-chatbot/
├── index.html              # 聊天介面（含用戶表單）
├── css/
│   └── style.css           # 樣式檔案
├── js/
│   ├── config.js           # 配置檔案
│   └── chat.js             # 聊天功能（含 session 管理）
├── assets/
│   ├── liqui-moly-logo.jpg # Logo
│   └── bot-avatar.jpg      # 機器人頭像
├── wix-backend/            # Wix Velo 後端程式碼
│   ├── chatbot.jsw         # 聊天邏輯
│   └── http-functions.js   # HTTP API 端點
└── README.md
```

## 部署步驟

### 步驟 1：設定 Wix Velo 後端

1. **啟用 Velo 開發模式**
   - 進入 Wix Editor
   - 點選左上角「Dev Mode」→「Turn on Dev Mode」

2. **儲存 API Key 到 Secrets Manager**
   - 在 Velo 面板中，找到「Secrets Manager」
   - 點選「+ Store Secret」
   - 名稱填入：`GEMINI_API_KEY`
   - 值填入：您的 Gemini API Key

3. **建立後端檔案**
   - 在 Backend & Public 資料夾中建立檔案
   - 將 `wix-backend/http-functions.js` 內容複製到 `backend/http-functions.js`

4. **確認 CMS Collection 設定**

   #### Products Collection（產品資料庫）
   | 欄位 | 類型 | 說明 |
   |------|------|------|
   | title | Text | 產品名稱 |
   | partno | Text | 產品編號 |
   | viscosity | Text | 黏度等級 |
   | cert | Text | 認證規格 |
   | sort | Text | 產品分類 |
   | url | URL | 產品頁面連結 |

   #### chatSessions Collection（對話紀錄）
   | 欄位 | 類型 | 說明 |
   |------|------|------|
   | userName | Text | 用戶姓名 |
   | userEmail | Text | 電子郵件 |
   | userPhone | Text | 手機號碼（選填）|
   | category | Text | 問題類別 |
   | messages | Text | 對話記錄 (JSON) |
   | status | Text | active / ended |
   | startTime | DateTime | 開始時間 |
   | endTime | DateTime | 結束時間 |
   | lastActivity | DateTime | 最後活動時間 |

5. **發布網站**
   - 發布 Wix 網站以啟用 HTTP Functions

### 步驟 2：部署 GitHub Pages 前端

1. **推送到 GitHub**
   ```bash
   git add .
   git commit -m "Add user info collection and session management"
   git push
   ```

2. **啟用 GitHub Pages**
   - 進入 Repository 的「Settings」→「Pages」
   - Source 選擇「Deploy from a branch」
   - Branch 選擇「main」→「/ (root)」

3. **更新 API 端點**
   - 編輯 `js/config.js`
   - 將 `API_ENDPOINT` 更新為您的 Wix 網站 URL

### 步驟 3：內嵌至 Wix 網站

1. 在 Wix 新增 HTML iframe 元件
2. 輸入 GitHub Pages URL
3. 發布網站

## API 端點說明

| 端點 | 方法 | 說明 |
|------|------|------|
| `/_functions/startSession` | POST | 開始對話，建立用戶資料 |
| `/_functions/endSession` | POST | 結束對話 |
| `/_functions/chat` | POST | 聊天 API |
| `/_functions/products` | GET | 取得產品列表 |
| `/_functions/health` | GET | 健康檢查 |

### 開始對話 API 請求

```javascript
fetch('https://www.liqui-moly-tw.com/_functions/startSession', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        userName: '王小明',
        userEmail: 'test@example.com',
        userPhone: '0912345678',
        category: '車型機油推薦'
    })
});
```

### 聊天 API 請求

```javascript
fetch('https://www.liqui-moly-tw.com/_functions/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        message: '我的車是 2023 賓士 GLC，需要用什麼機油？',
        sessionId: 'xxx-xxx-xxx',
        conversationHistory: []
    })
});
```

## 本地測試

```bash
cd liqui-moly-chatbot
python -m http.server 8080
```

瀏覽器開啟 `http://localhost:8080`

> 注意：本地測試時，需將 `js/config.js` 中的 `DEV_MODE` 設為 `true`

---

© 2024 LIQUI MOLY Taiwan | 台灣總代理 宜福工業
