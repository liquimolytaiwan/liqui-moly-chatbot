/**
 * LIQUI MOLY Chatbot - Vercel Serverless Function
 * 主要聊天 API - 處理用戶訊息並返回 AI 回覆
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const PRODUCT_BASE_URL = 'https://www.liqui-moly-tw.com/products/';

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
};

// 系統提示詞
const SYSTEM_PROMPT = `你是 LIQUI MOLY Taiwan（力魔機油台灣總代理）的 AI產品諮詢助理。

## 你的身份
- 你代表台灣總代理宜福工業提供客戶服務
- 你專業、友善、有耐心
- 你只回答與 LIQUI MOLY 產品相關的問題

## 核心職責
1. 根據車型推薦合適的機油（汽車、摩托車皆可）
2. 解答產品使用方式
3. 引導購買正品公司貨

## 🚨🚨🚨 最重要規則（必須遵守！）

### 你的產品資料來源
下方會提供「可用產品資料庫」，裡面列出了你可以推薦的所有產品。
**你必須從這個資料庫中選擇產品推薦，不要說「找不到」！**

### 產品推薦策略
1. **添加劑查詢**：在資料庫中找「添加劑」「Additive」「Shooter」相關產品
2. **機油查詢**：在資料庫中找「機油」「Oil」「Motorbike」相關產品
3. **摩托車查詢**：在資料庫中找產品分類包含「摩托車」的產品

### 絕對禁止說的話
- ❌「找不到相關產品」
- ❌「目前資料庫中沒有」
- ❌「建議瀏覽產品目錄」

### 應該說的話
- ✅「針對您的 [車型]，推薦以下產品：」
- ✅「這款產品適合您的需求：」

## 標準回覆範本

### 推薦產品時
> 針對您的 [車型]，推薦：
> - [產品名稱](連結) - 符合 XX 認證，適合 XX 引擎
> 
> 👉 點擊產品頁面「這哪裡買」可查詢鄰近店家

### 購買管道問題
> 🏪 推薦使用我們的**[店家查詢系統](https://www.liqui-moly-tw.com/storefinder)**！
> 只要選擇縣市，即可找到您附近的合作保修廠/車行。

## 回覆格式
- 使用繁體中文回覆
- 適時使用表情符號增加親和力
- 產品推薦時提供連結格式：[產品名稱](產品頁面URL)
- 保持回覆精簡但完整`;

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

        // 建構對話內容
        const contents = buildContents(message, conversationHistory, productContext);

        // 呼叫 Gemini API
        const aiResponse = await callGemini(apiKey, contents);

        Object.keys(corsHeaders).forEach(key => res.setHeader(key, corsHeaders[key]));
        return res.status(200).json({ success: true, response: aiResponse });

    } catch (error) {
        console.error('Chat API error:', error);
        Object.keys(corsHeaders).forEach(key => res.setHeader(key, corsHeaders[key]));
        return res.status(500).json({ success: false, error: error.message });
    }
}

// 建構對話內容
function buildContents(message, history, productContext) {
    const systemContext = `${SYSTEM_PROMPT}

${productContext}

【重要提醒】
- 你必須從上方「可用產品資料庫」中選擇產品推薦
- 推薦產品時必須使用資料庫中的「產品連結」
- 連結必須是 https://www.liqui-moly-tw.com/products/ 開頭
- 使用 Markdown 格式：[產品名稱](產品連結)
- **重要**：即使用戶追問（如「下賽道呢」「那機油呢」），也要從產品資料庫中找到相關產品推薦！`;

    const contents = [];

    if (history && history.length > 0) {
        let isFirstUser = true;
        for (const msg of history) {
            if (msg.role === 'user') {
                if (isFirstUser) {
                    contents.push({
                        role: 'user',
                        parts: [{ text: `${systemContext}\n\n用戶問題: ${msg.content}` }]
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
        // 追問時也要提醒 AI 產品資料庫可用
        contents.push({
            role: 'user',
            parts: [{ text: `${message}\n\n【系統提醒】請根據上方「可用產品資料庫」推薦相關產品，不要說找不到！資料庫中有${productContext.includes('Motorbike') ? '摩托車添加劑、機油' : ''}等產品可供推薦。` }]
        });
    } else {
        contents.push({
            role: 'user',
            parts: [{ text: `${systemContext}\n\n用戶問題: ${message}` }]
        });
    }

    if (contents.length === 0) {
        contents.push({
            role: 'user',
            parts: [{ text: `${systemContext}\n\n用戶問題: ${message}` }]
        });
    }

    return contents;
}

// 呼叫 Gemini API
async function callGemini(apiKey, contents) {
    const url = `${GEMINI_API_URL}?key=${apiKey}`;

    const requestBody = {
        contents: contents,
        generationConfig: {
            temperature: 0.4,
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
        if (candidate.content && candidate.content.parts && candidate.content.parts[0] && candidate.content.parts[0].text) {
            return candidate.content.parts[0].text;
        }
    }

    console.error('Unexpected Gemini response:', JSON.stringify(data));
    return '抱歉，我暫時無法處理這個問題。您可以換個方式詢問，或透過[聯絡表單](https://www.liqui-moly-tw.com/contact)與我們聯繫。';
}
