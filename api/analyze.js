/**
 * LIQUI MOLY Chatbot - Vercel Serverless Function
 * AI 分析用戶問題，判斷車型類別和需要的規格
 */

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

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
        const { message, conversationHistory = [] } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Missing message parameter' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'API key not configured' });
        }

        const result = await analyzeUserQuery(apiKey, message, conversationHistory);

        Object.keys(corsHeaders).forEach(key => res.setHeader(key, corsHeaders[key]));
        return res.status(200).json({ success: true, analysis: result });

    } catch (error) {
        console.error('Analyze API error:', error);
        Object.keys(corsHeaders).forEach(key => res.setHeader(key, corsHeaders[key]));
        return res.status(500).json({ success: false, error: error.message });
    }
}

// AI 分析用戶問題
async function analyzeUserQuery(apiKey, message, conversationHistory = []) {
    // 建構對話上下文摘要
    let contextSummary = '';
    if (conversationHistory && conversationHistory.length > 0) {
        const recentHistory = conversationHistory.slice(-4);
        contextSummary = '對話上下文（以此推斷車型）：\n' + recentHistory.map(m =>
            `${m.role === 'user' ? '用戶' : 'AI'}: ${m.content.substring(0, 100)}...`
        ).join('\n') + '\n\n';
    }

    const analysisPrompt = `你是一個汽機車專家和產品顧問。請分析用戶的問題，判斷需要的產品類型和規格。

${contextSummary}用戶當前問題：「${message}」

請只返回一個 JSON 對象，格式如下：
{
    "vehicleType": "汽車",
    "vehicleSubType": "未知",
    "certifications": [],
    "viscosity": "",
    "searchKeywords": ["機油"],
    "productCategory": "機油",
    "productSubCategory": "",
    "isGeneralProduct": false,
    "needsProductRecommendation": true
}

說明：
- vehicleType: "汽車" 或 "摩托車" 或 "未知"（根據上下文推斷）
- vehicleSubType: "速克達"/"檔車"/"重機"/"轎車"/"柴油車"/"SUV"/"未知"
- certifications: 認證陣列如 ["JASO MA2"]、["ACEA C3"]
- viscosity: 黏度如 "10W40"、"5W30"
- searchKeywords: **重要**！用於搜尋產品標題的關鍵字，要多元化，例如：
  - 問「洗車」→ ["洗車", "Wash", "Shampoo", "Car Wash"]
  - 問「機油」→ ["機油", "Oil", "Motoroil"]
  - 問「添加劑」→ ["添加劑", "Additive", "Shooter"]
- productCategory: 主類別 - "機油"/"添加劑"/"變速箱"/"煞車"/"冷卻"/"美容清潔"/"化學品"/"空調"/"其他"
- productSubCategory: 細分類別（選填）
- isGeneralProduct: **重要**！如果產品不限於特定車型（如洗車液、煞車油、冷卻液）填 true
- needsProductRecommendation: 需要推薦產品填 true，純知識問題填 false

注意：
1. 摩托車檔車需要 JASO MA/MA2，速克達需要 JASO MB
2. 根據對話上下文推斷車型，即使當前問題沒有明確說
3. **重要**：searchKeywords 要包含中英文關鍵字，確保能搜尋到產品
4. 洗車、煞車油、冷卻液等是通用產品，isGeneralProduct 應為 true
5. 只返回 JSON，不要其他文字。`;

    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: analysisPrompt }] }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 500
                }
            })
        });

        if (!response.ok) {
            console.error('AI analysis API error:', response.status);
            return null;
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // 嘗試解析 JSON
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]);
            } catch (parseError) {
                console.error('JSON parse error:', parseError, 'Text:', text);
                return null;
            }
        }
        return null;
    } catch (e) {
        console.error('analyzeUserQuery error:', e);
        return null;
    }
}
