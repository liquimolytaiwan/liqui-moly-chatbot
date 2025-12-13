/**
 * LIQUI MOLY Chatbot - Wix Velo HTTP Functions
 * 
 * 整合版本：所有程式碼都在此檔案中
 * 檔案路徑: backend/http-functions.js
 */

import { ok, badRequest, serverError } from 'wix-http-functions';
import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';
import wixData from 'wix-data';

// ============================================
// 常數定義
// ============================================

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
const PRODUCT_BASE_URL = 'https://www.liqui-moly-tw.com/products/';

const SYSTEM_PROMPT = `你是 LIQUI MOLY Taiwan（力魔機油台灣總代理）的產品諮詢助理。

## 你的身份
- 你代表台灣總代理宜福工業提供客戶服務
- 你專業、友善、有耐心
- 你只回答與 LIQUI MOLY 產品相關的問題

## 核心職責
1. 根據消費者車型推薦合適的機油產品
2. 解答產品使用方式與應用情境問題
3. 引導消費者購買正品公司貨

## 回覆規則

### 車型機油推薦流程
1. 詢問車型資訊（年份、品牌、型號）
2. 若資訊不足，追問具體版本（如排氣量、引擎類型）
3. 查詢車主手冊所需的認證規格（如 MB 229.52, BMW LL-04）
4. 從產品資料庫匹配符合規格的產品
5. 提供產品名稱、適用原因，並附上產品連結

### 購買管道問題
當消費者詢問「哪裡買」時，回覆：
「您可以使用產品頁面上方的『這哪裡買』功能，系統會顯示您所在位置 50 公里內有販售的店家資訊。
或者前往『聯絡我們』填寫線上表單，我們會以簡訊回覆店家資訊。」

### 電商平台問題
當消費者提到蝦皮、MOMO、PCHOME 等電商平台時，回覆：
「網路電商平台上的 LIQUI MOLY 產品並非總代理公司貨。
我們並沒有在網路平台販售機油與添加劑相關產品，因此無法提供品質保證與售後服務。
建議您透過官方管道購買公司貨。」

### 回覆格式
- 使用繁體中文回覆
- 適時使用表情符號增加親和力
- 產品推薦時提供連結格式：[產品名稱](產品頁面URL)

## 禁止事項
- 不得推薦非 LIQUI MOLY 品牌產品
- 不得承諾價格或促銷活動`;

// ============================================
// 健康檢查 API（最簡單，用於測試）
// ============================================

export function get_health(request) {
    return ok({
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({
            status: "ok",
            timestamp: new Date().toISOString(),
            service: "LIQUI MOLY Chatbot API"
        })
    });
}

// ============================================
// OPTIONS 處理 (CORS Preflight)
// ============================================

export function options_chat(request) {
    return ok({
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        },
        body: ""
    });
}

export function options_products(request) {
    return ok({
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        },
        body: ""
    });
}

// ============================================
// 聊天 API
// ============================================

export async function post_chat(request) {
    const corsHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    };

    try {
        const body = await request.body.json();

        if (!body.message || typeof body.message !== 'string') {
            return badRequest({
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: "Missing or invalid message parameter"
                })
            });
        }

        if (body.message.length > 1000) {
            return badRequest({
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: "Message too long"
                })
            });
        }

        const conversationHistory = Array.isArray(body.conversationHistory)
            ? body.conversationHistory
            : [];

        // 取得 API Key
        let apiKey;
        try {
            apiKey = await getSecret('GEMINI_API_KEY');
        } catch (e) {
            console.error('Failed to get API key:', e);
            return serverError({
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: "API configuration error"
                })
            });
        }

        if (!apiKey) {
            return serverError({
                headers: corsHeaders,
                body: JSON.stringify({
                    success: false,
                    error: "API key not found"
                })
            });
        }

        // 查詢相關產品
        let productContext = "目前沒有產品資料";
        try {
            productContext = await searchProducts(body.message);
        } catch (e) {
            console.error('Product search failed:', e);
        }

        // 建構對話內容
        const contents = buildContents(body.message, conversationHistory, productContext);

        // 呼叫 Gemini API
        const aiResponse = await callGemini(apiKey, contents);

        return ok({
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                response: aiResponse
            })
        });

    } catch (error) {
        console.error('POST /chat error:', error);
        return serverError({
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: "Internal server error: " + error.message
            })
        });
    }
}

