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

說明與規則：
1. **vehicleType (車型判斷 - 非常重要！)**
   - "摩托車"：出現 機車、摩托車、重機、檔車、速克達、跑山、JET、勁戰、MMBCU、DRG、Force、SMAX、R15、CBR、Ninja、GSX、Vespa
   - "汽車"：預設值，或出現 汽車、轎車、SUV
   
2. **productCategory (產品主類別 - 關鍵過濾依據)**
   - "添加劑"：出現 添加劑、油精、快樂跑、清潔燃油、通油路、Shooter、Engine Flush、汽門、除碳
   - "機油"：出現 機油、潤滑油、Oil、5W30、10W40 (若沒特別指添加劑)
   - "清潔"：出現 洗車、打蠟、鍍膜、清潔劑、洗鍊條
   - "變速箱"：出現 變速箱油、ATF、齒輪油
   - "煞車"：出現 煞車油
   - "冷卻"：出現 水箱精、冷卻液
   
3. **searchKeywords (搜尋關鍵字)**
   - 必須包含中英文，用於資料庫模糊搜尋
   - 問添加劑 -> ["添加劑", "Additive", "Shooter", "Cleaner"]
   
4. **isGeneralProduct**
   - 洗車、煞車油、冷卻液等不限車型的產品設為 true

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
                const result = JSON.parse(jsonMatch[0]);

                // ============================================
                // 生成 Wix 查詢指令 (Logic moved from Wix to here!)
                // ============================================
                result.wixQueries = generateWixQueries(result, result.searchKeywords || []);

                return result;
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

// 根據 AI 分析結果，生成具體的 Wix Data Query 指令
function generateWixQueries(analysis, keywords) {
    const queries = [];
    const { vehicleType, productCategory, vehicleSubType } = analysis;
    const isBike = vehicleType === '摩托車';
    const isScooter = isBike && (
        (vehicleSubType && vehicleSubType.includes('速克達')) ||
        keywords.some(k => ['jet', '勁戰', 'drg', 'mmbcu', 'force', 'smax', 'scooter'].includes(k.toLowerCase()))
    );

    // Helper to add query
    const addQuery = (field, value, limit = 20, method = 'contains') => {
        queries.push({ field, value, limit, method });
    };

    // === 策略 A: 摩托車添加劑 ===
    if (isBike && productCategory === '添加劑') {
        addQuery('sort', '【摩托車】添加劑', 30);
        addQuery('sort', '【摩托車】機車養護', 20);
        // Title backup
        queries.push({ field: 'title', value: 'Motorbike', limit: 30, method: 'contains', filterTitle: ['Additive', 'Shooter', 'Flush', 'Cleaner'] });
    }

    // === 策略 B: 摩托車機油 ===
    else if (isBike && productCategory === '機油') {
        if (isScooter) {
            // 速克達優先
            queries.push({ field: 'sort', value: '【摩托車】機油', limit: 20, method: 'contains', andContains: { field: 'title', value: 'Scooter' } });
            // 其他備選
            addQuery('sort', '【摩托車】機油', 30);
        } else {
            addQuery('sort', '【摩托車】機油', 50);
        }
    }

    // === 策略 C: 汽車添加劑 ===
    else if (!isBike && productCategory === '添加劑') {
        addQuery('sort', '【汽車】添加劑', 30);
    }

    // === 策略 D: 汽車機油 ===
    else if (!isBike && productCategory === '機油') {
        addQuery('sort', '【汽車】機油', 50);
    }

    // === 策略 E: 通用/清潔 ===
    else if (productCategory === '清潔' || productCategory === '美容') {
        addQuery('sort', '車輛美容', 30);
        addQuery('sort', '【汽車】空調', 10);
    }

    // === Fallback: 如果上面都沒有指令，或者是「其他」 ===
    if (queries.length === 0) {
        // 至少用關鍵字搜一下
        keywords.slice(0, 2).forEach(kw => {
            addQuery('title', kw, 10);
        });

        // 如果是摩托車，加搜摩托車總類
        if (isBike) {
            addQuery('sort', '摩托車', 20);
        }
    }

    return queries;
}
