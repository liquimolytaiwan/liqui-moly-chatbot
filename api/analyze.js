/**
 * LIQUI MOLY Chatbot - Vercel Serverless Function
 * AI 分析用戶問題 - RAG 重構版本
 * 
 * 使用外部知識庫進行車型識別和規格推理
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
// 載入外部知識庫
// ============================================
let vehicleSpecs = {};
let certifications = {};
let classificationRules = {};
let specialScenarios = {};
let additiveGuide = [];

try {
    const basePath = path.join(process.cwd(), 'data', 'knowledge');
    vehicleSpecs = JSON.parse(fs.readFileSync(path.join(basePath, 'vehicle-specs.json'), 'utf-8'));
    certifications = JSON.parse(fs.readFileSync(path.join(basePath, 'certifications.json'), 'utf-8'));
    // symptoms.json 已合併到 additive-guide.json，不再需要單獨載入
    classificationRules = JSON.parse(fs.readFileSync(path.join(basePath, 'rules', 'classification-rules.json'), 'utf-8'));
    specialScenarios = JSON.parse(fs.readFileSync(path.join(basePath, 'rules', 'special-scenarios.json'), 'utf-8'));
    console.log('[Analyze] Knowledge base loaded successfully');
} catch (e) {
    console.warn('[Analyze] Failed to load knowledge:', e.message);
}

try {
    const guidePath = path.join(process.cwd(), 'data', 'additive-guide.json');
    additiveGuide = JSON.parse(fs.readFileSync(guidePath, 'utf-8'));
    console.log(`[Additive Guide] Loaded ${additiveGuide.length} items`);
} catch (e) {
    console.warn('[Additive Guide] Failed to load:', e.message);
}


// category-mapping.json 已刪除，改用 AI 判斷類別 + Wix 分類欄位搜尋




/**
 * 匹配添加劑指南
 * 直接從 additive-guide.json 匹配（已合併 symptoms.json 功能）
 */
function matchAdditiveGuide(message, vehicleType = null) {
    if (!additiveGuide.length) return [];

    const lowerMsg = message.toLowerCase();
    const matched = [];
    const targetArea = vehicleType === '摩托車' ? '機車' : '汽車';

    // 常見症狀關鍵字對照（從 additive-guide problem 欄位自動擴展）
    const symptomKeywords = {
        '漏油': ['漏油', '滲油', '油封', '止漏'],
        '異音': ['異音', '聲音', '噪音', '達達聲', '敲擊', '哒哒', '噠噠'],
        '吃機油': ['吃機油', '機油消耗', '排藍煙', '冒藍煙', '機油少'],
        '積碳': ['積碳', '除碳', '清潔', '清洗', '沉積物'],
        '怠速': ['怠速', '抖動', '不穩'],
        '啟動': ['啟動', '發動', '難發', '難啟動'],
        '過熱': ['過熱', '水溫高', '水溫過高'],
        '磨損': ['磨損', '保護', '抗磨'],
        '變速箱': ['變速箱', '換檔', '打滑', '頓挫', '入檔'],
        '冷卻': ['冷卻', '水箱', '水溫'],
        'DPF': ['dpf', '再生', '柴油濾芯'],
        '黑煙': ['黑煙', '冒煙', '排煙'],
        '油泥': ['油泥', '乳化', '乳黃色'],
        '缸壓': ['缸壓', '活塞環', '動力流失']
    };

    for (const item of additiveGuide) {
        if (item.area !== targetArea) continue;
        if (!item.hasProduct) continue; // 只匹配有產品的項目

        const problem = (item.problem || '').toLowerCase();
        const explanation = (item.explanation || '').toLowerCase();

        // 方法1：直接匹配 problem 名稱的前幾個字
        if (problem.length > 3 && lowerMsg.includes(problem.substring(0, 4))) {
            matched.push(item);
            continue;
        }

        // 方法2：使用症狀關鍵字對照
        for (const [key, synonyms] of Object.entries(symptomKeywords)) {
            if (synonyms.some(s => lowerMsg.includes(s.toLowerCase()))) {
                if (problem.includes(key) || explanation.includes(key) || synonyms.some(s => problem.includes(s.toLowerCase()))) {
                    if (!matched.find(m => m.problem === item.problem)) {
                        matched.push(item);
                    }
                    break;
                }
            }
        }
    }

    return matched.slice(0, 3);
}


