/**
 * LIQUI MOLY Chatbot - Vercel Serverless Function
 * AI 分析用戶問題 - 純 RAG 架構版本
 * 
 * 設計原則：AI 為主，知識庫為輔
 * - 移除所有硬編碼關鍵字
 * - Gemini 負責識別車型、判斷類型、推論規格
 * - 從 data/*.json 動態載入知識補充 AI 判斷
 */

const fs = require('fs');
const path = require('path');
const { findVehicleByMessage } = require('./rag/knowledge-retriever');

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
};

// ============================================
// 載入外部知識庫（用於增強 AI 結果）
// ============================================
let vehicleSpecs = {};
let additiveGuide = [];

try {
    const basePath = path.join(process.cwd(), 'data', 'knowledge');
    vehicleSpecs = JSON.parse(fs.readFileSync(path.join(basePath, 'vehicle-specs.json'), 'utf-8'));
    console.log('[Analyze] Vehicle specs loaded');
} catch (e) {
    console.warn('[Analyze] Failed to load vehicle specs:', e.message);
}

try {
    const guidePath = path.join(process.cwd(), 'data', 'additive-guide.json');
    additiveGuide = JSON.parse(fs.readFileSync(guidePath, 'utf-8'));
    console.log(`[Additive Guide] Loaded ${additiveGuide.length} items`);
} catch (e) {
    console.warn('[Additive Guide] Failed to load:', e.message);
}


