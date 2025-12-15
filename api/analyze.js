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
1. **上下文繼承 (Context Inheritance - CRITICAL)**
   - 如果當前問題很短（如「那機油呢？」、「是」），**必須**回溯上方對話紀錄找到車型與**認證規格**。
   - 如果之前提過 "JET", "勁戰", "DRG"，那麼 vehicleSubType **必須** 填入 "速克達"。
   - 如果之前提過 "CBR", "R15", "Ninja"，那麼 vehicleSubType **必須** 填入 "檔車"。
   - **一旦車型確定，除非用戶明確換車，否則後續所有搜尋都必須保留該車型設定。**
   - **關鍵：若歷史紀錄中提及特定認證（如 948B, LL-04, 504/507），務必將其加入 searchKeywords！**

2. **vehicleType (車型判斷)**
   - "摩托車"：出現 機車、摩托車、重機、檔車、速克達、跑山、JET、勁戰、MMBCU、DRG、Force、SMAX、R15、CBR、Ninja、GSX、Vespa
   - "船舶"：出現 船、Marine、Boat、艦艇、遊艇
   - "自行車"：出現 自行車、腳踏車、單車、Bike、Bicycle
   - "汽車"：預設值，或出現 汽車、轎車、SUV
   
3. **productCategory (產品主類別)**
   - "添加劑"：出現 添加劑、油精、快樂跑、清潔燃油、通油路、Shooter、Engine Flush、汽門、除碳
   - "機油"：出現 機油、潤滑油、Oil、5W30、10W40 (若沒特別指添加劑)
   - "清潔"：出現 洗車、打蠟、鍍膜、清潔劑、洗鍊條
   - "變速箱"：出現 變速箱油、ATF、齒輪油
   - "煞車"：出現 煞車油
   - "冷卻"：出現 水箱精、冷卻液
   - "鏈條"：出現 鏈條、鍊條、Chain、Lube、乾式、濕式、鍊條油、鏈條清洗
   - "船舶"：出現 船、Marine、Boat、艦艇
   - "自行車"：出現 自行車、腳踏車、單車、Bike、Bicycle
   
3. **searchKeywords (關鍵字 - 自動化搜尋的核心)**
   - 請提供 **3-5 個** 不同的關鍵字，用於資料庫廣泛搜尋。
   - 包含：中文名稱、英文名稱 (重要!)、同義詞、德文名稱 (若知道)。
   - 例如：鏈條油 -> ["Chain Lube", "Chain Spray", "鏈條油", "Ketten", "Lube"]
   - 例如：水箱精 -> ["Coolant", "Radiator", "Antifreeze", "水箱", "冷卻"]
   - 例如：水箱精 -> ["Coolant", "Radiator", "Antifreeze", "水箱", "冷卻"]
   - 例如：洗手 -> ["Hand Cleaner", "Hand Paste", "洗手膏", "Hand Wash", "洗手"]
   - **認證拆解**：若有認證關鍵字（如 948B），請同時提供拆解版本 ["948B", "948", "948-B"] 以增加匹配率。

