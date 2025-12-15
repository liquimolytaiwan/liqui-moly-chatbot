# LIQUI MOLY Taiwan AI 聊天機器人

這是 LIQUI MOLY Taiwan（力魔機油台灣總代理）的 AI 產品諮詢助理，整合 **Gemini 2.5 Flash** 提供智慧問答服務。

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
├── index.html              # 聊天介面（含用戶表單、評分 UI）
├── css/
│   └── style.css           # 樣式檔案
├── js/
│   ├── config.js           # 配置檔案
│   └── chat.js             # 聊天功能（含 Session 管理）
├── assets/
│   ├── liqui-moly-logo.jpg # Logo
│   └── bot-avatar.jpg      # 機器人頭像
├── wix-backend/            # Wix Velo 後端程式碼
│   ├── http-functions.js   # HTTP API 端點（核心邏輯）
│   ├── chatbot.jsw         # 聊天邏輯模組
│   ├── cleanupSessions.jsw # Session 清理模組
│   └── jobs.config         # 定時任務設定
└── README.md
```

---

© 2025 LIQUI MOLY Taiwan | 台灣總代理 宜福工業
