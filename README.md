# LIQUI MOLY Taiwan AI 聊天機器人

這是 LIQUI MOLY Taiwan（力魔機油台灣總代理）的 AI 產品諮詢助理，整合 **Gemini 2.0 Flash** 提供智慧問答服務。

## 功能特色

### 🤖 AI 智慧問答
- 整合 Gemini AI，根據車型推薦適合的機油產品
- 解答產品使用方式與應用情境
- 支援**多語言回覆**（繁中、簡中、英文、日文等）
- 根據車主手冊規格推薦符合認證的產品

### 📋 用戶資料收集
- 對話前收集姓名、Email、手機（選填）、問題類別
- 自動建立對話 Session

### 💾 對話紀錄管理
- 所有對話自動儲存至 Wix CMS
- 記錄用戶資訊、對話內容、開始/結束時間

### ⏱️ Session 管理
- 10 分鐘無活動自動結束對話
- 後端定時任務清理閒置 Session
- 對話結束後可進行 5 星評分

### 🔍 產品推薦引擎
- 從 Wix CMS 產品資料庫讀取真實產品資訊
- AI 分析用戶車型，判斷所需規格（黏度、認證）
- 只推薦資料庫中存在的產品並附上連結

## 專案架構

```
liqui-moly-chatbot/
├── index.html                       # 主聊天介面（含用戶表單、評分 UI）
├── vercel.json                      # Vercel 部署配置
├── css/
│   └── style.css                    # 樣式檔案
├── js/
│   ├── config.js                    # 前端配置（API 端點）
│   └── chat.js                      # 前端聊天功能（LiquiMolyChatbot 類別）
├── assets/
│   ├── liqui-moly-logo.jpg          # Logo
│   ├── liqui-moly-logo.svg
│   ├── bot-avatar.jpg               # 機器人頭像
│   └── bot-avatar.svg
├── api/                             # Vercel Serverless Functions
│   ├── chat.js                      # 主要聊天 API 入口
│   ├── analyze.js                   # AI 分析用戶問題
│   ├── search.js                    # 產品搜尋邏輯
│   ├── rag-pipeline.js              # RAG 處理管線入口
│   ├── intent-classifier.js         # 規則型意圖分類器
│   ├── intent-converter.js          # AI 結果轉換為 Intent 格式
│   ├── knowledge-retriever.js       # 知識庫檢索器
│   ├── knowledge-cache.js           # 統一知識庫快取模組
│   ├── prompt-builder.js            # 動態 System Prompt 建構器
│   ├── meta-webhook.js              # Meta（FB/IG）Webhook 處理
│   └── setup-messenger.js           # Messenger Profile 設定工具
├── data/knowledge/                  # RAG 知識庫
│   ├── core-identity.json           # 品牌身份與回覆規範
│   ├── vehicle-specs.json           # 車型規格資料庫
│   ├── additive-guide.json          # 添加劑症狀對照指南
│   ├── ai-analysis-rules.json       # AI 分析規則與繼承邏輯
│   ├── response-templates.json      # 回覆範本
│   ├── search-reference.json        # 搜尋關鍵字對照表
│   └── urls.json                    # 統一 URL 配置
└── wix-backend/                     # Wix Velo 後端程式碼（參考用）
    ├── http-functions.js            # HTTP API 端點
    └── cleanupSessions.jsw          # Session 清理定時任務
```

## 技術架構

### 前端
- 純 HTML/CSS/JS，可獨立運行或嵌入 Wix 網站
- 使用 Noto Sans TC 字體

### Vercel Serverless API
- **RAG（Retrieval-Augmented Generation）架構**
- AI 優先、規則備援的混合意圖分析
- 動態載入知識庫，減少 Token 消耗
- P0 優化：直接函式呼叫取代 HTTP 內部請求
- P1 優化：統一 Knowledge 快取模組

### Wix Velo 後端
- CMS 整合（產品資料、對話記錄）
- Session 管理（建立、更新、清理）
- API 代理層（轉發至 Vercel API）

### Meta 整合
- Facebook Messenger 和 Instagram DM 支援
- 自動切換真人客服（圖片/附件觸發）
- Persistent Menu 和 Quick Replies

## 環境變數

| 變數名稱 | 說明 |
|----------|------|
| `GEMINI_API_KEY` | Google Gemini API Key |
| `META_PAGE_ACCESS_TOKEN` | Facebook Page Access Token |
| `META_VERIFY_TOKEN` | Webhook 驗證 Token |
| `WIX_API_KEY` | Wix API Key（用於 CMS 操作）|
| `LOG_LEVEL` | 日誌等級：`debug`（預設）、`info`、`warn`、`error`、`none` |

### 日誌等級說明

在 Vercel 設定 `LOG_LEVEL` 環境變數可控制日誌輸出：

- `debug`：顯示所有日誌（開發環境預設）
- `info`：顯示 info、warn、error
- `warn`：顯示 warn、error（生產環境建議）
- `error`：只顯示 error
- `none`：關閉所有日誌

## 部署

### Vercel 部署
```bash
vercel --prod
```

### Wix 部署
1. 將 `wix-backend/http-functions.js` 複製到 Wix 後端
2. 將 `wix-backend/cleanupSessions.jsw` 複製到 Wix 後端
3. 設定 Scheduled Jobs 呼叫 `cleanupIdleSessions`

---

© 2025 LIQUI MOLY Taiwan | 台灣總代理 宜福工業
