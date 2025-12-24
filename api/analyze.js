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
let searchReference = {};
let aiAnalysisRules = {};

try {
    const basePath = path.join(process.cwd(), 'data', 'knowledge');
    vehicleSpecs = JSON.parse(fs.readFileSync(path.join(basePath, 'vehicle-specs.json'), 'utf-8'));
    console.log('[Analyze] Vehicle specs loaded');
} catch (e) {
    console.warn('[Analyze] Failed to load vehicle specs:', e.message);
}

try {
    const guidePath = path.join(process.cwd(), 'data', 'knowledge', 'additive-guide.json');
    additiveGuide = JSON.parse(fs.readFileSync(guidePath, 'utf-8'));
    console.log(`[Additive Guide] Loaded ${additiveGuide.length} items`);
} catch (e) {
    console.warn('[Additive Guide] Failed to load:', e.message);
}

try {
    const refPath = path.join(process.cwd(), 'data', 'knowledge', 'search-reference.json');
    searchReference = JSON.parse(fs.readFileSync(refPath, 'utf-8'));
    console.log('[Analyze] Search reference loaded');
} catch (e) {
    console.warn('[Analyze] Failed to load search reference:', e.message);
}

try {
    const rulesPath = path.join(process.cwd(), 'data', 'knowledge', 'ai-analysis-rules.json');
    aiAnalysisRules = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    console.log('[Analyze] AI analysis rules loaded');
} catch (e) {
    console.warn('[Analyze] Failed to load AI analysis rules:', e.message);
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

        // 從對話歷史構建完整上下文（不再硬編碼症狀）
        const allHistoryText = recentHistory.map(m => m.content).join(' ');
        // 如果對話中有提到症狀相關問題，提醒 AI 這是添加劑諮詢
        if (allHistoryText.match(/怎麼辦|問題|症狀|異常|異音|過熱|抖動|漏油|吃油/)) {
            symptomContext = `\n⚠️ 重要：對話中可能涉及車輛症狀問題，請仔細判斷是否需要推薦添加劑而非機油。\n`;
        }
    }

    // === 從 additive-guide.json 動態生成症狀列表 ===
    let symptomGuide = '';
    if (additiveGuide.length > 0) {
        // 提取汽車引擎問題的症狀和解決方案
        const engineProblems = additiveGuide
            .filter(item => item.area === '汽車' && item.hasProduct && item.sort === '引擎疑難雜症')
            .map(item => `- ${item.problem}: ${item.solutions.join(', ')}`)
            .slice(0, 20);  // 取前 20 個

        const transmissionProblems = additiveGuide
            .filter(item => item.area === '汽車' && item.hasProduct && item.sort?.includes('變速箱'))
            .map(item => `- ${item.problem}: ${item.solutions.join(', ')}`)
            .slice(0, 10);

        symptomGuide = `
【症狀與添加劑產品對照表 - 從知識庫載入】
⚠️ 如果用戶描述的問題與以下症狀相似，productCategory 應設為「添加劑」，並將對應 SKU 加入 searchKeywords！

**引擎相關症狀（不需要問變速箱類型）：**
${engineProblems.join('\n')}

**變速箱相關症狀（需要問變速箱類型）：**
${transmissionProblems.join('\n')}

**判斷規則：**
- 如果用戶問的是「引擎相關症狀」（如：吃機油、過熱、啟動困難、異音、積碳），productCategory = 添加劑，不需要問變速箱
- 如果用戶問的是「變速箱相關症狀」（如：換檔頓挫、換檔不順），才需要問變速箱類型
- 如果對話中已經提供了車型資訊，不要重複詢問！直接從上下文獲取
`;
    }

    // === 生成精簡參照表 prompt ===
    const quickRefPrompt = searchReference.viscosity_by_vehicle ? `
【⭐ LLM 內建知識優先 - 請用你的專業知識判斷！】
你必須根據汽車專業知識推論認證和黏度，以下僅供參考：
- 黏度參考: ${JSON.stringify(searchReference.viscosity_by_vehicle)}
- 認證參考: ${JSON.stringify(searchReference.cert_by_vehicle)}
- 症狀對應 SKU: ${JSON.stringify(searchReference.symptom_to_sku)}
` : '';

    // === AI 主導分析提示詞（從知識庫動態生成） ===
    const dynamicRules = buildAnalysisPromptRules();
    const responseFormat = aiAnalysisRules?.json_response_format
        ? JSON.stringify(aiAnalysisRules.json_response_format, null, 4)
        : `{
    "isMultiVehicleQuery": false,
    "vehicles": [{
        "vehicleName": "完整車型名稱",
        "vehicleType": "汽車/摩托車/船舶/自行車",
        "vehicleSubType": "速克達/檔車/重機/仿賽/街車/巡航/未知",
        "fuelType": "汽油/柴油/油電/純電/2T混合油",
        "strokeType": "4T/2T/電動",
        "isElectricVehicle": false,
        "certifications": ["認證代碼"],
        "viscosity": "建議黏度",
        "searchKeywords": ["搜尋關鍵字"]
    }],
    "productCategory": "機油/添加劑/美容/化學品/變速箱/鏈條",
    "usageScenario": "一般通勤/跑山/下賽道/長途旅行/重載",
    "recommendSynthetic": "full/semi/mineral/any",
    "symptomMatched": null,
    "symptomSeverity": "mild/moderate/severe/none",
    "isGeneralProduct": false,
    "needsProductRecommendation": true
}`;

    const analysisPrompt = `你是汽機車專家。分析用戶問題並返回 JSON。

${contextSummary}${symptomContext}用戶問題：「${message}」
${quickRefPrompt}
${symptomGuide}
返回格式：
${responseFormat}
${dynamicRules}
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

        // 1. 黏度搜尋 - 只在機油推薦時執行
        if (vehicle.viscosity && productCategory === '機油') {
            // word2 是黏度專用欄位，優先搜尋
            queries.push({ field: 'word2', value: vehicle.viscosity, limit: 30, method: 'contains' });
            // 同時也搜尋 title 以增加命中率
            queries.push({ field: 'title', value: vehicle.viscosity, limit: 20, method: 'contains' });
            // 無連字號版本（如 5W30）
            const viscosityNoHyphen = vehicle.viscosity.replace('-', '');
            if (viscosityNoHyphen !== vehicle.viscosity) {
                queries.push({ field: 'word2', value: viscosityNoHyphen, limit: 20, method: 'contains' });
            }
        }

        // 2. 認證搜尋 - 只在機油推薦時執行
        if (productCategory === '機油') {
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

/**
 * 從知識庫動態生成 AI 分析規則提示詞
 * @returns {string} 分析規則提示詞
 */
function buildAnalysisPromptRules() {
    const rules = aiAnalysisRules;
    if (!rules || Object.keys(rules).length === 0) {
        // 如果知識庫未載入，返回基本規則
        return `
