/**
 * LIQUI MOLY Chatbot - RAG 系統入口
 * 整合意圖分類、知識檢索、提示詞建構
 * 
 * 架構：AI 優先、規則備援
 * - 優先使用 Gemini AI 分析用戶意圖
 * - AI 失敗時 fallback 到規則分類
 */

const { classifyIntent } = require('./intent-classifier');
const { retrieveKnowledge } = require('./knowledge-retriever');
const { buildPrompt } = require('./prompt-builder');
const { convertAIResultToIntent, isValidAIResult } = require('./intent-converter');

// AI 分析模組（動態載入避免循環依賴）
let analyzeUserQueryFn = null;

/**
 * 載入 AI 分析函式 (非同步載入 ESM)
 */
async function loadAnalyzeFunction() {
    if (!analyzeUserQueryFn) {
        try {
            // 動態載入 ESM 模組
            const analyzeModule = await import('../analyze.js');
            if (analyzeModule && analyzeModule.analyzeUserQuery) {
                analyzeUserQueryFn = analyzeModule.analyzeUserQuery;
                console.log('[RAG] Successfully loaded analyze.js module');
            } else {
                console.warn('[RAG] analyze.js loaded but analyzeUserQuery not found');
            }
        } catch (e) {
            console.error('[RAG] Failed to load analyze module:', e.message);
        }
    }
    return analyzeUserQueryFn;
}

/**
 * RAG 處理管線 - AI 優先、規則備援
 * @param {string} message - 用戶訊息
 * @param {Array} conversationHistory - 對話歷史
 * @param {string} productContext - 產品資料庫內容
 * @returns {Object} - RAG 處理結果
 */
/**
 * RAG 處理管線 - AI 優先、規則備援
 * @param {string} message - 用戶訊息
 * @param {Array} conversationHistory - 對話歷史
 * @param {string} productContext - 產品資料庫內容 (可選，如果沒有會自動搜尋)
 * @returns {Object} - RAG 處理結果
 */
async function processWithRAG(message, conversationHistory = [], productContext = '') {
    console.log('[RAG] Starting RAG pipeline (AI-first mode)...');

    let intent = null;
    let aiAnalysis = null;
    let usedAI = false;

    // === Step 1: 嘗試 AI 意圖分析 ===
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
        try {
            const analyzeFunc = await loadAnalyzeFunction();
            if (analyzeFunc) {
                console.log('[RAG] Attempting AI intent analysis...');
                aiAnalysis = await analyzeFunc(apiKey, message, conversationHistory);

                if (isValidAIResult(aiAnalysis)) {
                    intent = convertAIResultToIntent(aiAnalysis);
                    usedAI = true;
                    console.log('[RAG] ✓ Using AI analysis result');
                } else {
                    console.log('[RAG] AI result invalid, falling back to rules');
                }
            }
        } catch (e) {
            console.warn('[RAG] AI analysis failed:', e.message);
        }
    } else {
        console.log('[RAG] No API key, using rule-based classification');
    }

    // === Step 2: Fallback 到規則分類 ===
    if (!intent) {
        console.log('[RAG] → Fallback to rule-based classification');
        intent = classifyIntent(message, conversationHistory);
        usedAI = false;
    }

    console.log(`[RAG] Intent classified (${usedAI ? 'AI' : 'Rules'}):`, intent.type, intent.vehicleType);

    // === Step 3: 知識檢索 ===
    const knowledge = await retrieveKnowledge(intent);
    console.log('[RAG] Knowledge retrieved');

    // === Step 3.5: 產品搜尋（如果沒有傳入 productContext）===
    if (!productContext || productContext.trim() === '') {
        console.log('[RAG] No productContext provided, searching products...');
        try {
            productContext = await searchProductsInternal(message, intent, aiAnalysis);
            console.log(`[RAG] Product search completed, context length: ${productContext.length}`);
        } catch (e) {
            console.error('[RAG] Product search failed:', e.message);
            productContext = '⚠️ 產品搜尋失敗，請只回覆「很抱歉，目前無法搜尋產品資料庫，請稍後再試。」';
        }
    }

    // === Step 4: 動態建構 Prompt ===
    const systemPrompt = buildPrompt(knowledge, intent, productContext);
    console.log('[RAG] Prompt built, length:', systemPrompt.length);

    return {
        intent,
        knowledge,
        systemPrompt,
        aiAnalysis,
        usedAI
    };
}