export default async function handler(req, res) {
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

/**
 * AI 分析用戶問題 - 純 AI 主導版本
 */
async function analyzeUserQuery(apiKey, message, conversationHistory = []) {
    // 準備對話上下文
    let contextSummary = '';
    let symptomContext = '';  // 症狀上下文

    if (conversationHistory && conversationHistory.length > 0) {
        const recentHistory = conversationHistory.slice(-6);  // 增加到 6 條
        contextSummary = '對話上下文：\n' + recentHistory.map(m =>
            `${m.role === 'user' ? '用戶' : 'AI'}: ${m.content.substring(0, 200)}`  // 增加到 200 字
        ).join('\n') + '\n\n';

        // 從對話歷史中提取症狀關鍵字
        const allHistoryText = recentHistory.map(m => m.content).join(' ');
        const symptomKeywords = ['吃機油', '吃雞油', '機油消耗', '怠速抖', '啟動困難', '漏油', '異音', '積碳', '換檔不順', '頓挫'];
        const foundSymptoms = symptomKeywords.filter(s => allHistoryText.includes(s));
        if (foundSymptoms.length > 0) {
            symptomContext = `\n⚠️ 重要：對話中提到的症狀：「${foundSymptoms.join('、')}」，這表示用戶是在詢問添加劑解決方案，productCategory 應該是「添加劑」！\n`;
        }
    }

    // === AI 主導分析提示詞 ===
    const analysisPrompt = `你是汽機車專家。分析用戶問題並返回 JSON。

${contextSummary}${symptomContext}用戶問題：「${message}」

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
    "isGeneralProduct": false,
    "needsProductRecommendation": true
}

車型識別規則（使用你的汽機車專業知識）：

【摩托車識別】
- 品牌：Honda (CBR/CB/Rebel)、Yamaha (R1/R3/R6/MT/YZF)、Kawasaki (Ninja/Z)、Suzuki (GSX/SV)、Ducati、Harley、KTM、Triumph、BMW Motorrad (R1250/S1000)
- 台灣速克達：勁戰/JET/DRG/MMBCU/Force/SMAX/Tigra/KRV/Many/4MICA/Racing
- 特徵：排氣量用 CC 表示（如 650cc、1000cc）通常是摩托車
- 摩托車機油：searchKeywords 必須包含 "Motorbike"
- 速克達機油：searchKeywords 加入 "Scooter"
- 重機/檔車：JASO MA2 認證，10W-40 或 10W-50

【汽車識別 - 使用你的專業知識！】
- **重要**：使用你的汽車專業知識判斷車型！常見汽車品牌和車型你都應該知道
- Hyundai 現代：Elantra、Sonata、Tucson、Santa Fe、i30、Ioniq 都是汽車
- Kia 起亞：Sportage、Sorento、K5、Carnival 都是汽車
- Toyota：Camry、Corolla、RAV4、Yaris 都是汽車
- Honda：Civic、Accord、CR-V、HR-V 都是汽車（注意：CBR/CB 是摩托車）
- Ford：Focus、Kuga、Mondeo、Fiesta 都是汽車
- Nissan：Altima、Sentra、X-Trail、Kicks 都是汽車
- Mazda：Mazda3、Mazda6、CX-5、CX-30 都是汽車
- 歐系：BMW 3/5 Series、M3、Benz C/E/A Class、VW Golf、Audi A4 都是汽車
- **如果是上述任何一個品牌/車型，vehicleType 必須是「汽車」**
- 排量用 L 或 T 表示（如 1.6L、2.0T）通常是汽車
- Ford EcoBoost (Focus MK4/Kuga MK3)：WSS-M2C948-B，5W-20
- Ford 一般汽油：WSS-M2C913-D，5W-30
- VAG 2021+ (Golf 8)：VW 508.00/509.00，0W-20
- VAG 2020以前：VW 504.00/507.00，5W-30
- 日韓系 2018+：API SP，0W-20 或 5W-30
- 歐系：車廠認證（BMW LL、MB 229）

【症狀識別規則 - 重要！】
- 「吃機油」「吃雞油」「機油消耗」= **引擎問題**，不需要問變速箱類型
- 「換檔不順」「換檔頓挫」= **變速箱問題**，需要問變速箱類型（手排/自排/CVT）
- 「怠速抖動」「啟動困難」「積碳」= **引擎問題**
- 「漏油」= 需要確認是哪個部位（引擎/變速箱/方向機）

【searchKeywords 規則】
- 必須包含：黏度（如 5W-30）、認證代碼、產品系列名
- 摩托車機油必須加入 "Motorbike"
- 速克達加入 "Scooter"
- 可包含 SKU（如 LM3840）

只返回 JSON，不要其他文字。`;

    try {
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
            console.error('AI analysis API error:', response.status);
            return null;
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const result = JSON.parse(jsonMatch[0]);

                // === 向後兼容：從 vehicles 陣列提取頂層欄位 ===
                if (result.vehicles && result.vehicles.length > 0) {
                    // 取第一個車型的類型（兼容舊邏輯）
                    result.vehicleType = result.vehicles[0].vehicleType;
                    // 合併所有車型的搜尋關鍵字
                    const allKeywords = [];
                    for (const v of result.vehicles) {
                        if (v.searchKeywords) {
                            allKeywords.push(...v.searchKeywords);
                        }
                    }
                    if (allKeywords.length > 0) {
                        result.searchKeywords = [...new Set(allKeywords)];
                    }
                }

                // === 使用知識庫增強 AI 結果 ===
                enhanceWithKnowledgeBase(result, message, conversationHistory);

                // 生成 Wix 查詢
                result.wixQueries = generateWixQueries(result);

                console.log('[Analyze] AI result:', JSON.stringify(result, null, 2));
                return result;
            } catch (parseError) {
                console.error('JSON parse error:', parseError);
                return null;
            }
        }
        return null;
    } catch (e) {
        console.error('analyzeUserQuery error:', e);
        return null;
    }
}

/**
 * 使用知識庫增強 AI 分析結果
 * 僅作為補充，不覆蓋 AI 判斷
 */