【速克達/檔車識別】
- 速克達：勁戰/JET/DRG/曼巴/Force/SMAX/Tigra/KRV/Many
- 速克達 → JASO MB 認證
- 檔車/重機 → JASO MA2 認證
`;
    }

    let promptRules = '';

    // 對話記憶規則 - 從知識庫讀取
    if (rules.conversation_memory_rules) {
        const memRules = rules.conversation_memory_rules;
        promptRules += `
【⚠️ 最重要：對話記憶 - 嚴格遵守！】
${memRules.rules.map(r => `- ${r}`).join('\n')}`;

        // 添加劑繼承規則
        if (memRules.additive_inheritance) {
            const ai = memRules.additive_inheritance;
            promptRules += `
- ⚠️ ${ai.vehicle_inheritance}
- ⚠️ ${ai.no_repeat_question}
- ⚠️ ${ai.motorcycle_additive}`;
        }

        // 使用場景繼承規則
        if (memRules.scenario_inheritance) {
            const si = memRules.scenario_inheritance;
            promptRules += `
- ⚠️ ⭐ ${si.rule}`;
            if (si.mapping) {
                for (const [scenario, recommendation] of Object.entries(si.mapping)) {
                    promptRules += `
  - ${scenario} → ${recommendation}`;
                }
            }
        }
        promptRules += '\n';
    }

    // 速克達識別
    if (rules.scooter_identification) {
        const scooter = rules.scooter_identification;
        promptRules += `
【⚠️ 台灣速克達識別 - 超級重要！】
- 速克達車款：${scooter.models.slice(0, 15).join('/')}
- 速克達特徵：${scooter.characteristics.transmission}、${scooter.characteristics.clutch}
- 速克達 → vehicleSubType = "${scooter.characteristics.vehicleSubType}"，strokeType = "${scooter.characteristics.strokeType}"
`;
    }

    // JASO 規則
    if (rules.jaso_rules) {
        const jaso = rules.jaso_rules;
        promptRules += `
