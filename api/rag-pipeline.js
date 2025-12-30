/**
 * LIQUI MOLY Chatbot - RAG 系統入口
 * 整合意圖分類、知識檢索、提示詞建構
 * 
 * 架構：AI 優先、規則備援
 * - 優先使用 Gemini AI 分析用戶意圖
 * - AI 失敗時 fallback 到規則分類
 * 
 * P0 優化：直接呼叫 search.js 函式，避免 HTTP 開銷
 */

const { classifyIntent } = require('./intent-classifier');
const { retrieveKnowledge } = require('./knowledge-retriever');
const { buildPrompt } = require('./prompt-builder');
const { convertAIResultToIntent, isValidAIResult, enhanceIntentWithRules } = require('./intent-converter');
const { loadJSON } = require('./knowledge-cache');

// 載入 search-reference.json 取得關鍵字對照表和認證兼容表（使用統一快取）
const searchRef = loadJSON('search-reference.json') || {};
const certCompatibility = searchRef.certification_compatibility || null;
console.log('[RAG] Certification compatibility table loaded:', certCompatibility ? 'YES' : 'NO');

// 動態載入 search.js（ESM 模組）
let searchModuleFn = null;



// AI 分析模組（動態載入避免循環依賴）
let analyzeUserQueryFn = null;

/**
 * 載入 AI 分析函式 (非同步載入 ESM)
 */
