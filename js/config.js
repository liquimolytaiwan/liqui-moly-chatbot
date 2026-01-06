/**
 * LIQUI MOLY Chatbot Configuration
 * 聊天機器人配置檔案
 */

const CONFIG = {
    // Wix Backend API Endpoint
    // 在 Wix Velo 部署後，替換為您的實際網站 URL
    API_ENDPOINT: 'https://www.liqui-moly-tw.com/_functions',

    // API Endpoints
    ENDPOINTS: {
        CHAT: '/chat',
        PRODUCTS: '/products',
        SEARCH_VEHICLE: '/searchVehicle'
    },

    // 產品頁面基礎 URL
    PRODUCT_BASE_URL: 'https://www.liqui-moly-tw.com/catalogue/',

    // 聯絡頁面 URL
    CONTACT_URL: 'https://www.liqui-moly-tw.com/contact',

    // 店家查詢 URL
    STORE_FINDER_URL: 'https://www.liqui-moly-tw.com/storefinder',

    // 對話設定
    CONVERSATION: {
        // 最大對話歷史長度
        MAX_HISTORY: 20,
        // 最大輸入字數
        MAX_INPUT_LENGTH: 1000
    },

    // UI 設定
    UI: {
        // 打字動畫延遲 (ms)
        TYPING_DELAY: 500,
        // 自動捲動延遲 (ms)
        SCROLL_DELAY: 100
    },

    // 開發模式 (設為 true 時使用 mock 回應)
    DEV_MODE: false,

    // Mock API for development
    MOCK_RESPONSES: {
        default: '感謝您的詢問！我是 LIQUI MOLY Taiwan 的 AI產品諮詢助理。請問有什麼可以為您服務的嗎？'
    },

    // AI 警語（第一次回答時顯示）
    AI_DISCLAIMER: '\n\n---\n💡 *AI 助理的回覆僅供參考，可能會有錯誤。如有疑問，請以車主手冊或專業技師建議為準。*'
};

// 凍結配置避免意外修改
Object.freeze(CONFIG);
Object.freeze(CONFIG.ENDPOINTS);
Object.freeze(CONFIG.CONVERSATION);
Object.freeze(CONFIG.UI);
Object.freeze(CONFIG.MOCK_RESPONSES);
