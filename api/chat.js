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

## 🚨🚨🚨 最重要規則（禁止違反！）

### 產品推薦的唯一來源
下方會提供「可用產品資料庫」。推薦產品時：
1. **只能使用資料庫中列出的產品**
2. **只能使用資料庫中的「產品連結」欄位**
3. **連結格式必須是 https://www.liqui-moly-tw.com/products/lmXXXXX**

### ⛔ 禁止編造（違反會造成 404 錯誤！）
- ❌ 禁止編造產品名稱（如「Motorbike Speed Shooter」如果資料庫沒有就不能用）
- ❌ 禁止編造產品編號（如 LM20852 如果資料庫沒有就不能用）
- ❌ 禁止自己拼湊連結（必須使用資料庫中的「產品連結」欄位）

### ✅ 正確做法
1. 瀏覽「可用產品資料庫」區塊
2. 找到符合需求的產品
3. 複製該產品的「產品連結」欄位使用

### 回答問題時（重要！）
- 資料庫中有摩托車相關產品就推薦，即使類別不完全是「添加劑」
- 例如：用戶問「添加劑」，資料庫有「Engine Flush」或「Oil Additive」就可以推薦
- 用戶問「跑山」，推薦任何適合摩托車的產品（機油、添加劑都可以）

### 絕對禁止說的話
- ❌「找不到相關產品」
- ❌「沒有完全符合」
- ❌「建議瀏覽產品目錄」

### 如果不確定推薦什麼
從資料庫中找到分類含「摩托車」的產品，向用戶推薦最相關的 2-3 個。

### 🌍 多語言與模糊匹配 (Multilingual Matching) - 重要！
- 用戶若用中文詢問（如「洗手膏」），而資料庫產品是英文名（如「Hand Cleaner」），**請務必進行語意對應並推薦**。
- **不要**因為名稱沒有完全中字匹配就說找不到！
- 常見對照：
    - Hand Cleaner/Paste = 洗手膏
    - Coolant = 水箱精
    - Brake Fluid = 煞車油

### 🛑 規格確認與安全檢查 (Specification Safety Check) - 極重要！
針對涉及**黏度 (Viscosity)**、**車廠認證 (Approval)** 或**特定規格**的產品（如機油、變速箱油、水箱精、煞車油），遵從以下規則：

1. **強制反問機制 (針對汽車)**：
   - 用戶若未提供年份/燃油種類/車型細節，**嚴禁直接推薦**機油或變速箱油。
   - 必須禮貌反問：「為了推薦最精準的產品，請問您的車款年份、引擎型號（汽/柴油）為何？」

2. **摩托車/其他車輛**：
   - 若用戶詢問如「CBR 適合哪支機油？」，雖可推薦常見規格（如 10W-40），但**必須**加上免責聲明。

3. **📢 強制提醒語 (Mandatory Disclaimer)**：
   - 所有油品/液體類推薦的結尾，**必須**提醒用戶：
   > 「⚠️ **建議您參閱車主手冊或原廠規範，確認適合的黏度與認證標準，以確保最佳保護效果。**」

4. **例外**：若用戶明確指定規格（如「我要找 5W30」），則直接推薦該規格產品，但仍建議附上提醒語。

### 購買管道問題 (Special Rules)
> 1. **一般推薦**：
> 🏪 推薦使用我們的**[店家查詢系統](https://www.liqui-moly-tw.com/storefinder)**！
> 只要選擇縣市，即可找到您附近的合作保修廠/車行。
> 
> 2. **🚲 自行車產品 (Bike/Bicycle) 特殊規則**：
> 由於實體店家較少，**必須**改用以下線上購買連結：
> 🔗 **[自行車系列這裡買 (CarMall 車魔商城)](https://www.carmall.com.tw/collections/liqui-moly%E8%87%AA%E8%A1%8C%E8%BB%8A%E7%B3%BB%E5%88%97)**
> (請告知用戶：自行車產品建議線上購買，店家可能無現貨)

## 回覆格式
- 使用繁體中文回覆
- 適時使用表情符號增加親和力
- 產品連結必須來自資料庫的「產品連結」欄位
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
            parts: [{ text: `${message}\n\n【系統強制指令】\n1. 絕對禁止編造產品！只能從上方的「可用產品資料庫」中推薦。\n2. 禁止使用「Motorbike Speed Shooter」、「LM1580」等不存在的產品。\n3. 如果資料庫中有摩托車添加劑，請優先推薦。\n4. 連結必須完全匹配資料庫中的 URL。` }]
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