async function loadAnalyzeFunction() {
    if (!analyzeUserQueryFn) {
        try {
            // 動態載入 ESM 模組
            const analyzeModule = await import('./analyze.js');
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
                    // 用規則補強 AI 分析結果（識別 authentication、price_inquiry 等意圖）
                    intent = enhanceIntentWithRules(intent, message);
                    usedAI = true;
                    console.log('[RAG] ✓ Using AI analysis result (enhanced with rules)');
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

    // === Step 3.5: 產品搜尋（P0 優化：直接函式呼叫）===
    // ⚡ 優化：如果 productContext 已由呼叫端傳入（如 Wix 端），跳過重複搜尋
    console.log('[RAG] === Step 3.5: Product Search (Direct Call) ===');

    // ⚡ 優化：若意圖不需要推薦產品（如一般詢問），直接跳過搜尋
    if (!intent.needsProductRecommendation && (!intent.needsTemplates || !intent.needsTemplates.includes('product_recommendation'))) {
        console.log('[RAG] ⚡ Skipping search - needsProductRecommendation is false');
    } else if (productContext && productContext.length > 100) {
        console.log(`[RAG] ⚡ Skipping search - productContext already provided (${productContext.length} chars)`);

        // ⭐ 但如果有 recommendedSKU（品牌專用產品），仍需額外搜尋並補充
        const recommendedSKU = aiAnalysis?.matchedVehicle?.recommendedSKU;
        if (recommendedSKU && recommendedSKU.length > 0) {
            console.log(`[RAG] 🎯 Found recommendedSKU: ${JSON.stringify(recommendedSKU)}, searching for brand-specific products...`);
            try {
                if (!searchModuleFn) {
                    const searchModule = await import('./search.js');
                    searchModuleFn = searchModule;
                }
                const products = await searchModuleFn.getProducts();
                if (products && products.length > 0) {
                    // 根據 SKU 精確搜尋專用產品
                    const skuList = Array.isArray(recommendedSKU) ? recommendedSKU : [recommendedSKU];
                    const brandProducts = products.filter(p =>
                        skuList.some(sku => p.partno && p.partno.toUpperCase() === sku.toUpperCase())
                    );
                    if (brandProducts.length > 0) {
                        const PRODUCT_BASE_URL = 'https://www.liqui-moly-tw.com/products/';
                        const brandContext = brandProducts.map(p => {
                            const url = p.partno ? `${PRODUCT_BASE_URL}${p.partno.toLowerCase()}` : (p.productPageUrl || '');
                            return `🎯 品牌專用產品：${p.title} (${p.partno})\n產品連結：${url}\n${p.content || p.description || ''}`;
                        }).join('\n\n');
                        // 將專用產品放在最前面，使用更強烈的指示
                        productContext = `## ⚠️⚠️⚠️ 最重要：此品牌有專用產品！⚠️⚠️⚠️

**你必須將以下品牌專用產品放在推薦的第 1、2 位！**
**禁止將其他產品排在專用產品前面！**

${brandContext}

---
以下是其他符合規格的產品（只能作為補充選項，排在專用產品之後）：
${productContext}`;
                        console.log(`[RAG] ✓ Added ${brandProducts.length} brand-specific products to context`);
                    }
                }
            } catch (e) {
                console.error('[RAG] Brand-specific product search failed:', e.message);
            }
        }

        // ⭐ 如果有 additiveGuideMatch（症狀匹配解決方案），也額外搜尋並補充
        const additiveGuideMatch = aiAnalysis?.additiveGuideMatch;
        if (additiveGuideMatch?.matched && additiveGuideMatch?.items?.length > 0) {
            const solutionSkus = [];
            for (const item of additiveGuideMatch.items) {
                if (item.solutions && Array.isArray(item.solutions)) {
                    solutionSkus.push(...item.solutions);
                }
            }
            if (solutionSkus.length > 0) {
                console.log(`[RAG] 🎯 Found additiveGuideMatch solutions: ${JSON.stringify(solutionSkus)}, searching for additive products...`);
                try {
                    if (!searchModuleFn) {
                        const searchModule = await import('./search.js');
                        searchModuleFn = searchModule;
                    }
                    const products = await searchModuleFn.getProducts();
                    if (products && products.length > 0) {
                        const additiveProducts = products.filter(p =>
                            solutionSkus.some(sku => p.partno && p.partno.toUpperCase() === sku.toUpperCase())
                        );
                        if (additiveProducts.length > 0) {
                            const PRODUCT_BASE_URL = 'https://www.liqui-moly-tw.com/products/';
                            // 組合症狀說明和產品資訊
                            let symptomInfo = additiveGuideMatch.items.map(item =>
                                `症狀：${item.problem}\n說明：${item.explanation}\n推薦產品：${item.solutions.join(', ')}`
                            ).join('\n\n');
                            const additiveContext = additiveProducts.map(p => {
                                const url = p.partno ? `${PRODUCT_BASE_URL}${p.partno.toLowerCase()}` : (p.productPageUrl || '');
                                return `🎯 症狀解決方案：${p.title} (${p.partno})\n產品連結：${url}\n${p.content || ''}`;
                            }).join('\n\n');
                            // 將症狀解決方案放在最前面
                            productContext = `⭐ 根據用戶描述的症狀，知識庫推薦以下解決方案：\n\n${symptomInfo}\n\n---\n\n${additiveContext}\n\n---\n其他產品：\n${productContext}`;
                            console.log(`[RAG] ✓ Added ${additiveProducts.length} additive solution products to context`);
                        }
                    }
                } catch (e) {
                    console.error('[RAG] Additive solution search failed:', e.message);
                }
            }
        }
    } else {
        console.log('[RAG] Calling searchProducts directly (P0 optimized)...');
        try {
            // 動態載入 search.js ESM 模組
            if (!searchModuleFn) {
                const searchModule = await import('./search.js');
                searchModuleFn = searchModule;
                console.log('[RAG] search.js module loaded');
            }

            // 取得產品列表
            const products = await searchModuleFn.getProducts();
            if (!products || products.length === 0) {
                console.warn('[RAG] No products available');
                productContext = '⚠️ 產品資料庫暫時無法存取，請稍後再試。';
            } else {
                // 建構搜尋資訊
                const searchInfo = {
                    ...intent,
                    ...aiAnalysis,
                    vehicles: aiAnalysis?.vehicles || [],
                    wixQueries: aiAnalysis?.wixQueries || [],
                    certificationSearch: aiAnalysis?.certificationSearch || null
                };

                // 直接呼叫 searchProducts 函式
                productContext = searchModuleFn.searchProducts(products, message, searchInfo);
                console.log(`[RAG] Product search completed (direct call), context length: ${productContext.length}`);
            }
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


// ============================================
// 以下搜尋相關函式已移至 search.js 統一處理
// rag-pipeline 現在透過 /api/search 端點呼叫
// ============================================

module.exports = {
    processWithRAG,
    classifyIntent,
    retrieveKnowledge,
    buildPrompt
};