function enhanceWithKnowledgeBase(result, message, conversationHistory) {
    const lowerMessage = message.toLowerCase();
    const historyText = conversationHistory.map(m => m.content).join(' ').toLowerCase();
    const combinedText = `${lowerMessage} ${historyText}`;

    // === 1. 從 vehicle-specs.json 匹配精確車型規格 ===
    let vehicleMatch = findVehicleByMessage(message);
    if (!vehicleMatch) {
        vehicleMatch = findVehicleByMessage(combinedText);
    }

    if (vehicleMatch) {
        console.log(`[Knowledge Base] Matched: ${vehicleMatch.brand} ${vehicleMatch.model}`);
        const spec = vehicleMatch.spec;

        // 補充搜尋關鍵字
        if (spec.searchKeywords && Array.isArray(spec.searchKeywords)) {
            if (!result.searchKeywords) result.searchKeywords = [];
            result.searchKeywords.unshift(...spec.searchKeywords);
        }

        // 補充認證和黏度（如果 AI 沒有推論出）
        if (result.vehicles?.[0]) {
            if (spec.certification && (!result.vehicles[0].certifications || result.vehicles[0].certifications.length === 0)) {
                result.vehicles[0].certifications = spec.certification;
            }
            if (spec.viscosity && !result.vehicles[0].viscosity) {
                result.vehicles[0].viscosity = spec.viscosity;
            }
        }

        result.matchedVehicle = {
            brand: vehicleMatch.brand,
            model: vehicleMatch.model,
            ...spec
        };
    }

    // === 2. 添加劑症狀匹配 ===
    const vehicleType = result.vehicles?.[0]?.vehicleType || result.vehicleType;
    const additiveMatches = matchAdditiveGuide(lowerMessage, vehicleType);
    if (additiveMatches.length > 0) {
        result.additiveGuideMatch = {
            matched: true,
            items: additiveMatches
        };

        // 加入 SKU 到搜尋關鍵字
        if (!result.searchKeywords) result.searchKeywords = [];
        for (const item of additiveMatches) {
            for (const sku of item.solutions) {
                if (!result.searchKeywords.includes(sku)) {
                    result.searchKeywords.push(sku);
                }
            }
        }
        result.productCategory = '添加劑';
    }

    // === 3. SKU 自動偵測 ===
    const skuPattern = /(?:LM|lm)[- ]?(\d{4,5})|(?<!\d)(\d{5})(?!\d)/g;
    const skuMatches = [...message.matchAll(skuPattern)];
    for (const match of skuMatches) {
        const skuNum = match[1] || match[2];
        if (skuNum) {
            const fullSku = `LM${skuNum}`;
            if (!result.searchKeywords) result.searchKeywords = [];
            if (!result.searchKeywords.includes(fullSku)) {
                result.searchKeywords.unshift(fullSku, skuNum);
            }
        }
    }
}

/**
 * 從 additive-guide.json 匹配症狀
 */
function matchAdditiveGuide(message, vehicleType = null) {
    if (!additiveGuide.length) return [];

    // 預設為汽車，除非明確是摩托車
    const targetArea = vehicleType === '摩托車' ? '機車' : '汽車';
    const matched = [];
    const lowerMessage = message.toLowerCase();

    // 常見症狀關鍵字和變體（包含打字錯誤）
    const symptomAliases = {
        '吃機油': ['吃機油', '吃雞油', '機油消耗', '耗機油', '燒機油'],
        '怠速抖動': ['怠速抖', '抖動', '發抖', '震動'],
        '啟動困難': ['啟動困難', '難發動', '發不動', '不好發'],
        '漏油': ['漏油', '滲油', '油封'],
        '異音': ['異音', '噪音', '達達聲', '敲擊聲'],
        '積碳': ['積碳', '積炭'],
        '缸壓不足': ['缸壓', '壓縮']
    };

    for (const item of additiveGuide) {
        if (item.area !== targetArea) continue;
        if (!item.hasProduct) continue;

        const problem = (item.problem || '').toLowerCase();
        const explanation = (item.explanation || '').toLowerCase();

        // 檢查症狀別名是否匹配
        let isMatched = false;
        for (const [symptom, aliases] of Object.entries(symptomAliases)) {
            if (problem.includes(symptom.toLowerCase())) {
                // 檢查用戶訊息是否包含任何別名
                if (aliases.some(alias => lowerMessage.includes(alias.toLowerCase()))) {
                    isMatched = true;
                    break;
                }
            }
        }

        // 直接關鍵字匹配（取問題的前6個字）
        if (!isMatched && problem.length >= 4) {
            const keywords = problem.split(/[導致,，()（）]/).filter(k => k.length >= 2);
            isMatched = keywords.some(kw => lowerMessage.includes(kw.trim()));
        }

        if (isMatched) {
            matched.push({
                problem: item.problem,
                explanation: item.explanation,
                solutions: item.solutions
            });
        }
    }

    return matched.slice(0, 3);
}

