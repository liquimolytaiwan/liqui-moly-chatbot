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

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const PRODUCT_BASE_URL = 'https://www.liqui-moly-tw.com/products/';

const SYSTEM_PROMPT = `你是 LIQUI MOLY Taiwan（力魔機油台灣總代理）的產品諮詢助理。

## 你的身份
- 你代表台灣總代理宜福工業提供專業客戶服務
- 你是產品專家，回覆簡潔有力、直接切入重點
- 你只回答與 LIQUI MOLY 產品相關的問題

## 回覆風格（非常重要）
- **簡潔**：不說廢話，直接給答案
- **專業**：用專業術語但確保消費者能理解
- **有說服力**：強調產品優勢和認證規格
- **格式清晰**：善用條列式，易於閱讀
- 每次回覆控制在 3-5 句話內（除非需要列出多個產品）

## 核心職責
1. 根據車型推薦合適的機油（汽車、摩托車皆可）
2. 解答產品使用方式
3. 引導購買正品公司貨

## 產品類別
- 汽車機油、摩托車機油
- 添加劑（油精、燃油添加劑）
- 化學品（清潔劑、保養品）

## ⚠️ 產品推薦規則（必遵守）
- **必須**使用「可用產品資料庫」中的「產品連結」
- 連結格式：[產品名稱](https://www.liqui-moly-tw.com/products/lmXXXX)
- **禁止**編造連結或使用其他網域

## 標準回覆範本

### 推薦產品時
> 針對您的 [車型]，推薦：
> - [產品名稱](連結) - 符合 XX 認證，適合 XX 引擎
> 
> 👉 點擊產品頁面「這哪裡買」可查詢鄰近店家

### 購買管道問題
> 請使用產品頁面的「這哪裡買」功能，或填寫[聯絡表單](https://www.liqui-moly-tw.com/contact)。

### 電商平台問題
> 電商平台非公司貨，無品質保證。建議透過官方管道購買。

## 禁止事項
- 不推薦非 LIQUI MOLY 產品
- 不承諾價格或促銷
- 不編造產品資訊`;

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
        // 先判斷是否為摩托車/機車相關查詢（包含車型名稱）
        const lowerQuery = query.toLowerCase();
        const motorcycleKeywords = ['摩托車', '機車', '重機', '速克達', 'cuxi', 'cygnus', 'bws', 'force', 'smax', 'xmax', 'tmax', 'r3', 'r6', 'mt', 'gogoro', 'kymco', 'sym', 'yamaha', 'honda', 'kawasaki', 'suzuki', 'vespa', '勁戰', '四代戰', '五代戰', '六代戰', 'nmax', 'pcx', 'dio', 'jog', 'rs', 'fighter', 'jet', 'many', 'g6', 'racing', 'gp', '彪虎', '雷霆', 'duke'];

        const isMotorcycleQuery = motorcycleKeywords.some(keyword => lowerQuery.includes(keyword));

        // 如果是摩托車相關查詢，優先搜尋摩托車產品
        if (isMotorcycleQuery) {
            const motorcycleProducts = await wixData.query('products')
                .contains('sort', '摩托車')
                .limit(20)
                .find();

            if (motorcycleProducts.items.length > 0) {
                return formatProducts(motorcycleProducts.items);
            }
        }

        // 搜尋所有相關欄位
        const results = await wixData.query('products')
            .contains('title', query)
            .or(wixData.query('products').contains('content', query))
            .or(wixData.query('products').contains('cert', query))
            .or(wixData.query('products').contains('word2', query))
            .or(wixData.query('products').contains('sort', query))
            .limit(20)
            .find();

        if (results.items.length > 0) {
            return formatProducts(results.items);
        }

        // 沒有匹配結果時，根據關鍵字判斷類別
        let category = '';

        if (lowerQuery.includes('化學') || lowerQuery.includes('清潔') || lowerQuery.includes('噴劑') || lowerQuery.includes('油脂') || lowerQuery.includes('潤滑')) {
            category = '化學品';
        } else if (lowerQuery.includes('添加劑') || lowerQuery.includes('油精') || lowerQuery.includes('燃油')) {
            category = '添加劑';
        } else if (lowerQuery.includes('自行車') || lowerQuery.includes('腳踏車')) {
            category = '自行車';
        } else if (lowerQuery.includes('美容') || lowerQuery.includes('洗車') || lowerQuery.includes('打蠟')) {
            category = '美容';
        } else {
            category = '機油'; // 預設分類
        }

        const categoryProducts = await wixData.query('products')
            .contains('sort', category)
            .limit(15)
            .find();

        // 如果還是沒有結果，取得任意產品
        if (categoryProducts.items.length === 0) {
            const anyProducts = await wixData.query('products')
                .limit(20)
                .find();
            return formatProducts(anyProducts.items);
        }

        return formatProducts(categoryProducts.items);
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

    // 建構系統上下文（每次都包含）
    const systemContext = `${SYSTEM_PROMPT}

${productContext}

【重要提醒】
- 你必須從上方「可用產品資料庫」中選擇產品推薦
- 推薦產品時必須使用資料庫中的「產品連結」
- 連結必須是 https://www.liqui-moly-tw.com/products/ 開頭
- 使用 Markdown 格式：[產品名稱](產品連結)`;

    // 加入歷史對話
    if (history && history.length > 0) {
        // 第一條訊息加入系統上下文
        history.forEach((msg, index) => {
            if (index === 0 && msg.role === 'user') {
                contents.push({
                    role: 'user',
                    parts: [{ text: `${systemContext}\n\n用戶問題: ${msg.content}` }]
                });
            } else {
                contents.push({
                    role: msg.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: msg.content }]
                });
            }
        });

        // 當前訊息（繼續對話時仍帶上產品資料庫提醒）
        contents.push({
            role: 'user',
            parts: [{ text: `${message}\n\n（請記得使用上方產品資料庫中的連結推薦產品）` }]
        });
    } else {
        // 沒有歷史時，第一條訊息加入完整上下文
        contents.push({
            role: 'user',
            parts: [{ text: `${systemContext}\n\n用戶問題: ${message}` }]
        });
    }

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
            maxOutputTokens: 4096,
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