/**
 * 從知識庫查詢車型規格
 */
function lookupVehicleSpec(brand, model, year) {
    if (!vehicleSpecs[brand]) return null;

    for (const [modelName, specs] of Object.entries(vehicleSpecs[brand])) {
        if (modelName.toLowerCase().includes(model.toLowerCase()) ||
            model.toLowerCase().includes(modelName.toLowerCase())) {
            // 找最匹配年份的規格
            for (const spec of specs) {
                if (matchYear(spec.years, year)) {
                    return {
                        brand,
                        model: modelName,
                        ...spec
                    };
                }
            }
            // 返回第一個規格
            return { brand, model: modelName, ...specs[0] };
        }
    }
    return null;
}

/**
 * 匹配年份
 */
function matchYear(yearsStr, year) {
    if (!year) return true;
    const numYear = parseInt(year);
    if (isNaN(numYear)) return true;

    if (yearsStr.includes('+')) {
        const startYear = parseInt(yearsStr.replace('+', ''));
        return numYear >= startYear;
    }
    if (yearsStr.includes('-')) {
        const [start, end] = yearsStr.split('-').map(y => parseInt(y));
        return numYear >= start && numYear <= end;
    }
    return true;
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
 * AI 分析用戶問題 - 精簡版提示詞
 */
async function analyzeUserQuery(apiKey, message, conversationHistory = []) {
    let contextSummary = '';
    if (conversationHistory && conversationHistory.length > 0) {
        const recentHistory = conversationHistory.slice(-4);
        contextSummary = '對話上下文：\n' + recentHistory.map(m =>
            `${m.role === 'user' ? '用戶' : 'AI'}: ${m.content.substring(0, 100)}...`
        ).join('\n') + '\n\n';
    }

    // === 精簡版分析提示詞（約 500 tokens，原版約 2000+ tokens）===
    const analysisPrompt = `你是汽機車專家。分析用戶問題，返回 JSON。

${contextSummary}用戶問題：「${message}」

返回格式：
{
    "isMultiVehicleQuery": false,
    "vehicles": [{
        "vehicleName": "車型名稱",
        "vehicleType": "汽車/摩托車/船舶/自行車",
        "vehicleSubType": "速克達/檔車/未知",
        "isElectricVehicle": false,
        "certifications": ["認證1"],
        "viscosity": "5W-30",
        "searchKeywords": ["關鍵字1", "關鍵字2"]
    }],
    "productCategory": "機油/添加劑/美容/化學品/變速箱/鏈條",
    "isGeneralProduct": false,
    "needsProductRecommendation": true
}

判斷規則：
1. 車型：JET/勁戰/DRG/CBR/Ninja = 摩托車；Altis/CRV/Focus = 汽車
2. Ford EcoBoost (Focus MK4/Kuga MK3, 1.5T/2.0T) → WSS-M2C948-B, 5W-20
3. Ford 一般汽油 → WSS-M2C913-D, 5W-30
4. VAG (VW/Audi/Skoda) 2021+ (Golf 8, Octavia MK4) → VW 508 00 / 509 00 (0W-20)
5. VAG (VW/Audi/Skoda) 2020以前 → VW 504 00 / 507 00 (5W-30)
6. 日韓系 2018+ → API SP, 0W-20 或 5W-30
7. 歐系 → 車廠認證 (BMW LL, MB 229)
9. 特殊認證：用戶輸入純數字如 '508 509'、'504 507' 時，視為車廠認證代碼 (VW 508.00/509.00 等)，放入 searchKeywords 或 certifications
10. searchKeywords：包含黏度、認證代碼、產品系列名

只返回 JSON。`;

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

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                const result = JSON.parse(jsonMatch[0]);

                // === 使用知識庫增強結果 ===
                enhanceWithKnowledgeBase(result, message, conversationHistory);

                // 生成 Wix 查詢
                result.wixQueries = generateWixQueries(result, result.searchKeywords || [], message);

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
 */
function enhanceWithKnowledgeBase(result, message, conversationHistory) {
    const lowerMessage = message.toLowerCase();
    const historyText = conversationHistory.map(m => m.content).join(' ').toLowerCase();
    const combinedText = `${lowerMessage} ${historyText}`;

    // === 1. 車型識別增強 ===
    const motorcycleKeywords = classificationRules.vehicle_types?.motorcycle?.keywords || [];
    const motorcycleModels = classificationRules.vehicle_types?.motorcycle?.specific_models || {};

    for (const kw of motorcycleKeywords) {
        if (combinedText.includes(kw.toLowerCase())) {
            result.vehicleType = '摩托車';
            if (result.vehicles?.[0]) result.vehicles[0].vehicleType = '摩托車';
            break;
        }
    }

    for (const [brand, models] of Object.entries(motorcycleModels)) {
        for (const model of models) {
            if (combinedText.includes(model.toLowerCase().replace(/-/g, ''))) {
                result.vehicleType = '摩托車';
                if (result.vehicles?.[0]) result.vehicles[0].vehicleType = '摩托車';
                break;
            }
        }
    }

    // === 2. 使用知識庫匹配車型規格 ===
    // 從 vehicle-specs.json 動態讀取，不再硬編碼
    // 優先檢查當前訊息，若無則檢查包含歷史的上下文（解決追問時上下文丟失問題）
    let vehicleMatch = findVehicleByMessage(message);
    if (!vehicleMatch) {
        console.log('[Knowledge Base] No direct match in current message, checking context...');
        vehicleMatch = findVehicleByMessage(combinedText);
    }
    if (vehicleMatch) {
        console.log(`[Knowledge Base] Matched: ${vehicleMatch.brand} ${vehicleMatch.model}`);
        const spec = vehicleMatch.spec;

        // 設定搜尋關鍵字
        if (spec.searchKeywords && Array.isArray(spec.searchKeywords)) {
            if (!result.searchKeywords) result.searchKeywords = [];
            result.searchKeywords.unshift(...spec.searchKeywords);
        }

        // 設定認證和黏度
        if (result.vehicles?.[0]) {
            if (spec.certification) {
                result.vehicles[0].certifications = spec.certification;
            }
            if (spec.viscosity) {
                result.vehicles[0].viscosity = spec.viscosity;
            }
        }

        // 記錄匹配結果
        result.matchedVehicle = {
            brand: vehicleMatch.brand,
            model: vehicleMatch.model,
            ...spec // 保存完整規格以供後續搜尋使用
        };
    }

    // === 3. 電動車偵測 ===
    const evKeywords = specialScenarios.electric_vehicle?.pure_ev_motorcycles?.keywords || [];
    const evCarKeywords = specialScenarios.electric_vehicle?.pure_ev_cars?.keywords || [];
    for (const kw of [...evKeywords, ...evCarKeywords]) {
        if (lowerMessage.includes(kw.toLowerCase())) {
            if (result.vehicles?.[0]) result.vehicles[0].isElectricVehicle = true;
            break;
        }
    }

    // === 4. SKU 自動偵測 ===
    // === 4. SKU 自動偵測 ===
    // 修正 Regex: 4位數字必須有 LM 開頭（避免匹配年份 2018），5位數字可單獨存在
    const skuPattern = /(?:LM|lm)[- ]?(\d{4,5})|(?<!\d)(\d{5})(?!\d)/g;
    const skuMatches = [...message.matchAll(skuPattern)];
    for (const match of skuMatches) {
        const skuNum = match[1];
        const fullSku = `LM${skuNum}`;
        if (!result.searchKeywords) result.searchKeywords = [];
        if (!result.searchKeywords.includes(fullSku)) {
            result.searchKeywords.unshift(fullSku, skuNum);
        }
    }

    // === 5. 添加劑指南匹配 ===
    const vehicleType = result.vehicles?.[0]?.vehicleType || result.vehicleType;
    const additiveMatches = matchAdditiveGuide(message, vehicleType);
    if (additiveMatches.length > 0) {
        result.additiveGuideMatch = {
            matched: true,
            items: additiveMatches.map(item => ({
                problem: item.problem,
                explanation: item.explanation,
                solutions: item.solutions,
                hasProduct: item.hasProduct,
                area: item.area
            }))
        };
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
}

/**
 * 生成 Wix 查詢指令（保持原有邏輯）
 */
function generateWixQueries(analysis, keywords, message = '') {
    const queries = [];
    const { vehicleType, productCategory, vehicleSubType } = analysis;
    const vehicles = analysis.vehicles || [];
    const firstVehicle = vehicles[0] || {};

    // 摩托車/速克達關鍵字 (包含 R3, 重機等)
    const bikeKeywords = ['jet', '勁戰', 'drg', 'mmbcu', 'force', 'smax', 'scooter', '4mica', 'krv', 'jbubu', 'tigra', 'many', 'r3', 'mt-', 'ninja', 'cbr', 'gsx', 'cb', 'rebel', 'mt0', 'mt1', 'mt03', 'mt07', 'mt09'];

    const messageLower = message.toLowerCase();

    // Helper
    const addQuery = (field, value, limit = 20, method = 'contains') => {
        queries.push({ field, value, limit, method });
    };

    // === SKU 精確搜尋 ===
    for (const kw of keywords) {

        if (/^LM\d+/i.test(kw)) {
            queries.push({ field: 'partno', value: kw.toUpperCase(), limit: 5, method: 'eq' });
        }
    }

    // === 修正：遍歷所有識別到的車型 (支援多車型同時搜尋) ===
    let hasSpecificMatch = false;
    const explicitCertKeywords = ['VW', 'MB', 'BMW', 'Ford', 'Porsche', 'Volvo', 'JASO', 'ACEA', 'API'];

    // 如果分析結果包含多個車型，逐一生成搜尋指令
    const targetVehicles = (vehicles.length > 0) ? vehicles : [{}]; // 確保至少執行一次

    for (const vehicle of targetVehicles) {
        // 1. 動態規格搜尋 (黏度)
        const viscosity = vehicle.viscosity || analysis.viscosity;
        if (viscosity) {
            queries.push({ field: 'title', value: viscosity, limit: 30, method: 'contains' });
            const viscosityNoHyphen = viscosity.replace('-', '');
            if (viscosityNoHyphen !== viscosity) {
                queries.push({ field: 'title', value: viscosityNoHyphen, limit: 20, method: 'contains' });
            }
        }

        // 2. 動態規格搜尋 (認證)
        const certs = vehicle.certifications || analysis.certifications;
        if (certs && Array.isArray(certs)) {
            for (const cert of certs) {
                queries.push({ field: 'title', value: cert, limit: 20, method: 'contains' });
                queries.push({ field: 'cert', value: cert, limit: 20, method: 'contains' });
            }
        }

        // 檢查是否為精確匹配 (AI 推論出明確車廠認證)
        const hasInferredCert = certs && certs.some(c => explicitCertKeywords.some(k => c.includes(k)));
        if (hasInferredCert) hasSpecificMatch = true;

        // === 若無精確匹配，則為該車型加入「類別搜尋」 (Per-Vehicle Fallback) ===
        // 這樣即使 AI 沒推論出黏度/認證，也能分別為 R3 搜摩托車油、Elantra 搜汽車油
        if (!viscosity && (!certs || certs.length === 0)) {
            // 強制檢測：如果 vehicle.model 包含機車關鍵字，強制轉為摩托車
            let vType = vehicle.vehicleType || vehicleType;
            const modelName = (vehicle.model || '').toLowerCase();
            const isExplicitBike = bikeKeywords.some(k => modelName.includes(k));
            if (isExplicitBike) vType = '摩托車';

            const isVehicleBike = vType === '摩托車';
            const isVehicleScooter = isVehicleBike && (
                (vehicle.vehicleSubType && vehicle.vehicleSubType.includes('速克達')) ||
                keywords.some(k => bikeKeywords.includes(k.toLowerCase()))
            );

            if (isVehicleBike && productCategory === '添加劑') {
                addQuery('sort', '【摩托車】添加劑', 30);
                addQuery('sort', '【摩托車】機車養護', 20);
            } else if (isVehicleBike && productCategory === '機油') {
                queries.push({ field: 'title', value: 'Motorbike', limit: 50, method: 'contains' });
                if (isVehicleScooter) {
                    queries.push({ field: 'title', value: 'Scooter', limit: 30, method: 'contains' });
                }
                addQuery('sort', '【摩托車】機油', 30);
            } else if (!isVehicleBike && productCategory === '添加劑') {
                addQuery('sort', '【汽車】添加劑', 30);
            } else if (!isVehicleBike && productCategory === '機油') {
                addQuery('sort', '【汽車】機油', 50);
            } else if (productCategory === '鏈條') {
                queries.push({ field: 'title', value: 'Chain', limit: 30, method: 'contains' });
                addQuery('sort', '【摩托車】機車養護', 20);
            } else if (productCategory === '清潔' || productCategory === '美容') {
                addQuery('sort', '車輛美容', 30);
            }
        }
    }

    // === 使用知識庫匹配車型 (Legacy Support for single matchedVehicle) ===
    // 若未來 enhanceWithKnowledgeBase 支援多車型，這裡也需修改
    if (analysis.matchedVehicle) {
        const spec = analysis.matchedVehicle;
        console.log(`[Wix Queries] Knowledge Base matched: ${spec.brand} ${spec.model}`);

        if (spec.recommendedSKU) {
            queries.push({ field: 'partno', value: spec.recommendedSKU, limit: 5, method: 'eq' });
            hasSpecificMatch = true; // 知識庫精確匹配
        }

        if (spec.searchKeywords && Array.isArray(spec.searchKeywords)) {
            for (const kw of spec.searchKeywords) {
                if (kw.startsWith('LM')) {
                    queries.push({ field: 'partno', value: kw, limit: 5, method: 'eq' });
                } else if (kw.includes('W-') || kw.includes('W2') || kw.includes('W3') || kw.includes('W4') || kw.includes('W5')) {
                    queries.push({ field: 'title', value: kw, limit: 20, method: 'contains' });
                } else if (/^(\d{3,}|\d+\.\d+|[A-Z]{2,}-\w+)$/.test(kw)) {
                    queries.push({ field: 'cert', value: kw, limit: 15, method: 'contains' });
                } else {
                    queries.push({ field: 'content', value: kw, limit: 15, method: 'contains' });
                }
            }
        }
    }

    // === 類別搜尋 (Generic Fallback) ===
    // 只有在完全沒有任何精確匹配、且上面迴圈也沒產生任何 queries 時才執行 (雖然理論上 per-vehicle fallback 會涵蓋)
    // 這裡保留作為最後防線
    if (queries.length === 0 && !hasSpecificMatch) {
        // Default to Car Oil if really nothing else matches
        if (productCategory === '機油') {
            addQuery('sort', '【汽車】機油', 30);
        }
    }



    // === 關鍵字搜尋 ===
    const uniqueKw = [...new Set(keywords)].slice(0, 4);
    for (const kw of uniqueKw) {
        if (!kw || kw.length < 2) continue;

        // 黏度搜尋
        const viscosityMatch = kw.match(/(\d{1,2}W)([- ]?)(\d{2,3})/i);
        if (viscosityMatch) {
            const [full, prefix, sep, suffix] = viscosityMatch;
            queries.push({ field: 'title', value: `${prefix}${suffix}`, limit: 20, method: 'contains' });
            queries.push({ field: 'title', value: `${prefix}-${suffix}`, limit: 20, method: 'contains' });
        }

        // 標題搜尋
        if (isBike && productCategory === '機油') {
            queries.push({ field: 'title', value: kw, limit: 15, method: 'contains', andContains: { field: 'title', value: 'Motorbike' } });
        } else {
            queries.push({ field: 'title', value: kw, limit: 15, method: 'contains' });

            // [New] 如果關鍵字是純數字 (如 508, 509, 229.5) 或者是常見認證格式
            // 優先搜 "cert" 欄位，其次搜 "content" (詳細說明)
            if (/^(\d{3,}|\d+\.\d+|[A-Z]{2,}-\w+)$/.test(kw)) {
                queries.push({ field: 'cert', value: kw, limit: 15, method: 'contains' });
                queries.push({ field: 'content', value: kw, limit: 15, method: 'contains' });
            }
        }
    }

    // 保底
    if (queries.length === 0 && isBike) {
        addQuery('sort', '摩托車', 20);
    }

    return queries;
}