/**
 * 根據 AI 分析結果生成 Wix 查詢
 * 簡化版 - 只做 AI 結果到查詢的映射
 */
function generateWixQueries(analysis) {
    const queries = [];
    const vehicles = analysis.vehicles || [];
    const productCategory = analysis.productCategory;

    for (const vehicle of vehicles) {
        const isMotorcycle = vehicle.vehicleType === '摩托車';
        const isScooter = vehicle.vehicleSubType === '速克達';

        // 1. 黏度搜尋
        if (vehicle.viscosity) {
            queries.push({ field: 'title', value: vehicle.viscosity, limit: 30, method: 'contains' });
            // 無連字號版本
            const viscosityNoHyphen = vehicle.viscosity.replace('-', '');
            if (viscosityNoHyphen !== vehicle.viscosity) {
                queries.push({ field: 'title', value: viscosityNoHyphen, limit: 20, method: 'contains' });
            }
        }

        // 2. 認證搜尋
        const certs = vehicle.certifications || [];
        for (const cert of certs) {
            queries.push({ field: 'title', value: cert, limit: 20, method: 'contains' });
            queries.push({ field: 'cert', value: cert, limit: 20, method: 'contains' });
            // 去空格版本
            const certNoSpace = cert.replace(/\s+/g, '');
            if (certNoSpace !== cert) {
                queries.push({ field: 'cert', value: certNoSpace, limit: 20, method: 'contains' });
            }
        }

        // 3. AI 指定的搜尋關鍵字
        const keywords = vehicle.searchKeywords || [];
        for (const kw of keywords) {
            if (kw.startsWith('LM')) {
                queries.push({ field: 'partno', value: kw.toUpperCase(), limit: 5, method: 'eq' });
            } else {
                queries.push({ field: 'title', value: kw, limit: 20, method: 'contains' });
            }
        }

        // 4. 摩托車強制加入 Motorbike 搜尋
        if (isMotorcycle && productCategory === '機油') {
            const hasMotorbikeKw = keywords.some(k => k.toLowerCase().includes('motorbike'));
            if (!hasMotorbikeKw) {
                queries.push({ field: 'title', value: 'Motorbike', limit: 50, method: 'contains' });
            }
            if (isScooter) {
                queries.push({ field: 'title', value: 'Scooter', limit: 30, method: 'contains' });
            }
            // 使用 sort 分類搜尋
            queries.push({ field: 'sort', value: '【摩托車】機油', limit: 30, method: 'contains' });
        }

        // 5. 汽車機油分類搜尋
        if (!isMotorcycle && productCategory === '機油') {
            queries.push({ field: 'sort', value: '【汽車】機油', limit: 50, method: 'contains' });
        }

        // 6. 添加劑分類搜尋
        if (productCategory === '添加劑') {
            const sortPrefix = isMotorcycle ? '【摩托車】' : '【汽車】';
            queries.push({ field: 'sort', value: `${sortPrefix}添加劑`, limit: 30, method: 'contains' });
        }
    }

    // 7. 全域搜尋關鍵字（從知識庫增強來的）
    const globalKeywords = analysis.searchKeywords || [];
    for (const kw of globalKeywords) {
        if (kw.startsWith('LM')) {
            queries.push({ field: 'partno', value: kw.toUpperCase(), limit: 5, method: 'eq' });
        }
    }

    // 去重
    const uniqueQueries = [];
    const seen = new Set();
    for (const q of queries) {
        const key = `${q.field}:${q.value}:${q.method}`;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueQueries.push(q);
        }
    }

    return uniqueQueries;
}
