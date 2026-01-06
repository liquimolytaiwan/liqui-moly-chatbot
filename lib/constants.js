/**
 * LIQUI MOLY Chatbot - 統一常數配置
 *
 * P2 優化：整合原本分散在多個檔案中的常數
 * - chat.js, search.js, rag-pipeline.js: PRODUCT_BASE_URL
 * - chat.js, analyze.js: GEMINI_MODEL
 * - 各處的 Token 限制
 * - 各處的快取設定
 *
 * 設計原則：
 * 1. 單一來源：所有常數集中管理
 * 2. 環境區分：支援開發/生產環境
 * 3. 易於維護：修改一處，全域生效
 */

// ============================================
// API 端點
// ============================================

/**
 * Wix API 端點
 */
const WIX_API_URL = 'https://www.liqui-moly-tw.com/_functions';

/**
 * 產品頁面基礎 URL
 */
const PRODUCT_BASE_URL = 'https://www.liqui-moly-tw.com/products/';

/**
 * Gemini API 端點
 */
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * CarMall 商城 URL
 */
const CARMALL_URL = 'https://www.carmall.com.tw/';

// ============================================
// AI 模型設定
// ============================================

/**
 * Gemini 模型 ID
 */
const GEMINI_MODEL = 'gemini-2.0-flash';

/**
 * Gemini 模型完整端點
 */
const GEMINI_ENDPOINT = `${GEMINI_API_URL}/${GEMINI_MODEL}:generateContent`;

/**
 * Token 限制設定
 */
const TOKEN_LIMITS = {
    // 分析用（較複雜的任務）
    analysis: {
        maxOutputTokens: 800,
        temperature: 0.1
    },
    // 聊天用（一般對話）
    chat: {
        maxOutputTokens: 1024,
        temperature: 0.7
    },
    // 簡單查詢（快速回應）
    simple: {
        maxOutputTokens: 300,
        temperature: 0.3
    }
};

// ============================================
// 快取設定
// ============================================

/**
 * 快取時間設定（毫秒）
 */
const CACHE_DURATION = {
    // 產品快取：30 分鐘
    products: 30 * 60 * 1000,
    // 知識庫快取：1 小時
    knowledge: 60 * 60 * 1000,
    // 會話快取：24 小時
    session: 24 * 60 * 60 * 1000
};

// ============================================
// 搜尋設定
// ============================================

/**
 * 搜尋結果限制
 */
const SEARCH_LIMITS = {
    // 預設產品數量
    default: 20,
    // 最大產品數量
    max: 30,
    // 認證搜尋數量
    certification: 30,
    // Fallback 搜尋數量
    fallback: 10
};

// 注意：CATEGORY_TO_SORT 和 OIL_ONLY_KEYWORDS 已移至知識庫
// 請使用 search-helper.js 的 getCategoryToSort() 和 getOilOnlyKeywords()

// ============================================
// AI 警語設定
// ============================================

/**
 * AI 警語（第一次回答時顯示）
 */
const AI_DISCLAIMER = {
    // 用於網頁端（支援 Markdown）
    web: '\n\n---\n💡 *AI 助理的回覆僅供參考，可能會有錯誤。如有疑問，請以車主手冊或專業技師建議為準。*',
    // 用於 META 端（純文字，FB/IG 不支援 Markdown）
    meta: '\n\n———\n💡 AI 助理的回覆僅供參考，可能會有錯誤。如有疑問，請以車主手冊或專業技師建議為準。'
};

// ============================================
// CORS 設定
// ============================================

/**
 * CORS Headers
 */
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
};

// ============================================
// 日誌標籤
// ============================================

/**
 * 日誌模組標籤
 */
const LOG_TAGS = {
    CHAT: '[Chat API]',
    RAG: '[RAG]',
    SEARCH: '[Search]',
    ANALYZE: '[Analyze]',
    INTENT: '[IntentClassifier]',
    KNOWLEDGE: '[KnowledgeRetriever]',
    CACHE: '[KnowledgeCache]',
    VEHICLE: '[VehicleMatcher]',
    CERT: '[CertMatcher]',
    MOTORCYCLE: '[MotorcycleRules]',
    VALIDATOR: '[ResponseValidator]'
};

