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
    // === 版本確認 log ===
    console.log('[RAG] === v2.1 RAG Pipeline with Product Search ===');
    console.log('[RAG] productContext received:', productContext ? `${productContext.length} chars` : 'EMPTY');
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

    // === Step 3.5: 產品搜尋（強制執行，忽略傳入的 productContext）===
    // 始終從 Wix API 取得最新產品資料，確保 AI 有正確的產品清單
    console.log('[RAG] === Step 3.5: Product Search ===');
    console.log('[RAG] Always fetching products from Wix API...');
    try {
        productContext = await searchProductsInternal(message, intent, aiAnalysis);
        console.log(`[RAG] Product search completed, context length: ${productContext.length}`);
    } catch (e) {
        console.error('[RAG] Product search failed:', e.message);
        productContext = '⚠️ 產品搜尋失敗，請只回覆「很抱歉，目前無法搜尋產品資料庫，請稍後再試。」';
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
 * v2.1: 增加多欄位搜尋、智能關鍵字擴展
 */
async function searchProductsInternal(message, intent, aiAnalysis) {
    const WIX_API_URL = 'https://www.liqui-moly-tw.com/_functions';
    const PRODUCT_BASE_URL = 'https://www.liqui-moly-tw.com/products/';

    try {
        // 從 Wix 取得產品列表
        console.log('[RAG] Fetching products from Wix API...');
        const response = await fetch(`${WIX_API_URL}/products`);
        const data = await response.json();

        if (!data.success || !data.products || data.products.length === 0) {
            console.warn('[RAG] No products from Wix API');
            return '⚠️ 目前沒有產品資料，請只回覆「很抱歉，產品資料庫暫時無法存取。」';
        }

        const products = data.products;
        console.log(`[RAG] Fetched ${products.length} products from Wix`);

        const productCategory = intent?.productCategory || '機油';
        const vehicleType = intent?.vehicleType;
        const wixQueries = aiAnalysis?.wixQueries || [];
        const searchKeywords = aiAnalysis?.searchKeywords || [];

        let allResults = [];
        const seenIds = new Set();

        // === 智能關鍵字擴展 ===
        // 從用戶訊息和 AI 分析中提取關鍵字
        const userKeywords = extractKeywordsFromMessage(message);
        console.log('[RAG] User keywords:', userKeywords);
        console.log('[RAG] AI searchKeywords:', searchKeywords);

        // === 階段 1: 執行 AI 生成的 wixQueries ===
        if (wixQueries.length > 0) {
            console.log('[RAG] Phase 1: Executing wixQueries...');
            for (const task of wixQueries) {
                const matched = searchInField(products, task.field, task.value, task.method);
                addToResults(matched, allResults, seenIds, task.limit || 20);
            }
            console.log(`[RAG] Phase 1 results: ${allResults.length} products`);
        }

        // === 階段 2: 多欄位關鍵字搜尋 ===
        if (allResults.length < 5) {
            console.log('[RAG] Phase 2: Multi-field keyword search...');
            const allKeywords = [...new Set([...userKeywords, ...searchKeywords])];

            for (const keyword of allKeywords) {
                // 搜尋多個欄位
                const fields = ['title', 'content', 'word1', 'word2', 'sort'];
                for (const field of fields) {
                    const matched = searchInField(products, field, keyword, 'contains');
                    addToResults(matched, allResults, seenIds, 10);
                }
            }
            console.log(`[RAG] Phase 2 results: ${allResults.length} products`);
        }

        // === 階段 3: 產品類別 + 車型 Fallback ===
        if (allResults.length === 0) {
            console.log('[RAG] Phase 3: Category fallback search...');

            // 根據類別搜尋 sort 欄位
            const categoryMapping = {
                '機油': vehicleType === '摩托車' ? '【摩托車】機油' : '【汽車】機油',
                '添加劑': vehicleType === '摩托車' ? '【摩托車】添加劑' : '【汽車】添加劑',
                '變速箱油': '變速箱',
                '煞車油': '煞車系統',
                '冷卻系統': '冷卻系統',
                '美容': '車輛美容',
                '自行車': '自行車系列',
                '船舶': '船舶系列'
            };

            const sortKeyword = categoryMapping[productCategory] || productCategory;
            const matched = products.filter(p =>
                (p.sort || '').toLowerCase().includes(sortKeyword.toLowerCase())
            );
            addToResults(matched, allResults, seenIds, 20);
            console.log(`[RAG] Phase 3 results: ${allResults.length} products`);
        }

        // === 產品排序：車型專用產品優先 + 認證 + 合成度 ===
        if (vehicleType && allResults.length > 0) {
            console.log(`[RAG] Sorting products for vehicle type: ${vehicleType}`);
            allResults = sortProductsByVehicleType(allResults, vehicleType, aiAnalysis);
        }


        // 格式化產品為 prompt context
        if (allResults.length === 0) {
            return `⚠️ 沒有找到符合「${productCategory}」的產品。請告訴用戶「目前資料庫未顯示符合條件的產品」，不要編造任何產品！`;
        }

        // 格式化結果（傳入車型資訊以增加優先級提示）
        return formatProductContext(allResults, productCategory, PRODUCT_BASE_URL, vehicleType, aiAnalysis?.additiveSubtype);

    } catch (e) {

        console.error('[RAG] searchProductsInternal error:', e);
        throw e;
    }
}

/**
 * 從用戶訊息提取關鍵字
 */
function extractKeywordsFromMessage(message) {
    const keywords = [];
    const lowerMsg = message.toLowerCase();

    // 產品關鍵字對照表
    const keywordMap = {
        'mos2': ['MoS2', 'Shooter'],
        'oil additiv': ['Oil Additive', 'Shooter', '添加劑'],
        'shooter': ['Shooter'],
        'cera tec': ['Cera Tec'],
        '機油精': ['Oil Additive', '機油添加劑'],
        '添加劑': ['添加劑', 'Additive'],
        '汽油精': ['Super Diesel', 'Speed', 'Shooter'],
        '引擎': ['Engine', 'Motor'],
        '變速箱': ['Gear', 'ATF', 'Transmission'],
        '煞車': ['Brake'],
        '冷卻': ['Coolant', 'Radiator']
    };

    for (const [key, values] of Object.entries(keywordMap)) {
        if (lowerMsg.includes(key)) {
            keywords.push(...values);
        }
    }

    return [...new Set(keywords)];
}

/**
 * 在指定欄位搜尋
 */
function searchInField(products, field, searchValue, method) {
    return products.filter(p => {
        const fieldValue = p[field];
        if (!fieldValue) return false;

        const value = String(fieldValue).toLowerCase();
        const search = String(searchValue).toLowerCase();

        if (method === 'contains') {
            return value.includes(search);
        } else if (method === 'eq') {
            return value === search;
        }
        return false;
    });
}

/**
 * 加入搜尋結果（去重）
 */
function addToResults(matched, allResults, seenIds, limit) {
    for (const p of matched.slice(0, limit)) {
        if (p.id && !seenIds.has(p.id)) {
            seenIds.add(p.id);
            allResults.push(p);
        }
    }
}

/**
 * 按照車型、認證、合成度排序產品
 * 權重優先級：
 * 1. 用戶指定的產品編號（最高）
 * 2. 車型匹配 + 認證匹配
 * 3. 合成度匹配（recommendSynthetic: full）
 */
function sortProductsByVehicleType(products, vehicleType, aiAnalysis = null) {
    const vehicleKeywords = {
        '摩托車': ['motorbike', 'motorcycle', '摩托車', '機車', '4t', '2t', 'scooter'],
        '汽車': ['car', 'auto', '汽車']
    };

    const keywords = vehicleKeywords[vehicleType] || [];

    // 從 AI 分析結果中提取認證和合成度資訊
    const certifications = aiAnalysis?.certifications || aiAnalysis?.matchedVehicle?.certification || [];
    const recommendSynthetic = aiAnalysis?.recommendSynthetic || 'any';
    const matchedVehicleSKU = aiAnalysis?.matchedVehicle?.recommendedSKU;

    console.log(`[RAG] Sorting with certifications: ${certifications}, synthetic: ${recommendSynthetic}`);

    return products.sort((a, b) => {
        const titleA = (a.title || '').toLowerCase();
        const titleB = (b.title || '').toLowerCase();
        const sortA = (a.sort || '').toLowerCase();
        const sortB = (b.sort || '').toLowerCase();
        const certA = (a.cert || '').toLowerCase();
        const certB = (b.cert || '').toLowerCase();
        const word1A = (a.word1 || '').toLowerCase();
        const word1B = (b.word1 || '').toLowerCase();
        const partnoA = (a.partno || a.partNo || '').toUpperCase();
        const partnoB = (b.partno || b.partNo || '').toUpperCase();

        let scoreA = 0;
        let scoreB = 0;

        // === 權重 1：車型推薦 SKU（最高優先級 +100）===
        if (matchedVehicleSKU) {
            if (partnoA === matchedVehicleSKU.toUpperCase()) scoreA += 100;
            if (partnoB === matchedVehicleSKU.toUpperCase()) scoreB += 100;
        }

        // === 權重 2：認證匹配（+50）===
        for (const cert of certifications) {
            const certLower = cert.toLowerCase().replace(/\s+/g, '');
            if (certA.includes(certLower) || titleA.includes(certLower)) scoreA += 50;
            if (certB.includes(certLower) || titleB.includes(certLower)) scoreB += 50;
            // JASO MB 認證特別處理
            if (cert.toUpperCase() === 'JASO MB') {
                if (certA.includes('mb') || titleA.includes('mb')) scoreA += 30;
                if (certB.includes('mb') || titleB.includes('mb')) scoreB += 30;
            }
        }

        // === 權重 3：合成度匹配（+40）===
        if (recommendSynthetic === 'full') {
            // 優先推薦全合成
            if (titleA.includes('synth') || word1A.includes('全合成')) scoreA += 40;
            if (titleB.includes('synth') || word1B.includes('全合成')) scoreB += 40;
        }

        // === 權重 4：車型關鍵字匹配（+20）===
        for (const kw of keywords) {
            if (titleA.includes(kw) || sortA.includes(kw)) scoreA += 20;
            if (titleB.includes(kw) || sortB.includes(kw)) scoreB += 20;
        }

        // === 權重 5：sort 欄位包含對應車型分類（+10）===
        if (sortA.includes(vehicleType.toLowerCase())) scoreA += 10;
        if (sortB.includes(vehicleType.toLowerCase())) scoreB += 10;

        return scoreB - scoreA; // 分數高的在前
    });
}


/**
 * 格式化產品資料為 prompt context
 * @param {Array} products - 產品清單
 * @param {string} category - 產品類別
 * @param {string} baseUrl - 產品連結基礎 URL
 * @param {string} vehicleType - 車型（可選）
 * @param {string} additiveSubtype - 添加劑子類型（可選）
 */
function formatProductContext(products, category, baseUrl, vehicleType = null, additiveSubtype = null) {
    // 車型專用提示
    let vehicleHint = '';
    if (vehicleType === '摩托車') {
        vehicleHint = `
## 🏍️ 重要：摩托車產品優先規則

**用戶的車型是摩托車，請優先推薦以下標記的摩托車專用產品！**

- 產品名稱包含 "Motorbike" 或 "摩托車" 的是**摩托車專用**產品
- **禁止推薦汽車專用產品給摩托車用戶**
- 如果用戶問的是機油添加劑，優先推薦 "Motorbike MoS2 Shooter (LM3444)"
- 如果用戶問的是燃油添加劑，優先推薦 "Motorbike 4T Shooter (LM7822)" 或 "Motorbike Speed Shooter (LM7820)"

`;
    } else if (vehicleType === '汽車') {
        vehicleHint = `
## 🚗 重要：汽車產品優先規則

**用戶的車型是汽車，請優先推薦通用或汽車專用產品。**

- 避免推薦 "Motorbike" 開頭的摩托車專用產品

`;
    }

    // 添加劑子類型提示
    let subtypeHint = '';
    if (additiveSubtype === '機油添加劑') {
        subtypeHint = `
## 📍 用戶詢問的是：機油添加劑

請**只推薦機油添加劑**，不要推薦燃油添加劑（如 Shooter、Speed 等燃油系統清潔劑）。
摩托車專用機油添加劑：Motorbike MoS2 Shooter (LM3444)
汽車專用機油添加劑：Oil Additive (LM2500)、Cera Tec (LM3721)

`;
    } else if (additiveSubtype === '汽油添加劑' || additiveSubtype === '燃油添加劑') {
        subtypeHint = `
## 📍 用戶詢問的是：燃油添加劑/汽油精

請**只推薦燃油添加劑**，不要推薦機油添加劑。

`;
    }

    let context = `## ⚠️⚠️⚠️ 重要警告 ⚠️⚠️⚠️

**以下是唯一可以推薦的產品。禁止使用任何不在此列表中的產品編號！**

${vehicleHint}${subtypeHint}---

## 可用${category}產品清單（共 ${products.length} 項）

`;

    // 標記車型專用產品
    products.slice(0, 30).forEach((p, i) => {
        const pid = p.partno || p.partNo || p.sku;
        const url = pid ? `${baseUrl}${pid.toLowerCase()}` : baseUrl;
        const title = p.title || '未命名產品';

        // 標記是否為摩托車專用
        const isMotorbike = title.toLowerCase().includes('motorbike') || (p.sort || '').includes('摩托車');
        const marker = isMotorbike ? '🏍️ [摩托車專用]' : '';

        context += `### ${i + 1}. ${title} ${marker}
- 產品編號: ${pid || 'N/A'}
- 容量: ${p.size || 'N/A'}
- 系列: ${p.word1 || 'N/A'}
- 分類: ${p.sort || 'N/A'}
- 產品連結: ${url}

`;
    });

    context += `---

## ⛔ 禁止編造產品！
只能從上方列表中推薦產品。優先推薦帶有 🏍️ 標記的產品給摩托車用戶。
`;

    return context;
}


module.exports = {
    processWithRAG,
    classifyIntent,
    retrieveKnowledge,
    buildPrompt
};
