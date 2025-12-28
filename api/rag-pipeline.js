/**
 * LIQUI MOLY Chatbot - RAG 系統入口
 * 整合意圖分類、知識檢索、提示詞建構
 * 
 * 架構：AI 優先、規則備援
 * - 優先使用 Gemini AI 分析用戶意圖
 * - AI 失敗時 fallback 到規則分類
 */

const { classifyIntent } = require('./intent-classifier');
const { retrieveKnowledge, loadJSON } = require('./knowledge-retriever');
const { buildPrompt } = require('./prompt-builder');
const { convertAIResultToIntent, isValidAIResult } = require('./intent-converter');

// 載入 search-reference.json 取得關鍵字對照表和認證兼容表
const searchRef = loadJSON('search-reference.json') || {};
const certCompatibility = searchRef.certification_compatibility || null;
console.log('[RAG] Certification compatibility table loaded:', certCompatibility ? 'YES' : 'NO');


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

    // === Step 3.5: 產品搜尋（呼叫統一的 /api/search 端點）===
    // ⚡ 優化：如果 productContext 已由呼叫端傳入（如 Wix 端），跳過重複搜尋
    console.log('[RAG] === Step 3.5: Product Search ===');

    if (productContext && productContext.length > 100) {
        console.log(`[RAG] ⚡ Skipping search - productContext already provided (${productContext.length} chars)`);
    } else {
        console.log('[RAG] Calling unified /api/search endpoint...');
        try {
            // 判斷是在 Vercel 內部還是外部呼叫
            const searchUrl = process.env.VERCEL_URL
                ? `https://${process.env.VERCEL_URL}/api/search`
                : 'https://liqui-moly-chatbot.vercel.app/api/search';

            const searchResponse = await fetch(searchUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message,
                    searchInfo: {
                        ...intent,
                        ...aiAnalysis,
                        vehicles: aiAnalysis?.vehicles || [],
                        wixQueries: aiAnalysis?.wixQueries || [],
                        certificationSearch: aiAnalysis?.certificationSearch || null
                    }
                })
            });

            const searchData = await searchResponse.json();
            if (searchData.success && searchData.productContext) {
                productContext = searchData.productContext;
                console.log(`[RAG] Product search completed via API, context length: ${productContext.length}`);
            } else {
                console.warn('[RAG] Search API returned no context, using fallback');
                productContext = '⚠️ 產品搜尋無結果，請告訴用戶目前無符合條件的產品。';
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
