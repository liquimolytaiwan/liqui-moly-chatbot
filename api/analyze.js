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
const { findVehicleByMessage } = require('./knowledge-retriever');

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

        const otherProblems = additiveGuide
            .filter(item => item.hasProduct && (item.sort === '其他疑難雜症' || item.type === '通用'))
            .map(item => `- ${item.problem}: ${item.solutions.join(', ')}`);

        symptomGuide = `
【症狀與添加劑產品對照表 - 從知識庫載入】
⚠️ 如果用戶描述的問題與以下症狀相似，productCategory 應設為「添加劑」，並將對應 SKU 加入 searchKeywords！

**引擎相關症狀（不需要問變速箱類型）：**
${engineProblems.join('\n')}

**變速箱相關症狀（需要問變速箱類型）：**
${transmissionProblems.join('\n')}

**其他疑難雜症（通用問題）：**
${otherProblems.join('\n')}

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
        "vehicleName": null,
        "vehicleType": null,
        "vehicleSubType": null,
        "fuelType": null,
        "strokeType": null,
        "isElectricVehicle": false,
        "certifications": ["用戶指定的認證"],
        "viscosity": "用戶指定的黏度",
        "searchKeywords": ["搜尋關鍵字"]
    }],
    "productCategory": "機油/添加劑/變速箱油/煞車系統/冷卻系統/空調系統/化學品/美容/香氛/自行車/船舶/商用車/PRO-LINE/其他",
    "usageScenario": null,
    "recommendSynthetic": "any",
    "symptomMatched": null,
    "symptomSeverity": "none",
    "isGeneralProduct": false,
    "needsProductRecommendation": true
}`;

    const analysisPrompt = `你是汽機車專家。分析用戶問題並返回 JSON。

⚠️ **重要規則：禁止預設車型！**
- 如果用戶**只問認證**（如「有 GF-6A 機油嗎」）→ vehicleType = null，直接搜尋認證
- 如果用戶**只問黏度**（如「有 5W-30 嗎」）→ vehicleType = null，直接搜尋黏度
- 如果用戶**只問產品編號**（如「LM2500」）→ vehicleType = null，直接搜尋產品
- **只有當用戶明確提到車型時**（如「Toyota」「我的機車」），才填入 vehicleType

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

                // === 偵測認證搜尋請求 ===
                // 檢查用戶訊息是否明確詢問特定認證
                const certPatterns = [
                    /(?:ILSAC\s*)?GF[-\s]?(\d+[AB]?)/i,
                    /API\s*(S[A-Z]|C[A-Z])/i,
                    /JASO\s*(MA2?|MB)/i,
                    /ACEA\s*([A-Z]\d)/i
                ];

                let detectedCert = null;
                for (const pattern of certPatterns) {
                    const match = message.match(pattern);
                    if (match) {
                        // 標準化認證名稱
                        if (pattern.source.includes('GF')) {
                            detectedCert = `GF-${match[1].toUpperCase()}`;
                        } else if (pattern.source.includes('API')) {
                            detectedCert = `API ${match[1].toUpperCase()}`;
                        } else if (pattern.source.includes('JASO')) {
                            detectedCert = `JASO ${match[1].toUpperCase()}`;
                        } else if (pattern.source.includes('ACEA')) {
                            detectedCert = `ACEA ${match[1].toUpperCase()}`;
                        }
                        break;
                    }
                }

                // 檢查是否有明確的黏度追問（從對話繼承認證）
                const viscosityPattern = /(\d+[Ww][-]?\d+)/;
                const viscosityMatch = message.match(viscosityPattern);
                let detectedViscosity = viscosityMatch ? viscosityMatch[1].toUpperCase() : null;

                // 若用戶明確詢問認證，生成 certificationSearch
                if (detectedCert) {
                    result.certificationSearch = {
                        requestedCert: detectedCert,
                        viscosity: detectedViscosity || result.vehicles?.[0]?.viscosity || null
                    };
                    console.log('[Analyze] Certification search detected:', result.certificationSearch);
                }
                // 若只有黏度追問且對話中有認證歷史，繼承認證
                else if (detectedViscosity && conversationHistory.length > 0) {
                    const historyText = conversationHistory.map(m => m.content).join(' ');
                    for (const pattern of certPatterns) {
                        const match = historyText.match(pattern);
                        if (match) {
                            if (pattern.source.includes('GF')) {
                                detectedCert = `GF-${match[1].toUpperCase()}`;
                            } else if (pattern.source.includes('API')) {
                                detectedCert = `API ${match[1].toUpperCase()}`;
                            } else if (pattern.source.includes('JASO')) {
                                detectedCert = `JASO ${match[1].toUpperCase()}`;
                            }
                            if (detectedCert) {
                                result.certificationSearch = {
                                    requestedCert: detectedCert,
                                    viscosity: detectedViscosity
                                };
                                console.log('[Analyze] Inherited certification from history:', result.certificationSearch);
                                break;
                            }
                        }
                    }
                }

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

        // ⚠️ 關鍵修復：如果 AI 沒有識別出車型，但對話歷史中有，創建車型物件
        if (!result.vehicles || result.vehicles.length === 0) {
            console.log(`[Knowledge Base] Creating vehicle from history: ${vehicleMatch.brand} ${vehicleMatch.model}`);
            result.vehicles = [{
                vehicleName: `${vehicleMatch.brand} ${vehicleMatch.model}`,
                vehicleType: spec.type?.includes('速克達') || spec.type?.includes('檔車') ? '摩托車' : '汽車',
                vehicleSubType: spec.type || '未知',
                fuelType: spec.fuel || '汽油',
                strokeType: spec.type?.includes('2T') ? '2T' : '4T',
                isElectricVehicle: false,
                certifications: spec.certification || [],
                viscosity: spec.viscosity || '',
                searchKeywords: spec.searchKeywords || []
            }];
            result.vehicleType = result.vehicles[0].vehicleType;
        } else {
            // 補充認證和黏度（如果 AI 沒有推論出）
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

    // === 4. 添加劑子類別識別（機油添加劑 vs 汽油添加劑）===
    if (result.productCategory === '添加劑' || lowerMessage.includes('添加劑')) {
        const subtypeRules = aiAnalysisRules?.conversation_memory_rules?.additive_subtype_rules;
        if (subtypeRules) {
            const oilAdditiveKws = subtypeRules.oil_additive_keywords || [];
            const fuelAdditiveKws = subtypeRules.fuel_additive_keywords || [];

            // 檢查用戶訊息是否明確提到機油添加劑或汽油添加劑
            const isOilAdditive = oilAdditiveKws.some(kw =>
                lowerMessage.includes(kw.toLowerCase())
            );
            const isFuelAdditive = fuelAdditiveKws.some(kw =>
                lowerMessage.includes(kw.toLowerCase())
            );

            if (isOilAdditive && !isFuelAdditive) {
                result.additiveSubtype = '機油添加劑';
                result.productCategory = '添加劑';
                console.log('[Additive] Detected subtype: 機油添加劑');

                // 根據車型推薦產品
                const vehicleType = result.vehicles?.[0]?.vehicleType;
                const mapping = subtypeRules.mapping?.['機油添加劑'];
                if (mapping) {
                    const products = vehicleType === '摩托車'
                        ? mapping.motorcycle_products
                        : mapping.car_products;
                    if (products && products.length > 0) {
                        if (!result.searchKeywords) result.searchKeywords = [];
                        // 將建議的 SKU 加入搜尋關鍵字
                        for (const sku of products) {
                            if (!result.searchKeywords.includes(sku)) {
                                result.searchKeywords.push(sku);
                            }
                        }
                    }
                    // 補充搜尋關鍵字
                    for (const kw of mapping.searchKeywords || []) {
                        if (!result.searchKeywords.includes(kw)) {
                            result.searchKeywords.push(kw);
                        }
                    }
                }
            } else if (isFuelAdditive && !isOilAdditive) {
                result.additiveSubtype = '汽油添加劑';
                result.productCategory = '添加劑';
                console.log('[Additive] Detected subtype: 汽油添加劑');

                const vehicleType = result.vehicles?.[0]?.vehicleType;
                const mapping = subtypeRules.mapping?.['汽油添加劑'];
                if (mapping) {
                    const products = vehicleType === '摩托車'
                        ? mapping.motorcycle_products
                        : mapping.car_products;
                    if (products && products.length > 0) {
                        if (!result.searchKeywords) result.searchKeywords = [];
                        for (const sku of products) {
                            if (!result.searchKeywords.includes(sku)) {
                                result.searchKeywords.push(sku);
                            }
                        }
                    }
                    for (const kw of mapping.searchKeywords || []) {
                        if (!result.searchKeywords.includes(kw)) {
                            result.searchKeywords.push(kw);
                        }
                    }
                }
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
        '缸壓不足': ['缸壓', '壓縮'],
        '老鼠': ['老鼠', '貓', '小動物', '咬破', '躲藏']
    };

    for (const item of additiveGuide) {
        // 通用問題（如防鼠）不分汽機車，或是符合目標區域
        if (item.type !== '通用' && item.area !== targetArea) continue;
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
 * v2.2: 按 productCategory 分流搜尋，避免類別間關鍵字污染
 */
function generateWixQueries(analysis) {
    const queries = [];
    const vehicles = analysis.vehicles || [];
    const productCategory = analysis.productCategory;

    // 機油專用關鍵字清單（不應用於其他類別搜尋）
    const OIL_ONLY_KEYWORDS = [
        'scooter', 'street', 'race', 'synth', 'top tec', 'special tec',
        '10w-', '5w-', '0w-', '20w-', '15w-',
        'jaso', 'api ', 'ilsac', 'acea',
        'motorbike 4t', 'motorbike synth'
    ];

    // 根據類別取得對應的 sort 欄位值
    const categoryToSort = {
        '機油': { car: '【汽車】機油', motorcycle: '【摩托車】機油' },
        '添加劑': { car: '【汽車】添加劑', motorcycle: '【摩托車】添加劑' },
        '變速箱油': { default: '【汽車】變速箱' },
        '煞車系統': { default: '煞車系統' },
        '冷卻系統': { default: '冷卻系統' },
        '空調系統': { default: '【汽車】空調系統' },
        '化學品': { default: '化學品系列' },
        '美容': { default: '車輛美容系列' },
        '香氛': { default: '車輛美容系列' },
        '自行車': { default: '自行車系列' },
        '船舶': { default: '船舶系列' },
        '商用車': { default: '商用車系列' },
        'PRO-LINE': { default: 'PRO-LINE 專業系列' },
        '其他油品_摩托車': { default: '【摩托車】其他油品' },
        '人車養護_摩托車': { default: '【摩托車】人車養護' }
    };

    /**
     * 檢查關鍵字是否為機油專用
     */
    function isOilOnlyKeyword(kw) {
        const lowerKw = kw.toLowerCase();
        return OIL_ONLY_KEYWORDS.some(ok => lowerKw.includes(ok));
    }

    /**
     * 過濾關鍵字：非機油類別時移除機油專用關鍵字
     */
    function filterKeywordsForCategory(keywords, category) {
        if (category === '機油') {
            return keywords; // 機油可使用所有關鍵字
        }
        // 非機油類別：過濾掉機油專用關鍵字，但保留 SKU
        return keywords.filter(kw => {
            if (kw.startsWith('LM') || /^\d{4,5}$/.test(kw)) {
                return true; // SKU 始終保留
            }
            return !isOilOnlyKeyword(kw);
        });
    }

    for (const vehicle of vehicles) {
        const isMotorcycle = vehicle.vehicleType === '摩托車';
        const isScooter = vehicle.vehicleSubType === '速克達';

        // === 機油專用搜尋 ===
        if (productCategory === '機油') {
            // 1. 黏度搜尋
            if (vehicle.viscosity) {
                queries.push({ field: 'word2', value: vehicle.viscosity, limit: 30, method: 'contains' });
                queries.push({ field: 'title', value: vehicle.viscosity, limit: 20, method: 'contains' });
                const viscosityNoHyphen = vehicle.viscosity.replace('-', '');
                if (viscosityNoHyphen !== vehicle.viscosity) {
                    queries.push({ field: 'word2', value: viscosityNoHyphen, limit: 20, method: 'contains' });
                }
            }

            // 2. 認證搜尋
            const certs = vehicle.certifications || [];
            for (const cert of certs) {
                queries.push({ field: 'title', value: cert, limit: 20, method: 'contains' });
                queries.push({ field: 'cert', value: cert, limit: 20, method: 'contains' });
                const certNoSpace = cert.replace(/\s+/g, '');
                if (certNoSpace !== cert) {
                    queries.push({ field: 'cert', value: certNoSpace, limit: 20, method: 'contains' });
                }
            }

            // 3. 摩托車機油特殊處理
            if (isMotorcycle) {
                queries.push({ field: 'title', value: 'Motorbike', limit: 50, method: 'contains' });
                if (isScooter) {
                    queries.push({ field: 'title', value: 'Scooter', limit: 30, method: 'contains' });
                }
                queries.push({ field: 'sort', value: '【摩托車】機油', limit: 30, method: 'contains' });
            } else {
                queries.push({ field: 'sort', value: '【汽車】機油', limit: 50, method: 'contains' });
            }
        }

        // === 添加劑專用搜尋 ===
        else if (productCategory === '添加劑') {
            const sortPrefix = isMotorcycle ? '【摩托車】' : '【汽車】';
            queries.push({ field: 'sort', value: `${sortPrefix}添加劑`, limit: 30, method: 'contains' });

            // 摩托車添加劑額外加入 Motorbike 關鍵字
            if (isMotorcycle) {
                queries.push({ field: 'title', value: 'Motorbike', limit: 30, method: 'contains' });
            }
        }

        // === 其他產品類別（根據 sort 欄位搜尋）===
        else if (categoryToSort[productCategory]) {
            const sortConfig = categoryToSort[productCategory];
            let sortValue;
            if (sortConfig.default) {
                sortValue = sortConfig.default;
            } else {
                sortValue = isMotorcycle ? sortConfig.motorcycle : sortConfig.car;
            }
            if (sortValue) {
                queries.push({ field: 'sort', value: sortValue, limit: 30, method: 'contains' });
            }
        }

        // === 車型相關關鍵字（過濾後使用）===
        const keywords = filterKeywordsForCategory(vehicle.searchKeywords || [], productCategory);
        for (const kw of keywords) {
            if (kw.startsWith('LM')) {
                queries.push({ field: 'partno', value: kw.toUpperCase(), limit: 5, method: 'eq' });
            } else if (kw.includes('Additive') || kw.includes('添加') || kw.includes('Shooter')) {
                // 添加劑關鍵字搜尋 title
                queries.push({ field: 'title', value: kw, limit: 20, method: 'contains' });
            } else if (productCategory === '機油') {
                // 只有機油類別才使用一般 title 搜尋
                queries.push({ field: 'title', value: kw, limit: 20, method: 'contains' });
            }
        }
    }

    // === 全域 SKU 搜尋（始終執行）===
    const globalKeywords = analysis.searchKeywords || [];
    for (const kw of globalKeywords) {
        if (kw.startsWith('LM')) {
            queries.push({ field: 'partno', value: kw.toUpperCase(), limit: 5, method: 'eq' });
        } else if (productCategory === '添加劑' && (kw.includes('Additive') || kw.includes('添加') || kw.includes('MoS2'))) {
            // 添加劑專用關鍵字
            queries.push({ field: 'title', value: kw, limit: 20, method: 'contains' });
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

    console.log(`[WixQueries] Generated ${uniqueQueries.length} queries for category: ${productCategory}`);
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

        // ⚠️ 優先級層次規則（新增）
        if (memRules.priority_hierarchy) {
            const ph = memRules.priority_hierarchy;
            promptRules += `