【⚠️ JASO 認證規則 - 非常重要！】
- **速克達(${jaso.scooter.reason}) → ${jaso.scooter.certification} 認證**
- **檔車/重機(${jaso.motorcycle.reason}) → ${jaso.motorcycle.certification} 認證**
- 搜尋關鍵字：速克達要加 "${jaso.scooter.searchKeywords.join('" 或 "')}"，檔車要加 "${jaso.motorcycle.searchKeywords.join('" 或 "')}"
`;
    }

    // 摩托車識別
    if (rules.motorcycle_identification) {
        const moto = rules.motorcycle_identification;
        promptRules += `
【摩托車識別】
- 重機/檔車品牌：${moto.brands.slice(0, 8).join('、')}
- 重機/檔車系列：${moto.series.slice(0, 10).join('/')}
- 摩托車機油：searchKeywords 必須包含 "Motorbike"
`;
    }

    // 燃料類型判斷
    if (rules.fuel_keywords) {
        const fuel = rules.fuel_keywords;
        promptRules += `
【汽車識別】
- 使用你的汽車專業知識判斷車型、品牌、燃料類型
- 柴油車關鍵字：${fuel.diesel.join('、')}
- 油電車關鍵字：${fuel.hybrid.join('、')}
- 如果對話中已有車型，不要再問「是汽車還是機車」！

【燃料類型判斷】
- 汽車：汽油/柴油/油電/純電（根據車型專業知識判斷）
- 機車：汽油(4T)/2T混合油/純電
`;
    }

    // 使用場景判斷
    if (rules.usage_scenario_mapping) {
        const scenarios = rules.usage_scenario_mapping;
        promptRules += `
【使用場景判斷】`;
        for (const [scenario, config] of Object.entries(scenarios)) {
            if (config.keywords && config.keywords.length > 0) {
                promptRules += `
- ${config.keywords.join('、')} → usageScenario = "${scenario}"`;
            } else if (config.default) {
                promptRules += `
- 其他/未提及 → usageScenario = "${scenario}"`;
            }
        }
        promptRules += `

【機油基礎油推薦規則】
- 下賽道/跑山/激烈操駕 → recommendSynthetic = "full"（全合成優先）
- 長途旅行/高里程 → recommendSynthetic = "full" 或 "semi"
- 一般通勤 → recommendSynthetic = "any"
`;
    }

    // 症狀嚴重度判斷
    if (rules.symptom_severity) {
        const severity = rules.symptom_severity;
        promptRules += `
【症狀嚴重度判斷】`;
        for (const [level, config] of Object.entries(severity)) {
            promptRules += `
- ${config.description}：${config.symptoms.join('、')} → symptomSeverity = "${level}"`;
        }
        promptRules += '\n';
    }

    // 添加劑推薦規則
    if (rules.additive_recommendation_rules) {
        promptRules += `
【添加劑推薦規則】
- 柴油車 → 優先推薦 Diesel 系列添加劑
- 激烈操駕/跑山/賽道 → 推薦 Engine Flush 清積碳、MoS2 抗磨損
- 長途旅行 → 推薦 Oil Additive 機油添加劑保護引擎
- 高里程/老車 → 推薦 Oil Leak Stop 止漏、Valve Clean 汽門清潔
- 嚴重症狀 → 優先推薦 Pro-Line 系列（強效）
`;
    }

    // searchKeywords 規則
    if (rules.search_keyword_rules) {
        const skRules = rules.search_keyword_rules;
        promptRules += `
【searchKeywords 規則 - 非常重要！】
⚠️ 摩托車/速克達機油：searchKeywords 第一個必須是 "${skRules.motorcycle.required[0]}"
⚠️ 速克達：加入 "${skRules.motorcycle.scooter_additional.join('" 或 "')}"
⚠️ 檔車/重機：加入 "${skRules.motorcycle.manual_additional.join('" 或 "')}"
`;
        if (skRules.examples && skRules.examples.length > 0) {
            promptRules += `
範例：`;
            for (const ex of skRules.examples.slice(0, 3)) {
                promptRules += `
- ${ex.scenario} → searchKeywords: ${JSON.stringify(ex.keywords)}`;
            }
        }
        promptRules += `

如果是添加劑：必須包含匹配到的症狀對應 SKU
如果是柴油車添加劑：加入 "Diesel" 關鍵字
如果症狀嚴重：加入 "Pro-Line" 關鍵字
`;
    }

    return promptRules;
}

export { analyzeUserQuery };
