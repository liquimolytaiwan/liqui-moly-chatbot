# LIQUI MOLY Taiwan AI 聊天機器人

這是 LIQUI MOLY Taiwan 的 AI 產品諮詢助理，可以協助消費者：
- 根據車型推薦適合的機油產品
- 解答產品使用方式與應用情境
- 提供購買管道資訊

## 專案架構

```
liqui-moly-chatbot/
├── index.html              # 聊天介面主頁面
├── css/
│   └── style.css           # 樣式檔案
├── js/
│   ├── config.js           # 配置檔案
│   └── chat.js             # 聊天功能
├── assets/
│   ├── liqui-moly-logo.svg # Logo
│   └── bot-avatar.svg      # 機器人頭像
├── wix-backend/            # Wix Velo 後端程式碼
│   ├── chatbot.jsw         # 聊天邏輯（複製到 Wix）
│   └── http-functions.js   # HTTP API 端點（複製到 Wix）
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
   - 將 `wix-backend/chatbot.jsw` 內容複製到 `backend/chatbot.jsw`
   - 將 `wix-backend/http-functions.js` 內容複製到 `backend/http-functions.js`

4. **確認 CMS Collection 設定**
   - 確保您有一個名為 `Products` 的 CMS Collection
   - 包含以下欄位：
     - `title` (Text) - 產品名稱
     - `sku` (Text) - 產品品號
     - `viscosity` (Text) - 黏度等級（如 5W-30）
     - `certifications` (Text) - 認證規格（如 MB 229.52）
     - `category` (Text) - 產品分類
     - `application` (Text) - 適用說明
     - `productUrl` (URL) - 產品頁面連結
     - `description` (Text) - 產品描述

5. **發布網站**
   - 發布 Wix 網站以啟用 HTTP Functions

### 步驟 2：部署 GitHub Pages 前端

1. **建立 GitHub Repository**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/liqui-moly-chatbot.git
   git push -u origin main
   ```

2. **啟用 GitHub Pages**
   - 進入 Repository 的「Settings」→「Pages」
   - Source 選擇「Deploy from a branch」
   - Branch 選擇「main」→「/ (root)」
   - 點選「Save」

3. **更新 API 端點**
   - 編輯 `js/config.js`
   - 將 `API_ENDPOINT` 更新為您的 Wix 網站 URL：
     ```javascript
     API_ENDPOINT: 'https://www.liqui-moly-tw.com/_functions',
     ```

### 步驟 3：內嵌至 Wix 網站

1. **在 Wix 建立新頁面**（或選擇現有頁面）

2. **新增 HTML iframe 元件**
   - 點選「Add」→「Embed」→「HTML iframe」

3. **設定 iframe**
   - 模式選擇「Website address」
   - 輸入 GitHub Pages URL：
     ```
     https://YOUR_USERNAME.github.io/liqui-moly-chatbot/
     ```
   - 調整元件大小（建議寬度 100%，高度 600-700px）

4. **發布網站**

## 本地測試

要在本地測試前端介面：

```bash
# 使用 Python 簡易伺服器
cd liqui-moly-chatbot
python -m http.server 8080

# 或使用 Node.js
npx serve
```

瀏覽器開啟 `http://localhost:8080`

> 注意：本地測試時，需將 `js/config.js` 中的 `DEV_MODE` 設為 `true`，才能使用模擬回應。

## 自訂說明

### 修改系統提示詞

編輯 `wix-backend/chatbot.jsw` 中的 `SYSTEM_PROMPT` 常數，可以調整 AI 的行為與回覆風格。

### 修改樣式

編輯 `css/style.css` 中的 CSS 變數來調整配色：

```css
:root {
    --primary-red: #E31E24;      /* 主色（LIQUI MOLY 紅） */
    --primary-red-dark: #B91820; /* 深色版本 */
    --dark-800: #1A1A1A;         /* 背景色 */
    /* ... */
}
```

### 新增快速操作按鈕

編輯 `index.html` 中的 `.quick-actions` 區塊：

```html
<button class="quick-action-btn" data-message="您的預設訊息">
    📝 按鈕文字
</button>
```

## API 端點說明

| 端點 | 方法 | 說明 |
|------|------|------|
| `/_functions/chat` | POST | 聊天 API |
| `/_functions/products` | GET | 取得產品列表 |
| `/_functions/searchVehicle` | POST | 根據車型搜尋產品 |
| `/_functions/health` | GET | 健康檢查 |

### 聊天 API 請求範例

```javascript
fetch('https://www.liqui-moly-tw.com/_functions/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        message: '我的車是 2023 賓士 GLC，需要用什麼機油？',
        conversationHistory: []
    })
});
```

## 技術支援

如有技術問題，請聯繫開發團隊。

---

© 2024 LIQUI MOLY Taiwan | 台灣總代理 宜福工業
