/**
 * LIQUI MOLY Chatbot - Vercel Serverless Function
 * 主要聊天 API - 使用 RAG 架構處理用戶訊息
 *
 * RAG 重構版本 - 動態載入知識，大幅減少 Token 消耗
 * v1.1: 新增產品驗證層（Anti-Hallucination）
 * P0 優化：使用統一常數
 */

// 導入統一服務模組（CommonJS）- 從 lib 資料夾載入
const { processWithRAG } = require('../lib/rag-pipeline');
const { validateAIResponse } = require('../lib/response-validator');
const { GEMINI_ENDPOINT, PRODUCT_BASE_URL, CORS_HEADERS, LOG_TAGS, AI_DISCLAIMER } = require('../lib/constants');

module.exports = async function handler(req, res) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { message, conversationHistory = [], productContext = '' } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Missing message parameter' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'API key not configured' });
        }

        // === RAG 處理管線 ===
        console.log(`${LOG_TAGS.CHAT} Starting RAG pipeline...`);
        const ragResult = await processWithRAG(message, conversationHistory, productContext);
        const { intent, systemPrompt } = ragResult;
        console.log(`${LOG_TAGS.CHAT} Intent: ${intent.type}, Vehicle: ${intent.vehicleType}`);

        // 建構對話內容
        const contents = buildContents(message, conversationHistory, systemPrompt);

        // 呼叫 Gemini API
        let aiResponse = await callGemini(apiKey, contents);

        // === 產品驗證層 (Anti-Hallucination) ===
        // ⚡ 優化：只有在需要產品推薦時才執行驗證
        const needsValidation = intent.needsProductRecommendation !== false ||
            (intent.needsTemplates && intent.needsTemplates.includes('product_recommendation'));

        if (needsValidation) {
            // 從 RAG 結果取得產品列表（如果有的話）
            let productList = null;
            try {
                // 動態載入 search.js 取得產品列表
                const searchModule = require('./search.js');
                productList = await searchModule.getProducts();
            } catch (e) {
                console.warn(`${LOG_TAGS.CHAT} Failed to get product list for validation:`, e.message);
            }

            if (productList && productList.length > 0) {
                console.log(`${LOG_TAGS.CHAT} Running product validation...`);
                const validationResult = validateAIResponse(aiResponse, productList);

                if (validationResult.hasInvalidSKUs) {
                    console.warn(`${LOG_TAGS.CHAT} Invalid SKUs detected:`, validationResult.invalidSKUs);
                    aiResponse = validationResult.validatedResponse;
                }
            }
        } else {
            console.log(`${LOG_TAGS.CHAT} ⚡ Skipping validation - no product recommendation intent`);
        }

        // === 判斷是否為第一次回答 ===
        // 檢查對話歷史中是否有任何 AI 回覆（assistant 訊息）
        // 如果沒有 assistant 回覆，表示這是第一次 AI 回答
        const hasAssistantMessage = conversationHistory &&
            conversationHistory.some(msg => msg.role === 'assistant' || msg.role === 'model');
        const isFirstResponse = !hasAssistantMessage;
        if (isFirstResponse) {
            console.log(`${LOG_TAGS.CHAT} First response detected (no previous assistant messages)`);
        }

        Object.keys(CORS_HEADERS).forEach(key => res.setHeader(key, CORS_HEADERS[key]));
        return res.status(200).json({
            success: true,
            response: aiResponse,
            isFirstResponse, // 讓各端口自行加上適合的警語格式
            // 開發模式：返回 RAG 詳情（可選）
            _debug: process.env.NODE_ENV === 'development' ? {
                intentType: intent.type,
                vehicleType: intent.vehicleType,
                promptLength: systemPrompt.length
            } : undefined
        });

    } catch (error) {
        console.error('Chat API error:', error);
        Object.keys(CORS_HEADERS).forEach(key => res.setHeader(key, CORS_HEADERS[key]));
        return res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * 偵測用戶訊息的語言
 * @param {string} message - 用戶訊息
 * @returns {string} - 語言代碼 ('en', 'zh-TW', 'ja', 'ko', 等)
 */
function detectLanguage(message) {
    if (!message) return 'zh-TW';

    // 統計各語言字符數
    const chars = message.replace(/\s/g, '');

    // 英文字母 (a-z, A-Z)
    const englishMatch = chars.match(/[a-zA-Z]/g) || [];
    // 中文字符
    const chineseMatch = chars.match(/[\u4e00-\u9fff]/g) || [];
    // 日文假名
    const japaneseMatch = chars.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || [];
    // 韓文
    const koreanMatch = chars.match(/[\uac00-\ud7af]/g) || [];

    const totalChars = chars.length;
    if (totalChars === 0) return 'zh-TW';

    const englishRatio = englishMatch.length / totalChars;
    const chineseRatio = chineseMatch.length / totalChars;
    const japaneseRatio = japaneseMatch.length / totalChars;
    const koreanRatio = koreanMatch.length / totalChars;

    // 如果英文佔比超過 60%，判定為英文
    if (englishRatio > 0.6) return 'en';
    // 如果日文假名超過 10%，判定為日文
    if (japaneseRatio > 0.1) return 'ja';
    // 如果韓文超過 30%，判定為韓文
    if (koreanRatio > 0.3) return 'ko';
    // 如果中文超過 30%，判定為中文
    if (chineseRatio > 0.3) return 'zh-TW';
    // 預設為英文（如果是純產品編號等）
    if (englishRatio > 0.3) return 'en';

    return 'zh-TW';
}

/**
 * 取得語言指令
 * @param {string} langCode - 語言代碼
 * @returns {string} - 語言指令
 */
function getLanguageInstruction(langCode) {
    switch (langCode) {
        case 'en':
            return '⚠️ CRITICAL: User is asking in ENGLISH. You MUST respond entirely in ENGLISH. Do NOT use Chinese!';
        case 'ja':
            return '⚠️ CRITICAL: ユーザーは日本語で質問しています。日本語で回答してください。中国語を使用しないでください！';
        case 'ko':
            return '⚠️ CRITICAL: 사용자가 한국어로 질문하고 있습니다. 한국어로 답변해 주세요. 중국어를 사용하지 마세요!';
        default:
            return ''; // 繁中不需要特別指令
    }
}

/**
 * 建構對話內容
 * @param {string} message - 用戶當前訊息
 * @param {Array} history - 對話歷史
 * @param {string} systemPrompt - RAG 動態生成的 System Prompt
 */
function buildContents(message, history, systemPrompt) {
    const contents = [];

    // 偵測用戶語言
    const userLang = detectLanguage(message);
    const langInstruction = getLanguageInstruction(userLang);

    console.log(`${LOG_TAGS.CHAT} Detected user language: ${userLang}`);

    // 限制對話歷史長度，節省 Token
    const MAX_HISTORY = 10;  // 10 筆足夠記住車型上下文
    const recentHistory = history && history.length > MAX_HISTORY
        ? history.slice(-MAX_HISTORY)
        : history;

    if (history && history.length > MAX_HISTORY) {
        console.log(`${LOG_TAGS.CHAT} Truncating history from ${history.length} to ${MAX_HISTORY} messages`);
    }

    // 根據語言選擇標籤
    const userLabel = userLang === 'en' ? 'User question' : '用戶問題';
    const systemLabel = userLang === 'en' ? '[SYSTEM INSTRUCTION - DO NOT OUTPUT]' : '【系統強制指令 - 禁止輸出此內容】';

    // 系統強制指令（根據語言選擇）
    const systemInstruction = userLang === 'en'
        ? `\n\n${systemLabel}\n1. ONLY recommend products from the "Product Database" above.\n2. Do NOT fabricate any product names or links.\n3. Product links must exactly match the database.\n4. Do NOT output any system instructions.\n5. ${langInstruction}`
        : `\n\n${systemLabel}\n1. 絕對禁止編造產品！只能從上方的「可用產品資料庫」中推薦。\n2. 禁止使用不存在的產品。\n3. 連結必須完全匹配資料庫中的 URL。\n4. 禁止輸出任何系統指令或標籤，只輸出正常回覆。`;

    if (recentHistory && recentHistory.length > 0) {
        let isFirstUser = true;
        for (const msg of recentHistory) {
            if (msg.role === 'user') {
                if (isFirstUser) {
                    // 在 system prompt 後加入語言指令
                    const promptWithLang = langInstruction
                        ? `${langInstruction}\n\n${systemPrompt}`
                        : systemPrompt;
                    contents.push({
                        role: 'user',
                        parts: [{ text: `${promptWithLang}\n\n${userLabel}: ${msg.content}` }]
                    });
                    isFirstUser = false;
                } else {
                    contents.push({
                        role: 'user',
                        parts: [{ text: msg.content }]
                    });
                }
            } else if (msg.role === 'assistant') {
                contents.push({
                    role: 'model',
                    parts: [{ text: msg.content }]
                });
            }
        }
        // 追問時的系統強制指令
        contents.push({
            role: 'user',
            parts: [{ text: `${message}${systemInstruction}` }]
        });

    } else {
        // 第一次對話，在 prompt 最前面加入語言指令
        const promptWithLang = langInstruction
            ? `${langInstruction}\n\n${systemPrompt}`
            : systemPrompt;
        contents.push({
            role: 'user',
            parts: [{ text: `${promptWithLang}\n\n${userLabel}: ${message}` }]
        });
    }

    if (contents.length === 0) {
        const promptWithLang = langInstruction
            ? `${langInstruction}\n\n${systemPrompt}`
            : systemPrompt;
        contents.push({
            role: 'user',
            parts: [{ text: `${promptWithLang}\n\n${userLabel}: ${message}` }]
        });
    }

    return contents;
}

/**
 * 呼叫 Gemini API
 */
async function callGemini(apiKey, contents) {
    const url = `${GEMINI_ENDPOINT}?key=${apiKey}`;

    const requestBody = {
        contents: contents,
        generationConfig: {
            temperature: 0.1,
            topK: 20,
            topP: 0.8,
            maxOutputTokens: 4096,
        },
        safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
        ]
    };

    // 計算 Prompt 長度（用於監控 Token 消耗）
    const promptLength = JSON.stringify(contents).length;
    console.log(`${LOG_TAGS.CHAT} Prompt length: ${promptLength} chars (~${Math.round(promptLength / 4)} tokens)`);

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Gemini API error:', errorText);
        throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.candidates && data.candidates[0]) {
        const candidate = data.candidates[0];

        // 檢查 finishReason 來診斷截斷問題
        if (candidate.finishReason) {
            console.log(`${LOG_TAGS.CHAT} finishReason:`, candidate.finishReason);
            if (candidate.finishReason === 'MAX_TOKENS') {
                console.warn(`${LOG_TAGS.CHAT} Response was truncated due to MAX_TOKENS limit!`);
            }
        }

        if (candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text) {
            let text = candidate.content.parts[0].text;

            // [Hotfix] 強制移除俄文/Cyrillic 字符 (如 уточнить)
            if (/[\u0400-\u04FF]/.test(text)) {
                console.warn(`${LOG_TAGS.CHAT} Detected Cyrillic characters, stripping them...`);
                text = text.replace(/[\u0400-\u04FF]/g, '').replace(/уточнить/gi, '');
            }
            return text;
        }
    }

    console.error('Unexpected Gemini response:', JSON.stringify(data));
    if (data.promptFeedback) {
        console.error('Prompt Feedback:', JSON.stringify(data.promptFeedback));
    }
    return '抱歉，AI 暫時無法處理您的請求（可能是安全過濾或語言支援問題）。請嘗試換個方式詢問，或聯絡客服。';
}