【⚠️⚠️⚠️ 繼承優先級（最高到最低）- 非常重要！】
- Level 1（最高）：${ph.level_1_highest}
- Level 2：${ph.level_2}
- Level 3：${ph.level_3}
- Level 4（最低）：${ph.level_4_lowest}
- ⛔ ${ph.critical_rule}`;
        }

        // 添加劑繼承規則
        if (memRules.additive_inheritance) {
            const ai = memRules.additive_inheritance;
            promptRules += `
- ⚠️ ${ai.vehicle_inheritance}
- ⚠️ ${ai.no_repeat_question}
- ⚠️ ${ai.motorcycle_additive}`;
        }

        // 添加劑子類別規則（新增）
        if (memRules.additive_subtype_rules) {
            const asr = memRules.additive_subtype_rules;
            promptRules += `

【⚠️ 添加劑子類別識別（非常重要！）】
- 機油添加劑關鍵字：${(asr.oil_additive_keywords || []).join('、')}
- 汽油添加劑關鍵字：${(asr.fuel_additive_keywords || []).join('、')}
- ⚠️ 用戶說「機油添加劑」「MoS2」→ 搜尋機油添加劑，不是汽油精！
- ⚠️ 用戶說「汽油精」「清積碳」「Shooter」→ 搜尋汽油添加劑`;
        }

        // 使用場景繼承規則
        if (memRules.scenario_inheritance) {
            const si = memRules.scenario_inheritance;
            promptRules += `