/**
 * 內部產品搜尋（從 Wix 取得產品並格式化）
 */
async function searchProductsInternal(message, intent, aiAnalysis) {
    const WIX_API_URL = 'https://www.liqui-moly-tw.com/_functions';
    const PRODUCT_BASE_URL = 'https://www.liqui-moly-tw.com/products/';

    try {
        // 從 Wix 取得產品列表
        const response = await fetch(`${WIX_API_URL}/products`);
        const data = await response.json();

        if (!data.success || !data.products || data.products.length === 0) {
            console.warn('[RAG] No products from Wix API');
            return '⚠️ 目前沒有產品資料，請只回覆「很抱歉，產品資料庫暫時無法存取。」';
        }

        const products = data.products;
        console.log(`[RAG] Fetched ${products.length} products from Wix`);

        // 使用 AI 分析結果的 wixQueries 進行搜尋
        const wixQueries = aiAnalysis?.wixQueries || [];
        const productCategory = intent?.productCategory || '機油';
        const vehicleType = intent?.vehicleType;

        let allResults = [];
        const seenIds = new Set();

        // 執行搜尋查詢
        if (wixQueries.length > 0) {
            for (const task of wixQueries) {
                try {
                    let matchedProducts = products.filter(p => {
                        const fieldValue = p[task.field];
                        if (!fieldValue) return false;

                        const value = String(fieldValue).toLowerCase();
                        const searchValue = String(task.value).toLowerCase();

                        if (task.method === 'contains') {
                            return value.includes(searchValue);
                        } else if (task.method === 'eq') {
                            return value === searchValue;
                        }
                        return false;
                    });

                    // 加入結果
                    for (const p of matchedProducts.slice(0, task.limit || 20)) {
                        if (p.id && !seenIds.has(p.id)) {
                            seenIds.add(p.id);
                            allResults.push(p);
                        }
                    }
                } catch (e) {
                    console.warn(`[RAG] Query error:`, e.message);
                }
            }
        }

        // Fallback: 如果沒有結果，根據產品類別搜尋
        if (allResults.length === 0) {
            console.log('[RAG] No results from wixQueries, using fallback search');

            const categoryToSort = {
                '機油': vehicleType === '摩托車' ? '摩托車' : '汽車',
                '添加劑': vehicleType === '摩托車' ? '摩托車' : '汽車'
            };

            const sortKeyword = categoryToSort[productCategory] || '';

            allResults = products.filter(p => {
                const sort = (p.sort || '').toLowerCase();
                if (productCategory === '機油' || productCategory === '添加劑') {
                    return sort.includes(productCategory) && (sortKeyword ? sort.includes(sortKeyword.toLowerCase()) : true);
                }
                return sort.includes(productCategory.toLowerCase());
            }).slice(0, 20);
        }

        // 格式化產品為 prompt context
        if (allResults.length === 0) {
            return `⚠️ 沒有找到符合的 ${productCategory} 產品。請告訴用戶「目前資料庫未顯示符合條件的產品」，不要編造任何產品！`;
        }

        let context = `## ⚠️⚠️⚠️ 重要警告 ⚠️⚠️⚠️

**以下是唯一可以推薦的產品。禁止使用任何不在此列表中的產品編號！**

---

## 可用${productCategory}資料庫

`;

        allResults.slice(0, 30).forEach((p, i) => {
            const pid = p.partno || p.partNo || p.sku;
            const url = pid ? `${PRODUCT_BASE_URL}${pid.toLowerCase()}` : 'https://www.liqui-moly-tw.com/products/';

            context += `### ${i + 1}. ${p.title || '未命名產品'}
- 產品編號: ${pid || 'N/A'}
- 容量/尺寸: ${p.size || 'N/A'}
- 系列/次分類: ${p.word1 || 'N/A'}
- 黏度: ${p.word2 || 'N/A'}
- 認證/規格: ${p.cert || 'N/A'}
- 分類: ${p.sort || 'N/A'}
- 產品連結: ${url}

`;
        });

        context += `---

## ⛔ 禁止編造產品！
只能從上方列表中推薦產品。如果列表中沒有合適的產品，請說「目前資料庫未顯示符合條件的產品」。
`;

        return context;

    } catch (e) {
        console.error('[RAG] searchProductsInternal error:', e);
        throw e;
    }
}

module.exports = {
    processWithRAG,
    classifyIntent,
    retrieveKnowledge,
    buildPrompt
};
