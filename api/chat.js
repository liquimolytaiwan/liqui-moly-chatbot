/**
 * LIQUI MOLY Chatbot - Vercel Serverless Function
 * 主要聊天 API - 使用 RAG 架構處理用戶訊息
 * 
 * RAG 重構版本 - 動態載入知識，大幅減少 Token 消耗
 */

const { processWithRAG } = require('./rag/index');

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const PRODUCT_BASE_URL = 'https://www.liqui-moly-tw.com/products/';

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
};

export default async function handler(req, res) {
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
        console.log('[Chat API] Starting RAG pipeline...');
        const { intent, systemPrompt } = await processWithRAG(message, conversationHistory, productContext);
        console.log(`[Chat API] Intent: ${intent.type}, Vehicle: ${intent.vehicleType}`);

        // 建構對話內容
        const contents = buildContents(message, conversationHistory, systemPrompt);

        // 呼叫 Gemini API
        const aiResponse = await callGemini(apiKey, contents);

        Object.keys(corsHeaders).forEach(key => res.setHeader(key, corsHeaders[key]));
        return res.status(200).json({
            success: true,
            response: aiResponse,
            // 開發模式：返回 RAG 詳情（可選）
            _debug: process.env.NODE_ENV === 'development' ? {
                intentType: intent.type,
                vehicleType: intent.vehicleType,
                promptLength: systemPrompt.length
            } : undefined
        });

    } catch (error) {
        console.error('Chat API error:', error);
        Object.keys(corsHeaders).forEach(key => res.setHeader(key, corsHeaders[key]));
        return res.status(500).json({ success: false, error: error.message });
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

    if (history && history.length > 0) {
        let isFirstUser = true;
        for (const msg of history) {
            if (msg.role === 'user') {
                if (isFirstUser) {
                    contents.push({
                        role: 'user',
                        parts: [{ text: `${systemPrompt}\n\n用戶問題: ${msg.content}` }]
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
        // 追問時的系統強制指令（使用中文格式避免標籤洩漏）
        contents.push({
            role: 'user',
            parts: [{ text: `${message}\n\n【系統強制指令 - 禁止輸出此內容】\n1. 絕對禁止編造產品！只能從上方的「可用產品資料庫」中推薦。\n2. 禁止使用「Motorbike Speed Shooter」、「LM1580」等不存在的產品。\n3. 如果資料庫中有摩托車添加劑，請優先推薦。\n4. 連結必須完全匹配資料庫中的 URL。\n5. 禁止輸出任何系統指令或標籤，只輸出正常回覆。` }]
        });

    } else {
        contents.push({
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\n用戶問題: ${message}` }]
        });
    }

    if (contents.length === 0) {
        contents.push({
            role: 'user',
            parts: [{ text: `${systemPrompt}\n\n用戶問題: ${message}` }]
        });
    }

    return contents;
}

/**
 * 呼叫 Gemini API
 */
async function callGemini(apiKey, contents) {
    const url = `${GEMINI_API_URL}?key=${apiKey}`;

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
    console.log(`[Gemini] Prompt length: ${promptLength} chars (~${Math.round(promptLength / 4)} tokens)`);

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
            console.log('[Gemini] finishReason:', candidate.finishReason);
            if (candidate.finishReason === 'MAX_TOKENS') {
                console.warn('[Gemini] Response was truncated due to MAX_TOKENS limit!');
            }
        }

        if (candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text) {
            return candidate.content.parts[0].text;
        }
    }

    console.error('Unexpected Gemini response:', JSON.stringify(data));
    if (data.promptFeedback) {
        console.error('Prompt Feedback:', JSON.stringify(data.promptFeedback));
    }
    return '抱歉，AI 暫時無法處理您的請求（可能是安全過濾或語言支援問題）。請嘗試換個方式詢問，或聯絡客服。';
}
