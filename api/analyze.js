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
let symptoms = {};
let classificationRules = {};
let specialScenarios = {};
let additiveGuide = [];

try {
    const basePath = path.join(process.cwd(), 'data', 'knowledge');
    vehicleSpecs = JSON.parse(fs.readFileSync(path.join(basePath, 'vehicle-specs.json'), 'utf-8'));
    certifications = JSON.parse(fs.readFileSync(path.join(basePath, 'certifications.json'), 'utf-8'));
    symptoms = JSON.parse(fs.readFileSync(path.join(basePath, 'symptoms.json'), 'utf-8'));
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

/**
 * 匹配添加劑指南
 */
function matchAdditiveGuide(message, vehicleType = null) {
    if (!additiveGuide.length) return [];

    const lowerMsg = message.toLowerCase();
    const matched = [];
    const targetArea = vehicleType === '摩托車' ? '機車' : '汽車';

    const keywordMap = {
        '漏油': ['漏油', '滲油', '油封', '止漏'],
        '異音': ['異音', '聲音', '噪音', '達達聲', '敲擊'],
        '吃機油': ['吃機油', '機油消耗', '排藍煙', '冒藍煙'],
        '積碳': ['積碳', '除碳', '清潔', '清洗'],
        '怠速': ['怠速', '抖動', '不穩'],
        '啟動': ['啟動', '發動', '難發'],
        '過熱': ['過熱', '水溫高', '水溫過高'],
        '磨損': ['磨損', '保護', '抗磨'],
        '變速箱': ['變速箱', '換檔', '打滑', '頓挫'],
        '冷卻': ['冷卻', '水箱', '水溫'],
        'DPF': ['dpf', '再生', '柴油濾芯'],
        '黑煙': ['黑煙', '冒煙', '排煙'],
    };

    for (const item of additiveGuide) {
        if (item.area !== targetArea) continue;

        const problem = (item.problem || '').toLowerCase();
        const explanation = (item.explanation || '').toLowerCase();

        if (lowerMsg.includes(problem.substring(0, 4))) {
            matched.push(item);
            continue;
        }

        for (const [key, synonyms] of Object.entries(keywordMap)) {
            if (synonyms.some(s => lowerMsg.includes(s))) {
                if (problem.includes(key) || explanation.includes(key) || synonyms.some(s => problem.includes(s))) {
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
4. 日韓系 2018+ → API SP, 0W-20 或 5W-30
5. 歐系 → 車廠認證 (BMW LL, MB 229)
6. searchKeywords：包含黏度、認證、產品系列名

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
    const vehicleMatch = findVehicleByMessage(message);
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
            certification: spec.certification,
            viscosity: spec.viscosity,
            recommendedSKU: spec.recommendedSKU,
            note: spec.note
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
    const skuPattern = /(?:LM|lm)?[- ]?(\d{4,5})/g;
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

    const isBike = vehicleType === '摩托車' || firstVehicle.vehicleType === '摩托車';
    const isScooter = isBike && (
        (vehicleSubType && vehicleSubType.includes('速克達')) ||
        keywords.some(k => ['jet', '勁戰', 'drg', 'mmbcu', 'force', 'smax', 'scooter'].includes(k.toLowerCase()))
    );

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

    // === 動態規格搜尋 ===
    const viscosity = firstVehicle.viscosity || analysis.viscosity;
    const certs = firstVehicle.certifications || analysis.certifications;

    if (viscosity) {
        queries.push({ field: 'title', value: viscosity, limit: 30, method: 'contains' });
        const viscosityNoHyphen = viscosity.replace('-', '');
        if (viscosityNoHyphen !== viscosity) {
            queries.push({ field: 'title', value: viscosityNoHyphen, limit: 20, method: 'contains' });
        }
    }

    if (certs && Array.isArray(certs)) {
        for (const cert of certs) {
            queries.push({ field: 'title', value: cert, limit: 20, method: 'contains' });
            queries.push({ field: 'description', value: cert, limit: 20, method: 'contains' });
        }
    }

    // === 使用知識庫匹配車型並生成搜尋指令 ===
    const vehicleMatch = findVehicleByMessage(message);
    if (vehicleMatch && vehicleMatch.spec) {
        const spec = vehicleMatch.spec;
        console.log(`[Wix Queries] Knowledge Base matched: ${vehicleMatch.brand} ${vehicleMatch.model}`);

        // 如果有推薦 SKU，優先搜尋
        if (spec.recommendedSKU) {
            queries.push({ field: 'partno', value: spec.recommendedSKU, limit: 5, method: 'eq' });
        }

        // 使用 searchKeywords 生成搜尋
        if (spec.searchKeywords && Array.isArray(spec.searchKeywords)) {
            for (const kw of spec.searchKeywords) {
                if (kw.startsWith('LM')) {
                    queries.push({ field: 'partno', value: kw, limit: 5, method: 'eq' });
                } else if (kw.includes('W-') || kw.includes('W2') || kw.includes('W3') || kw.includes('W4') || kw.includes('W5')) {
                    queries.push({ field: 'title', value: kw, limit: 20, method: 'contains' });
                } else {
                    queries.push({ field: 'description', value: kw, limit: 15, method: 'contains' });
                }
            }
        }
    }

    // === Harley 專用搜尋 ===
    const harleyKeywords = ['harley', 'sportster', 'softail', 'iron', 'street glide', 'fat boy', '哈雷'];
    if (harleyKeywords.some(k => messageLower.includes(k))) {
        queries.push({ field: 'title', value: 'HD', limit: 30, method: 'contains' });
        queries.push({ field: 'title', value: '20W-50', limit: 30, method: 'contains' });
    }

    // === 類別搜尋 ===
    if (isBike && productCategory === '添加劑') {
        addQuery('sort', '【摩托車】添加劑', 30);
        addQuery('sort', '【摩托車】機車養護', 20);
    } else if (isBike && productCategory === '機油') {
        queries.push({ field: 'title', value: 'Motorbike', limit: 50, method: 'contains' });
        if (isScooter) {
            queries.push({ field: 'title', value: 'Scooter', limit: 30, method: 'contains' });
        }
        addQuery('sort', '【摩托車】機油', 30);
    } else if (!isBike && productCategory === '添加劑') {
        addQuery('sort', '【汽車】添加劑', 30);
    } else if (!isBike && productCategory === '機油') {
        addQuery('sort', '【汽車】機油', 50);
    } else if (productCategory === '鏈條') {
        queries.push({ field: 'title', value: 'Chain', limit: 30, method: 'contains' });
        addQuery('sort', '【摩托車】機車養護', 20);
    } else if (productCategory === '清潔' || productCategory === '美容') {
        addQuery('sort', '車輛美容', 30);
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
        }
    }

    // 保底
    if (queries.length === 0 && isBike) {
        addQuery('sort', '摩托車', 20);
    }

    return queries;
}