// ============================================
// 知識庫檔案
// ============================================

/**
 * 知識庫 JSON 檔案列表
 */
const KNOWLEDGE_FILES = {
    vehicleSpecs: 'vehicle-specs.json',
    additiveGuide: 'additive-guide.json',
    searchReference: 'search-reference.json',
    aiAnalysisRules: 'ai-analysis-rules.json',
    coreIdentity: 'core-identity.json',
    responseTemplates: 'response-templates.json',
    antiHallucination: 'anti-hallucination-rules.json',
    categorySpecs: 'category-specs.json',
    intentKeywords: 'intent-keywords.json',
    urls: 'urls.json'
};

// ============================================
// 意圖類型
// ============================================

/**
 * 意圖類型常數
 */
const INTENT_TYPES = {
    PRODUCT_RECOMMENDATION: 'product_recommendation',
    PRODUCT_INQUIRY: 'product_inquiry',
    PRICE_INQUIRY: 'price_inquiry',
    PURCHASE_INQUIRY: 'purchase_inquiry',
    COOPERATION_INQUIRY: 'cooperation_inquiry',
    AUTHENTICATION: 'authentication',
    GENERAL_INQUIRY: 'general_inquiry'
};

/**
 * 產品類別常數
 */
const PRODUCT_CATEGORIES = {
    OIL: '機油',
    ADDITIVE: '添加劑',
    TRANSMISSION: '變速箱油',
    BRAKE: '煞車系統',
    COOLANT: '冷卻系統',
    AC: '空調系統',
    CHEMICAL: '化學品',
    BEAUTY: '美容',
    FRAGRANCE: '香氛',
    BICYCLE: '自行車',
    MARINE: '船舶',
    COMMERCIAL: '商用車',
    PROLINE: 'PRO-LINE'
};

/**
 * 車型類別常數
 */
const VEHICLE_TYPES = {
    CAR: '汽車',
    MOTORCYCLE: '摩托車',
    SCOOTER: '速克達',
    MARINE: '船舶',
    BICYCLE: '自行車'
};

// ============================================
// 輔助函式
// ============================================

/**
 * 取得產品連結
 * @param {string} sku - 產品 SKU (如 LM3840)
 * @returns {string} 產品頁面 URL
 */
function getProductUrl(sku) {
    if (!sku) return PRODUCT_BASE_URL;
    return `${PRODUCT_BASE_URL}${sku.toLowerCase()}`;
}

/**
 * 取得 Gemini API URL
 * @param {string} apiKey - API Key
 * @returns {string} 完整 API URL
 */
function getGeminiUrl(apiKey) {
    return `${GEMINI_ENDPOINT}?key=${apiKey}`;
}

/**
 * 應用 CORS Headers
 * @param {Object} res - Response 物件
 */
function applyCorsHeaders(res) {
    Object.keys(CORS_HEADERS).forEach(key => {
        res.setHeader(key, CORS_HEADERS[key]);
    });
}

/**
 * 建立日誌訊息
 * @param {string} tag - 模組標籤
 * @param {string} message - 訊息
 * @returns {string} 格式化的日誌訊息
 */
function log(tag, message) {
    return `${tag} ${message}`;
}

// ============================================
// 匯出
// ============================================
module.exports = {
    // API 端點
    WIX_API_URL,
    PRODUCT_BASE_URL,
    GEMINI_API_URL,
    GEMINI_ENDPOINT,
    CARMALL_URL,

    // AI 設定
    GEMINI_MODEL,
    TOKEN_LIMITS,

    // 快取設定
    CACHE_DURATION,

    // 搜尋設定
    SEARCH_LIMITS,

    // CORS
    CORS_HEADERS,

    // AI 警語
    AI_DISCLAIMER,

    // 日誌
    LOG_TAGS,

    // 知識庫
    KNOWLEDGE_FILES,

    // 常數
    INTENT_TYPES,
    PRODUCT_CATEGORIES,
    VEHICLE_TYPES,

    // 輔助函式
    getProductUrl,
    getGeminiUrl,
    applyCorsHeaders,
    log
};