// ============================================
// 產品 API
// ============================================

export async function get_products(request) {
    const corsHeaders = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    };

    try {
        const results = await wixData.query('products')
            .ascending('title')
            .limit(1000)
            .find();

        const products = results.items.map(p => ({
            id: p._id,
            title: p.title,
            partno: p.partno,
            viscosity: p.word2,
            certifications: p.cert,
            category: p.sort,
            url: p.partno ? `${PRODUCT_BASE_URL}${p.partno.toLowerCase()}` : null
        }));

        return ok({
            headers: corsHeaders,
            body: JSON.stringify({
                success: true,
                products: products
            })
        });

    } catch (error) {
        console.error('GET /products error:', error);
        return serverError({
            headers: corsHeaders,
            body: JSON.stringify({
                success: false,
                error: "Internal server error: " + error.message
            })
        });
    }
}

// ============================================
// 內部函數
// ============================================

async function searchProducts(query) {
    try {
        const results = await wixData.query('products')
            .contains('title', query)
            .or(wixData.query('products').contains('content', query))
            .or(wixData.query('products').contains('cert', query))
            .or(wixData.query('products').contains('word2', query))
            .limit(15)
            .find();

        if (results.items.length === 0) {
            const allProducts = await wixData.query('products')
                .contains('sort', '機油')
                .limit(20)
                .find();
            return formatProducts(allProducts.items);
        }

        return formatProducts(results.items);
    } catch (error) {
        console.error('Product search error:', error);
        return '無法取得產品資料';
    }
}

function formatProducts(products) {
    if (!products || products.length === 0) {
        return '目前沒有匹配的產品資料';
    }

    let context = '## 可用產品資料庫\n\n';

    products.forEach((p, i) => {
        const url = p.partno
            ? `${PRODUCT_BASE_URL}${p.partno.toLowerCase()}`
            : 'https://www.liqui-moly-tw.com/catalogue';

        context += `### ${i + 1}. ${p.title || '未命名產品'}\n`;
        context += `- 產品編號: ${p.partno || 'N/A'}\n`;
        context += `- 黏度: ${p.word2 || 'N/A'}\n`;
        context += `- 認證/規格: ${p.cert || 'N/A'}\n`;
        context += `- 分類: ${p.sort || 'N/A'}\n`;
        context += `- 使用方法: ${p.use || 'N/A'}\n`;
        context += `- 產品連結: ${url}\n`;
        context += `- 產品說明: ${p.content || 'N/A'}\n\n`;
    });

    return context;
}

function buildContents(message, history, productContext) {
    const contents = [];
    const systemContext = `${SYSTEM_PROMPT}\n\n${productContext}\n\n請基於以上產品資料回答用戶問題。`;

    if (history && history.length > 0) {
        history.forEach(msg => {
            contents.push({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            });
        });
    }

    const currentMessage = contents.length === 0
        ? `${systemContext}\n\n用戶問題: ${message}`
        : message;

    contents.push({
        role: 'user',
        parts: [{ text: currentMessage }]
    });

    return contents;
}

async function callGemini(apiKey, contents) {
    const url = `${GEMINI_API_URL}?key=${apiKey}`;

    const requestBody = {
        contents: contents,
        generationConfig: {
            temperature: 0.7,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 1024,
        },
        safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
        ]
    };

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

    if (data.candidates && data.candidates[0] && data.candidates[0].content) {
        const parts = data.candidates[0].content.parts;
        if (parts && parts[0] && parts[0].text) {
            return parts[0].text;
        }
    }

    throw new Error('Invalid response from Gemini API');
}