- ⚠️ ⭐ ${si.rule}
- ⚠️ ${si.priority_rule || ''}`;
            // 使用新的 oil_scenarios 和 additive_scenarios
            if (si.oil_scenarios) {
                promptRules += `

**機油推薦時的場景規則：**`;
                for (const [scenario, recommendation] of Object.entries(si.oil_scenarios)) {
                    if (scenario === 'description') continue;
                    promptRules += `
  - ${scenario} → ${recommendation}`;
                }
            }
            if (si.additive_scenarios) {
                promptRules += `

**添加劑推薦時的場景規則：**`;
                for (const [scenario, recommendation] of Object.entries(si.additive_scenarios)) {
                    if (scenario === 'description') continue;
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

    // 產品分類規則
    if (rules.product_category_rules?.categories) {
        const categories = rules.product_category_rules.categories;
        promptRules += `

【⚠️ 產品類別識別規則 - 非常重要！】
${rules.product_category_rules.priority_note || '用戶明確指定的產品類別優先'}

**各類別識別關鍵字：**`;

        for (const [category, config] of Object.entries(categories)) {
            if (config.keywords && config.keywords.length > 0) {
                promptRules += `
- ${config.keywords.slice(0, 5).join('、')} → productCategory = "${category}"`;
            }
        }

        promptRules += `

**特殊處理規則：**
- 變速箱油：需要透過 LLM 知識判斷車型對應的變速箱認證（如 ATF Type、DSG 等）
- 美容/香氛/自行車：可直接推薦，並推薦 CarMall 車魔商城購買
- 冷卻系統/煞車系統：需繼承車型資訊
- 如果用戶沒有之前提供車型，才需要詢問

**車型繼承規則：**
- 如果對話中已有車型資訊，自動繼承使用
- 只有用戶從未提供車型時才詢問
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