4. **isGeneralProduct**
   - 洗車、煞車油、冷卻液、洗手、清潔劑等不限車型的產品設為 true

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
                // 🛑 強制上下文補救 (Rule-based Context Override)
                // ============================================
                try {
                    // 只有當 AI 沒有明確判斷為其他特定車種時，才執行歷史回溯補救
                    // 避免用戶問「那汽車呢？」時，因歷史紀錄有 JET 而被強制改回摩托車
                    const explicitTypes = ['汽車', '船舶', '自行車'];
                    if (!explicitTypes.includes(result.vehicleType)) {
                        const historyText = conversationHistory.map(m => m.content).join(' ').toLowerCase();
                        const scooterKeywords = ['jet', '勁戰', 'drg', 'mmbcu', 'force', 'smax', 'scooter', '速克達', 'bws', 'many', 'fiddle', 'saluto'];

                        if (scooterKeywords.some(kw => historyText.includes(kw))) {
                            console.log('Context Override: Detected Scooter keyword in history! Forcing Scooter mode.');
                            result.vehicleType = '摩托車';
                            if (!result.vehicleSubType || result.vehicleSubType === '未知' || !result.vehicleSubType.includes('速克達')) {
                                result.vehicleSubType = (result.vehicleSubType || '') + ' 速克達';
                            }
                        }
                    }
                } catch (e) {
                    console.error('Override error:', e);
                }

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

    // === 策略: 鏈條保養 ===
    else if (productCategory === '鏈條') {
        // 是否明確問「油」
        const isOilQuery = keywords.some(k => k.includes('油') || k.toLowerCase().includes('lube') || k.toLowerCase().includes('spray'));

        if (isOilQuery) {
            // 優先找潤滑油
            queries.push({ field: 'title', value: 'Lube', limit: 10, method: 'contains' });
            queries.push({ field: 'title', value: 'Spray', limit: 10, method: 'contains' });
            queries.push({ field: 'title', value: 'Chain', limit: 20, method: 'contains' });
        } else {
            // 一般鏈條 (可能包含清潔)
            queries.push({ field: 'title', value: 'Chain', limit: 30, method: 'contains' });
            queries.push({ field: 'title', value: '鏈條', limit: 20, method: 'contains' });
        }

        queries.push({ field: 'title', value: 'Ketten', limit: 20, method: 'contains' });
        // 最後才放這個大類別，作為補充
        addQuery('sort', '【摩托車】機車養護', 20);
    }

    // === 策略 E: 通用/清潔 ===
    else if (productCategory === '清潔' || productCategory === '美容') {
        addQuery('sort', '車輛美容', 30);
        addQuery('sort', '【汽車】空調', 10);
    }

    // === 策略 F: 船舶產品 ===
    else if (vehicleType === '船舶' || productCategory === '船舶') {
        addQuery('sort', '船舶', 30);
        addQuery('sort', 'Marine', 30);
        queries.push({ field: 'title', value: 'Marine', limit: 30, method: 'contains' });
        queries.push({ field: 'title', value: 'Boat', limit: 20, method: 'contains' });
    }

    // === 策略 G: 自行車產品 ===
    else if (vehicleType === '自行車' || productCategory === '自行車') {
        addQuery('sort', '自行車', 30);
        addQuery('sort', 'Bike', 30);
        queries.push({ field: 'title', value: 'Bike', limit: 30, method: 'contains' });
        queries.push({ field: 'title', value: 'Bicycle', limit: 20, method: 'contains' });
    }

    // === 策略 Z: 智慧動態搜尋 (Universal Smart Search) ===
    // 自動將 AI 建議的關鍵字轉換為查詢指令，不管用戶輸入什麼都能動態適應
    // 如果前面策略未命中(queries.length=0)，搜尋更多關鍵字(4個)；否則只搜前2個作為補充

    const priorityQueries = []; // 優先級最高的查詢 (會排在結果最前面)
    const maxKeywords = queries.length === 0 ? 4 : 2;
    // 簡單去重
    const uniqueKw = keywords.filter((v, i, a) => a.indexOf(v) === i);

    uniqueKw.slice(0, maxKeywords).forEach(kw => {
        if (!kw || kw.length < 2) return; // 跳過過短關鍵字

        // 如果是摩托車上下文，且不是通用產品 (如洗手膏、清潔類)，才加車型濾鏡
        const isCleaning = productCategory === '清潔' || productCategory === '美容';
        if (isBike && !analysis.isGeneralProduct && !isCleaning) {
            // 摩托車專屬過濾：標題含關鍵字 AND 分類含摩托車
            priorityQueries.push({
                field: 'title', value: kw, limit: 15, method: 'contains',
                andContains: { field: 'sort', value: '摩托車' }
            });

            // 額外嘗試：標題含關鍵字 AND 標題含 Motorbike
            if (/^[a-zA-Z]+$/.test(kw)) {
                priorityQueries.push({
                    field: 'title', value: kw, limit: 10, method: 'contains',
                    andContains: { field: 'title', value: 'Motorbike' }
                });
            }
        } else {
            // 汽車或不分車型
            // === 嚴格類別過濾 (Strict Category Filter) ===
            // 針對容易混淆的類別 (如機油 vs 添加劑)，強制加上類別過濾
            const strictCategories = ['機油', '添加劑', '變速箱', '煞車', '冷卻'];
            if (strictCategories.includes(productCategory) && !analysis.isGeneralProduct) {
                priorityQueries.push({
                    field: 'title', value: kw, limit: 15, method: 'contains',
                    andContains: { field: 'sort', value: productCategory }
                });
            } else {
                priorityQueries.push({ field: 'title', value: kw, limit: 15, method: 'contains' });
            }
        }

        // === 關鍵修正：針對「認證/規格」類關鍵字，追加搜尋 Description 欄位 ===
        // 判斷方式：含該關鍵字混合了數字與字母 (如 948B, 504.00, LL-04) 或是顯著的特殊規格
        const isCertification = /[a-zA-Z].*[0-9]|[0-9].*[a-zA-Z]|[-.]/.test(kw) && kw.length > 3;

        if (isCertification) {
            console.log(`Detected Certification Keyword: ${kw} -> Adding Cert Field Search`);
            // 用戶確認欄位名稱為 'cert'
            priorityQueries.push({ field: 'cert', value: kw, limit: 20, method: 'contains' });
            // 保留 description 作為備用 (有些可能沒填 cert 欄位但寫在描述)
            priorityQueries.push({ field: 'description', value: kw, limit: 10, method: 'contains' });
        }
    });

    // 最後保底
    if (queries.length === 0 && priorityQueries.length === 0 && isBike) {
        addQuery('sort', '摩托車', 20);
    }

    // 將優先查詢放在最前面！
    return [...priorityQueries, ...queries];
}
