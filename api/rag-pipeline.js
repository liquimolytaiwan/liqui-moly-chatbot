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
const { convertAIResultToIntent, isValidAIResult } = require('./intent-converter');
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

    // === Step 3.5: 產品搜尋（P0 優化：直接函式呼叫）===
    // ⚡ 優化：如果 productContext 已由呼叫端傳入（如 Wix 端），跳過重複搜尋
    console.log('[RAG] === Step 3.5: Product Search (Direct Call) ===');

    if (productContext && productContext.length > 100) {
        console.log(`[RAG] ⚡ Skipping search - productContext already provided (${productContext.length} chars)`);
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
