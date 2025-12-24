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
 * 載入 AI 分析函式
 */
function getAnalyzeFunction() {
    if (!analyzeUserQueryFn) {
        try {
            // 直接引入 analyze.js 內的核心分析邏輯
            const analyzePath = require('path').join(__dirname, '..', 'analyze.js');
            delete require.cache[require.resolve(analyzePath)];

            // analyze.js 預設匯出是 handler，我們需要內部的 analyzeUserQuery
            // 由於 analyze.js 沒有匯出該函式，我們需要重構或複製邏輯
            // 暫時使用 HTTP 呼叫方式（效能考量可優化）
            analyzeUserQueryFn = async (apiKey, message, conversationHistory) => {
                const fs = require('fs');
                const path = require('path');

                const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

                // 載入添加劑指南
                let additiveGuide = [];
                try {
                    const guidePath = path.join(process.cwd(), 'data', 'additive-guide.json');
                    additiveGuide = JSON.parse(fs.readFileSync(guidePath, 'utf-8'));
                } catch (e) {
                    console.warn('[RAG-AI] Failed to load additive guide');
                }

                // 準備對話上下文
                let contextSummary = '';
                if (conversationHistory && conversationHistory.length > 0) {
                    const recentHistory = conversationHistory.slice(-6);
                    contextSummary = '對話上下文：\n' + recentHistory.map(m =>
                        `${m.role === 'user' ? '用戶' : 'AI'}: ${m.content.substring(0, 200)}`
                    ).join('\n') + '\n\n';
                }

                // 動態生成症狀指南
                let symptomGuide = '';
                if (additiveGuide.length > 0) {
                    const engineProblems = additiveGuide
                        .filter(item => item.area === '汽車' && item.hasProduct && item.sort === '引擎疑難雜症')
                        .map(item => `- ${item.problem}: ${item.solutions.join(', ')}`)
                        .slice(0, 15);

                    if (engineProblems.length > 0) {
                        symptomGuide = `\n【症狀與添加劑對照】\n${engineProblems.join('\n')}\n`;
                    }
                }

                // AI 分析提示詞
                const analysisPrompt = `你是汽機車專家。分析用戶問題並返回 JSON。

${contextSummary}用戶問題：「${message}」
${symptomGuide}
返回格式：
{
    "isMultiVehicleQuery": false,
    "vehicles": [{
        "vehicleName": "完整車型名稱",
        "vehicleType": "汽車/摩托車/船舶/自行車",
        "vehicleSubType": "速克達/檔車/重機/未知",
        "isElectricVehicle": false,
        "certifications": ["認證代碼"],
        "viscosity": "建議黏度",
        "searchKeywords": ["搜尋關鍵字"]
    }],
    "productCategory": "機油/添加劑/美容/化學品/變速箱/鏈條",
    "symptomMatched": "匹配到的症狀名稱（如有）",
    "needsProductRecommendation": true
}

車型識別規則：
- 使用你的汽機車專業知識判斷車型、認證、黏度
- 摩托車品牌：Honda、Yamaha、Kawasaki、Suzuki、Ducati、Harley、KTM
- 台灣速克達：勁戰/JET/DRG/MMBCU/Force/SMAX
- 如果對話已有車型資訊，直接從上下文獲取，不要重複詢問

只返回 JSON，不要其他文字。`;

                const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: analysisPrompt }] }],
                        generationConfig: {
                            temperature: 0.1,
                            maxOutputTokens: 800
                        }
                    })
                });

                if (!response.ok) {
                    console.error('[RAG-AI] Gemini API error:', response.status);
                    return null;
                }

                const data = await response.json();
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        return JSON.parse(jsonMatch[0]);
                    } catch (e) {
                        console.error('[RAG-AI] JSON parse error');
                        return null;
                    }
                }
                return null;
            };
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
async function processWithRAG(message, conversationHistory = [], productContext = '') {
    console.log('[RAG] Starting RAG pipeline (AI-first mode)...');

    let intent = null;
    let aiAnalysis = null;
    let usedAI = false;

    // === Step 1: 嘗試 AI 意圖分析 ===
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
        try {
            const analyzeFunc = getAnalyzeFunction();
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

module.exports = {
    processWithRAG,
    classifyIntent,
    retrieveKnowledge,
    buildPrompt
};
