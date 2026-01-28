/**
 * LIQUI MOLY Chatbot - Vercel Serverless Function
 * AI 分析用戶問題 - 純 RAG 架構版本
 *
 * P0 優化：使用統一服務模組
 * - vehicle-matcher.js: 車型匹配（取代 findVehicleByMessage）
 * - motorcycle-rules.js: 摩托車規則（JASO Prompt 生成）
 * - certification-matcher.js: 認證偵測
 * - constants.js: 統一常數
 *
 * 設計原則：AI 為主，知識庫為輔
 * - 移除所有硬編碼關鍵字
 * - Gemini 負責識別車型、判斷類型、推論規格
 * - 從 data/*.json 動態載入知識補充 AI 判斷
 */

// 導入統一服務模組（CommonJS）- 從 lib 資料夾載入
const { loadJSON } = require('../lib/knowledge-cache');
const { matchVehicle } = require('../lib/vehicle-matcher');
const { buildJasoRulesPrompt, buildSearchKeywordRulesPrompt } = require('../lib/motorcycle-rules');
const { buildAnalysisPrompt, getConditionalRules: getPromptRules } = require('../lib/prompt-rules');

// 啟用日誌等級控制（透過 LOG_LEVEL 環境變數）
require('../lib/logger').patchConsole();
const { detectCertification } = require('../lib/certification-matcher');
const { CORS_HEADERS, LOG_TAGS, GEMINI_ENDPOINT } = require('../lib/constants');
const { getCategoryToSort, getOilOnlyKeywords } = require('../lib/search-helper');

// ============================================
// 載入外部知識庫（使用統一快取模組）
// ============================================
const vehicleSpecs = loadJSON('vehicle-specs.json') || {};
const additiveGuide = loadJSON('additive-guide.json') || [];
const searchReference = loadJSON('search-reference.json') || {};
const aiAnalysisRules = loadJSON('ai-analysis-rules.json') || {};

// 🔴 SKU 對照表（用於顯示產品名稱）
const skuToProduct = searchReference.sku_to_product || {};

console.log(`${LOG_TAGS.ANALYZE} Knowledge loaded via unified cache`);
console.log(`${LOG_TAGS.ANALYZE} Additive Guide: ${Array.isArray(additiveGuide) ? additiveGuide.length : 0} items`);



async function handler(req, res) {
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

        Object.keys(CORS_HEADERS).forEach(key => res.setHeader(key, CORS_HEADERS[key]));
        return res.status(200).json({ success: true, analysis: result });

    } catch (error) {
        console.error('Analyze API error:', error);
        Object.keys(CORS_HEADERS).forEach(key => res.setHeader(key, CORS_HEADERS[key]));
        return res.status(500).json({ success: false, error: error.message });
    }
}

// ============================================
// 條件規則定義（動態載入，解決 Lost in the Middle）
// ============================================

const CONDITIONAL_RULES = {
    // 電動車規則
    EV: `【純電動車識別】
純電動車品牌：Gogoro/Ionex/eMOVING/eReady (電動機車)｜Tesla/BYD/Porsche Taycan (電動汽車)
⚠️ 純電動車 isElectricVehicle=true，不需要傳統機油！
→ 產品類別設為「其他油品」或「煞車系統」
→ 推薦：齒輪油(Gear Oil)、煞車油(Brake Fluid DOT 4/5.1)`,

    // 添加劑/症狀規則
    ADDITIVE: `【產品適用部位識別】
1. **引擎機油添加劑**（加在引擎機油，與變速箱無關）：
   - Cera Tec/MoS2/Oil Additive/Engine Flush → 只需知道車型，不問變速箱！
2. **變速箱專用產品**（才需問變速箱類型）：
   - ATF/DSG/Gear Oil/ATF Additive
⚠️ 若用戶問機油添加劑 → 禁止追問變速箱類型！`,

    // 變速箱認證規則
    TRANSMISSION: `【變速箱油認證推論 - 必須精確！】

⚠️ **追問規則（資訊不足時必須追問）**：
- 只知道品牌（如 "BMW"）→ needsMoreInfo=[「請問是哪個車型和年份？不同變速箱規格需要不同的油品。」]
- 只知道車型沒說變速箱類型 → needsMoreInfo=[「請問是手排、自排還是 DSG？」]
- 知道品牌+車型+年份+變速箱類型 → 使用 LLM 知識推論認證

**歐系車變速箱對應**：
- VW/Audi/Skoda DSG 6速濕式（DQ250）→ 認證 "DSG"，searchKeywords=["Top Tec ATF 1800", "DSG"]
- VW/Audi/Skoda DSG 7速乾式（DQ200）→ 認證 "DSG Dry"，searchKeywords=["Top Tec ATF 1700", "DSG"]
- BMW ZF 6HP（E9x/E6x 等 2015 前）→ 認證 "ZF LifeguardFluid 6"
- BMW ZF 8HP（F3x/G2x 等 2015 後）→ 認證 "ZF LifeguardFluid 8"
- Benz 7G-Tronic（W204/W212 等）→ 認證 "MB 236.14"
- Benz 9G-Tronic（W205/W213 等）→ 認證 "MB 236.17"

**日韓系車**：
- Toyota 自排（大部分）→ 認證 "Toyota WS"
- Honda 自排 → 認證 "Honda ATF"
- Hyundai/Kia 自排 → 認證 "SP-IV"

**美系車**：
- Ford 6F/6R → 認證 "Mercon LV"
- GM 6AT/8AT/10AT → 認證 "Dexron VI"

⚠️ 將推論認證加入 certifications 和 searchKeywords！
⚠️ 若無法確定變速箱型號，必須加入 needsMoreInfo 追問！`,


    // 機油推論規則
    OIL: `【車型資訊智慧推論】
1. **燃油類型（必問！）**：
   - 台灣常見車型（Focus, Elantra, Golf, Tucson, Santa Fe, BMW, Benz）通常都有汽/柴油雙版本
   - **除非用戶明確說「汽油」或「柴油」，否則必須將「燃油類型」加入 needsMoreInfo**
   - 範例：「2019 Elantra 機油」→ needsMoreInfo=["請問是汽油還是柴油引擎？"]

2. **年份推論**：年份會影響認證需求時才追問
3. **⚠️ 黏度推論**：使用汽車知識推論，⛔ 禁止追問用戶黏度偏好！`
};

/**
 * 根據訊息內容動態載入條件規則
 * @param {string} message - 用戶訊息
 * @param {string} contextText - 對話上下文
 * @returns {string} - 條件規則字串
 */
function getConditionalRules(message, contextText = '') {
    const rules = [];
    const combined = `${message} ${contextText}`.toLowerCase();

    // 電動車規則
    if (/gogoro|ionex|emoving|ereader|tesla|byd|taycan|電動車|電動機車|純電/i.test(combined)) {
        rules.push(CONDITIONAL_RULES.EV);
    }

    // 添加劑規則
    if (/漏油|吃油|異音|過熱|抖動|添加劑|cera\s*tec|mos2|機油精|oil\s*additive|engine\s*flush|止漏|清潔/i.test(combined)) {
        rules.push(CONDITIONAL_RULES.ADDITIVE);
    }

    // 變速箱規則
    if (/變速箱|atf|dsg|手排|自排|齒輪油|gear\s*oil|cvt/i.test(combined)) {
        rules.push(CONDITIONAL_RULES.TRANSMISSION);
    }

    // 機油推論規則（預設載入，因為很常用）
    if (rules.length === 0 || /機油|oil|推薦/i.test(combined)) {
        rules.push(CONDITIONAL_RULES.OIL);
    }

    return rules.length > 0 ? '\n' + rules.join('\n\n') : '';
}

/**
 * AI 分析用戶問題 - 純 AI 主導版本
 */
async function analyzeUserQuery(apiKey, message, conversationHistory = []) {
    // ============================================
    // 🚨 SKU 快速偵測（最高優先級，在 AI 分析之前執行）
    // ============================================
    // 如果用戶只輸入產品編號（如 LM3444、有LM3444嗎），直接返回產品查詢意圖
    // 避免 AI 誤把 SKU 當成車型
    const skuQuickMatch = message.match(/(?:LM|lm|Lm)[ -]?([0-9]{4,5})/);
    if (skuQuickMatch) {
        const skuNum = skuQuickMatch[1];
        const fullSku = `LM${skuNum}`;

        // 過濾年份（2019-2030 範圍）
        const num = parseInt(skuNum, 10);
        const isYear = skuNum.length === 4 && num >= 2019 && num <= 2030;

        if (!isYear) {
            console.log(`${LOG_TAGS.ANALYZE} 🎯 SKU Quick Detection: ${fullSku} - Bypassing AI analysis`);

            // 直接返回產品查詢意圖，不呼叫 AI
            return {
                intentType: 'product_inquiry',
                productCategory: '產品查詢',
                needsProductRecommendation: true,
                searchKeywords: [fullSku, skuNum],
                vehicles: [],
                needsMoreInfo: [],
                isSKUQuery: true,  // 標記為 SKU 查詢
                queriedSKU: fullSku,
                _skipAI: true  // 標記跳過 AI
            };
        }
    }

    // ============================================
    // 一般 AI 分析流程
    // ============================================
    // 準備對話上下文
    let contextSummary = '';
    let symptomContext = '';  // 症狀上下文
    let intentContext = '';   // ⚡ 新增：意圖上下文

    if (conversationHistory && conversationHistory.length > 0) {
        const recentHistory = conversationHistory.slice(-6);  // 增加到 6 條

        // 從對話歷史構建完整上下文
        const allHistoryText = recentHistory.map(m => m.content).join(' ');

        // 嘗試從對話歷史中提取已知車型資訊
        let extractedVehicleInfo = '';

        // 提取車型關鍵資訊供 AI 參考（移除硬編碼，讓 AI 智慧推論）
        const historyLines = recentHistory.map(m => m.content).join('\n');

        // 只提取明確由用戶提供的資訊，不進行硬編碼匹配
        if (historyLines.match(/汽油/)) {
            extractedVehicleInfo += '- 燃油類型：汽油（用戶明確提供）\n';
        }
        if (historyLines.match(/柴油/)) {
            extractedVehicleInfo += '- 燃油類型：柴油（用戶明確提供）\n';
        }
        if (historyLines.match(/油電|hybrid/i)) {
            extractedVehicleInfo += '- 燃油類型：油電混合（用戶明確提供）\n';
        }
        if (historyLines.match(/自排|自動/)) {
            extractedVehicleInfo += '- 變速箱：自排\n';
        }
        if (historyLines.match(/手排|手動/)) {
            extractedVehicleInfo += '- 變速箱：手排\n';
        }
        // 年份提取
        const yearMatch = historyLines.match(/(\d{4})\s*年?/);
        if (yearMatch) {
            extractedVehicleInfo += `- 年份：${yearMatch[1]}\n`;
        }

        // ⚡ 新增：提取前一輪的產品推薦意圖
        // 如果 AI 在前一輪追問資訊（年份、燃油類型等），代表使用者想要產品推薦
        const aiMessages = recentHistory.filter(m => m.role === 'model' || m.role === 'assistant');
        const lastAIMessage = aiMessages[aiMessages.length - 1]?.content || '';

        if (lastAIMessage.match(/為了推薦|請問.*年份|請問.*燃油|請問.*汽油.*柴油|請問.*檔車.*速克達/)) {
            intentContext = `\n【⚠️ 意圖繼承 - 非常重要！】
- AI 在前一輪詢問了車型補充資訊（年份、燃油類型等）
- 這代表使用者想要「產品推薦」（機油或添加劑）
- 當使用者補充這些資訊時，**必須設定 intentType="product_recommendation", needsProductRecommendation=true**
- **禁止**將使用者的補充資訊當作「只提供車型沒說需求」！
- 使用者是在「回答追問」，不是「純粹報車型」！
\n`;
        }

        contextSummary = '【對話上下文 - 請繼承已知資訊！】\n' + recentHistory.map(m =>
            `${m.role === 'user' ? '用戶' : 'AI'}: ${m.content.substring(0, 200)}`
        ).join('\n') + '\n';

        if (extractedVehicleInfo) {
            contextSummary += `\n【⚠️ 從對話中提取的車型資訊 - 必須繼承！】\n${extractedVehicleInfo}\n`;
        }

        // ⚡ 添加意圖上下文
        if (intentContext) {
            contextSummary += intentContext;
        }

        contextSummary += '\n';

        // 如果對話中有提到症狀相關問題，提醒 AI 這是添加劑諮詢
        if (allHistoryText.match(/怎麼辦|問題|症狀|異常|異音|過熱|抖動|漏油|吃油/)) {
            symptomContext = `\n⚠️ 重要：對話中涉及車輛症狀問題，應推薦添加劑而非機油。請用 LLM 知識推論可能的解決方案關鍵字！\n`;
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
- **繼承規則**：如果對話中已經提供了車型、使用場景或**偏好**（如全合成），且用戶只是在補充或切換車型（如「那機車呢」），請盡可能保留相關偏好！
`;
    }

    // === 症狀對應 SKU 參考（供添加劑匹配使用）===
    const symptomRefPrompt = searchReference.symptom_to_sku ? `
【症狀對應產品 SKU - 快速參考】
${JSON.stringify(searchReference.symptom_to_sku)}
` : '';

    // === AI 主導分析提示詞（從知識庫動態生成） ===
    const dynamicRules = buildAnalysisPromptRules();
    const responseFormat = aiAnalysisRules?.json_response_format
        ? JSON.stringify(aiAnalysisRules.json_response_format, null, 4)
        : `{
    "intentType": null,
    "isMultiVehicleQuery": false,
    "vehicles": [{
        "vehicleName": "車型全名（如 2020 VW Caddy）",
        "vehicleType": "汽車/摩托車/null",
        "vehicleSubType": null,
        "fuelType": "汽油/柴油/null（需推論或追問）",
        "transmissionType": "手排/自排/CVT/null（變速箱相關問題時必填）",
        "strokeType": null,
        "isElectricVehicle": false,
        "certifications": ["根據車廠推論的認證，如 VW 504 00"],
        "viscosity": "根據車廠推論的黏度，如 5W-30",
        "searchKeywords": ["搜尋關鍵字"]
    }],
    "productCategory": "機油/添加劑/...",
    "usageScenario": null,
    "recommendSynthetic": "any",
    "preferLargePack": false,
    "symptomMatched": null,
    "symptomSeverity": "none",
    "isGeneralProduct": false,
    "needsProductRecommendation": false,
    "needsMoreInfo": ["需要追問的資訊，如 fuelType"]
}`;

    // === 從知識庫生成意圖類型規則 ===
    let intentTypeRules = '';
    if (aiAnalysisRules?.intent_type_rules?.types) {
        const types = aiAnalysisRules.intent_type_rules.types;
        intentTypeRules = `
【⚠️ 意圖類型識別 - 必須判斷！】
根據用戶問題選擇正確的 intentType（預設為 product_recommendation）：

${Object.entries(types).map(([type, data]) =>
            `- **${type}**：${data.description}\n  範例：${data.examples.join('、')}`
        ).join('\n')}

⚠️ 非產品推薦的意圖（authentication/price_inquiry/purchase_inquiry/cooperation_inquiry），needsProductRecommendation 必須設為 false！
`;
    }

    // === 從知識庫生成使用場景與產品推薦規則 ===
    let scenarioRules = '';
    if (aiAnalysisRules?.usage_scenario_mapping) {
        scenarioRules = '\n【使用場景推薦規（動態載入）】';
        for (const [scenario, config] of Object.entries(aiAnalysisRules.usage_scenario_mapping)) {
            if (config.recommendSynthetic === 'full') {
                scenarioRules += `\n- ${scenario} (${config.keywords.join('/')}) → recommendSynthetic="full"`;
            }
        }
    }

    // === 動態載入條件規則（使用新模組）===
    // 注意：保留原有的 symptomGuide 和 dynamicRules 作為額外資訊

    // === 使用精簡化 Prompt（Sandwich Pattern）===
    const analysisPrompt = buildAnalysisPrompt({
        message,
        contextSummary,
        symptomContext,
        symptomGuide: symptomGuide + '\n' + symptomRefPrompt + '\n' + dynamicRules,
        responseFormat,
        intentTypeRules: intentTypeRules + scenarioRules
    });

    try {
        const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
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
            const errorText = await response.text();
            console.error(`AI analysis API error: ${response.status}`, errorText);
            return null;
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            let jsonStr = jsonMatch[0];

            // ⚠️ JSON 修復：嘗試修復常見的 AI 輸出錯誤
            try {
                // 1. 移除尾隨逗號（JSON 不允許）
                jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');

                // 2. 移除控制字符（換行符以外）
                jsonStr = jsonStr.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');

                // 3. 修復單引號（JSON 要求雙引號）
                // 謹慎處理：只處理明顯的鍵值對引號問題
                jsonStr = jsonStr.replace(/'([^']+)':/g, '"$1":');
                jsonStr = jsonStr.replace(/:\s*'([^']*)'/g, ': "$1"');

            } catch (fixError) {
                console.warn(`${LOG_TAGS.ANALYZE} JSON pre-fix failed:`, fixError.message);
            }

            try {
                const result = JSON.parse(jsonStr);

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

                // === 強制全合成覆寫 (Rule-Based Override) ===
                // 1. 當前訊息檢查
                if (/全合成|fully\s*synthetic|synthoil|race|賽道|跑山/i.test(message)) {
                    console.log(`${LOG_TAGS.ANALYZE} ⚡ Force-enabling strict synthetic filter (Detected keywords in current message)`);
                    result.recommendSynthetic = 'full';
                }
                // 2. 歷史訊息繼承 (若當前未設為 full，檢查前 3 則訊息)
                else if (result.recommendSynthetic !== 'full' && Array.isArray(conversationHistory)) {
                    const recentUserMessages = conversationHistory
                        .filter(msg => msg.role === 'user')
                        .slice(-3); // 檢查最近 3 則

                    const hasPastPreference = recentUserMessages.some(msg =>
                        /全合成|fully\s*synthetic|synthoil|race|賽道|跑山/i.test(msg.content || msg.text || '')
                    );

                    if (hasPastPreference) {
                        console.log(`${LOG_TAGS.ANALYZE} ⚡ Inheriting "full" synthetic preference from history`);
                        result.recommendSynthetic = 'full';
                    }
                }

                // === 使用知識庫增強 AI 結果 ===
                enhanceWithKnowledgeBase(result, message, conversationHistory);

                // === 偵測認證搜尋請求（使用統一的認證偵測）===
                // 檢查用戶訊息是否明確詢問特定認證
                const certDetection = detectCertification(message);
                let detectedCert = certDetection ? certDetection.cert : null;

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
                    console.log(`${LOG_TAGS.ANALYZE} Certification search detected:`, result.certificationSearch);
                }
                // 若只有黏度追問且對話中有認證歷史，繼承認證（使用統一的認證偵測）
                // ⚠️ 修復：只有當車型類型匹配時才繼承認證，避免汽車認證套用到摩托車
                else if (detectedViscosity && conversationHistory.length > 0) {
                    const currentVehicleType = result.vehicles?.[0]?.vehicleType;
                    const isMotorcycleQuery = currentVehicleType === '摩托車';

                    const historyText = conversationHistory.map(m => m.content).join(' ');
                    const historyCertDetection = detectCertification(historyText);

                    if (historyCertDetection) {
                        const historyCert = historyCertDetection.cert;
                        const certType = historyCertDetection.type;

                        // 檢查認證類型是否與當前車型匹配
                        // JASO 認證只適用於摩托車，ILSAC/API 等適用於汽車
                        const isMotorcycleCert = certType === 'JASO';

                        // 只有當認證類型與車型匹配時才繼承
                        if (isMotorcycleQuery === isMotorcycleCert) {
                            detectedCert = historyCert;
                            result.certificationSearch = {
                                requestedCert: detectedCert,
                                viscosity: detectedViscosity
                            };
                            console.log(`${LOG_TAGS.ANALYZE} Inherited certification from history:`, result.certificationSearch);
                        } else {
                            // 車型不匹配，不繼承認證，讓摩托車規則引擎處理
                            console.log(`${LOG_TAGS.ANALYZE} Skipping cert inheritance: ${historyCert} (${certType}) not suitable for ${currentVehicleType}`);
                        }
                    }
                }

                // 生成 Wix 查詢
                result.wixQueries = generateWixQueries(result);

                console.log(`${LOG_TAGS.ANALYZE} AI result:`, JSON.stringify(result, null, 2));
                return result;
            } catch (parseError) {
                console.error(`${LOG_TAGS.ANALYZE} JSON parse error:`, parseError.message);
                console.error(`${LOG_TAGS.ANALYZE} Failed JSON string:`, jsonStr.substring(0, 200));

                // ⚠️ JSON 解析失敗時的降級處理：嘗試提取部分資訊
                const fallbackResult = {
                    intentType: 'general_inquiry',
                    needsProductRecommendation: false,
                    vehicles: [],
                    searchKeywords: []
                };

                // 嘗試從原始文字提取意圖類型
                if (text.includes('product_recommendation')) {
                    fallbackResult.intentType = 'product_recommendation';
                    fallbackResult.needsProductRecommendation = true;
                }

                // 嘗試提取車型關鍵字
                const vehiclePatterns = [
                    /vehicleName["\s:]+["']?([^"',}\]]+)/i,
                    /車型[：:]\s*([^\n,]+)/
                ];
                for (const pattern of vehiclePatterns) {
                    const match = text.match(pattern);
                    if (match && match[1]) {
                        fallbackResult.searchKeywords.push(match[1].trim());
                        break;
                    }
                }

                console.log(`${LOG_TAGS.ANALYZE} Using fallback result due to JSON parse error`);
                return fallbackResult;
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
 * P0 優化：使用統一的 vehicle-matcher 服務
 */
function enhanceWithKnowledgeBase(result, message, conversationHistory) {
    const lowerMessage = message.toLowerCase();
    const historyText = conversationHistory.map(m => m.content).join(' ').toLowerCase();
    const combinedText = `${lowerMessage} ${historyText}`;

    // === 1. 使用統一的車型匹配服務 ===
    let vehicleMatchResult = matchVehicle(message, historyText);

    // 轉換為舊格式以保持向後兼容
    let vehicleMatch = null;
    if (vehicleMatchResult.matched && vehicleMatchResult.spec) {
        vehicleMatch = {
            brand: vehicleMatchResult.vehicleBrand,
            model: vehicleMatchResult.vehicleModel,
            spec: vehicleMatchResult.spec,
            matchedAlias: vehicleMatchResult.detectedKeywords[0] || null
        };
    }

    if (vehicleMatch) {
        console.log(`${LOG_TAGS.ANALYZE} Knowledge Base matched: ${vehicleMatch.brand} ${vehicleMatch.model}`);
        const spec = vehicleMatch.spec;

        // 補充搜尋關鍵字
        if (spec.searchKeywords && Array.isArray(spec.searchKeywords)) {
            if (!result.searchKeywords) result.searchKeywords = [];
            result.searchKeywords.unshift(...spec.searchKeywords);
        }

        // ⭐ 優先加入 recommendedSKU（品牌專用產品應優先搜尋）
        if (spec.recommendedSKU) {
            if (!result.searchKeywords) result.searchKeywords = [];
            const skus = Array.isArray(spec.recommendedSKU) ? spec.recommendedSKU : [spec.recommendedSKU];
            for (const sku of skus) {
                if (!result.searchKeywords.includes(sku)) {
                    result.searchKeywords.unshift(sku); // 放在最前面優先搜尋
                }
            }
            console.log(`${LOG_TAGS.ANALYZE} Added recommended SKU: ${skus.join(', ')}`);
        }

        // ⚠️ 關鍵修復：如果 AI 沒有識別出車型，但對話歷史中有，創建車型物件
        if (!result.vehicles || result.vehicles.length === 0) {
            console.log(`${LOG_TAGS.ANALYZE} Creating vehicle from history: ${vehicleMatch.brand} ${vehicleMatch.model}`);
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

    // === 2. 添加劑症狀匹配（知識庫輔助，AI 推論為主）===
    const vehicleType = result.vehicles?.[0]?.vehicleType || result.vehicleType;
    const fuelType = result.vehicles?.[0]?.fuelType || result.fuelType;
    // 🔴 新增：取得變速箱類型
    const transmissionType = result.vehicles?.[0]?.transmissionType || result.transmissionType;

    // 先嘗試知識庫匹配（傳入 vehicleType、fuelType 和 transmissionType 進行過濾）
    const additiveResult = matchAdditiveGuide(lowerMessage, vehicleType, fuelType, transmissionType);

    // 🔴 輔助函式：為選項加入產品名稱
    const addProductNames = (options) => {
        if (!options) return options;
        return options.map(opt => ({
            ...opt,
            solutionsWithNames: (opt.solutions || []).map(sku => ({
                sku: sku,
                name: skuToProduct[sku] || sku
            }))
        }));
    };

    // 🔴 處理需要追問車型的情況
    if (additiveResult.needsVehicleType) {
        // 症狀同時存在於汽車和機車分類，需要先追問
        console.log(`${LOG_TAGS.ANALYZE} Symptom "${additiveResult.detectedSymptom}" requires vehicle type clarification`);

        if (!result.needsMoreInfo) result.needsMoreInfo = [];
        result.needsMoreInfo.push(`請問您的車輛是汽車還是機車？（不同車種的「${additiveResult.detectedSymptom}」問題有不同的解決方案）`);

        // 儲存偵測到的症狀供後續使用（含產品名稱）
        result.additiveGuideMatch = {
            matched: false,
            needsVehicleType: true,
            detectedSymptom: additiveResult.detectedSymptom,
            carOptions: addProductNames(additiveResult.carOptions),
            bikeOptions: addProductNames(additiveResult.bikeOptions)
        };
        result.productCategory = '添加劑';

        // 🔴 新增：處理需要追問變速箱類型的情況
    } else if (additiveResult.needsTransmissionType) {
        // 症狀同時存在於手排和自排分類，需要先追問
        console.log(`${LOG_TAGS.ANALYZE} Symptom "${additiveResult.detectedSymptom}" requires transmission type clarification`);

        if (!result.needsMoreInfo) result.needsMoreInfo = [];
        result.needsMoreInfo.push(`請問您的車是手排變速箱還是自排變速箱？（不同變速箱類型的「${additiveResult.detectedSymptom}」問題需要使用不同的產品）`);

        // 儲存偵測到的症狀供後續使用（含產品名稱）
        result.additiveGuideMatch = {
            matched: false,
            needsTransmissionType: true,
            detectedSymptom: additiveResult.detectedSymptom,
            manualOptions: addProductNames(additiveResult.manualOptions),
            autoOptions: addProductNames(additiveResult.autoOptions)
        };
        result.productCategory = '添加劑';

    } else if (additiveResult.items.length > 0) {
        // 知識庫有匹配，使用知識庫推薦（含產品名稱）
        result.additiveGuideMatch = {
            matched: true,
            items: addProductNames(additiveResult.items),
            detectedSymptom: additiveResult.detectedSymptom
        };

        // 加入 SKU 到搜尋關鍵字（補充 AI 推論）
        if (!result.searchKeywords) result.searchKeywords = [];
        for (const item of additiveResult.items) {
            for (const sku of item.solutions) {
                if (!result.searchKeywords.includes(sku)) {
                    result.searchKeywords.push(sku);
                }
            }
        }
        result.productCategory = '添加劑';
        console.log(`${LOG_TAGS.ANALYZE} AdditiveGuide matched: ${additiveResult.items.length} items`);
    } else {
        // 知識庫沒有匹配，但 AI 可能已推論出 searchKeywords
        // 不強制追問，讓 AI 推論的關鍵字去產品庫搜尋
        console.log(`${LOG_TAGS.ANALYZE} AdditiveGuide no match, relying on AI inference`);

        // 如果 AI 有推論產品類別為添加劑，保留設定
        if (result.productCategory === '添加劑' && result.searchKeywords?.length > 0) {
            console.log(`${LOG_TAGS.ANALYZE} AI inferred additive keywords: ${result.searchKeywords.join(', ')}`);
        }
    }


    // === 3. SKU 自動偵測 ===
    // 修正：簡化正則表達式，確保 Vercel 兼容；偵測到 SKU 後強制搜尋產品
    // ⚠️ 新增：過濾年份誤判（2019-2030 範圍內的 4 位數可能是年份）
    const skuPattern = /[Ll][Mm][ -]?([0-9]{4,5})/g;
    const skuMatches = [...message.matchAll(skuPattern)];
    let validSkuCount = 0;

    if (skuMatches.length > 0) {
        for (const match of skuMatches) {
            const skuNum = match[1];
            if (skuNum) {
                // ⚠️ 過濾可能是年份的 SKU（4 位數且在 2019-2030 範圍）
                const num = parseInt(skuNum, 10);
                if (skuNum.length === 4 && num >= 2019 && num <= 2030) {
                    console.log(`${LOG_TAGS.ANALYZE} Filtered potential year: LM${skuNum}`);
                    continue;
                }

                const fullSku = `LM${skuNum}`;
                if (!result.searchKeywords) result.searchKeywords = [];
                if (!result.searchKeywords.includes(fullSku)) {
                    result.searchKeywords.unshift(fullSku, skuNum);
                    validSkuCount++;
                    console.log(`${LOG_TAGS.ANALYZE} SKU detected: ${fullSku}`);
                }
            }
        }
        // ⚡ 關鍵修復：偵測到有效 SKU 後，強制設定為產品查詢
        if (validSkuCount > 0) {
            result.needsProductRecommendation = true;
            result.intentType = 'product_inquiry';
            console.log(`${LOG_TAGS.ANALYZE} SKU query detected, forcing product search`);
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
                console.log(`${LOG_TAGS.ANALYZE} Detected additive subtype: 機油添加劑`);

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
                console.log(`${LOG_TAGS.ANALYZE} Detected additive subtype: 汽油添加劑`);

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
 * v2.2: 新增變速箱類型（手排/自排）追問邏輯
 * @param {string} message - 用戶訊息
 * @param {string} vehicleType - 車輛類型（汽車/機車）
 * @param {string} fuelType - 燃油類型（汽油/柴油）
 * @param {string} transmissionType - 變速箱類型（手排/自排）
 * @returns {Object} - 匹配結果，包含 items, needsVehicleType, needsTransmissionType, detectedSymptom
 */
function matchAdditiveGuide(message, vehicleType = null, fuelType = null, transmissionType = null) {
    if (!additiveGuide.length) return { items: [], needsVehicleType: false, needsTransmissionType: false, detectedSymptom: null };

    const matched = [];
    const noProductMatched = [];
    const lowerMessage = message.toLowerCase();

    // 🔴 新增：當車型未知時，檢查症狀是否同時存在於汽車和機車
    const vehicleTypeUnknown = !vehicleType || (vehicleType !== '汽車' && vehicleType !== '摩托車' && vehicleType !== '機車');

    // 🔴 新增：檢查變速箱類型是否已知（手排/自排/CVT）
    const transmissionTypeUnknown = !transmissionType ||
        (transmissionType !== '手排' && transmissionType !== '自排' && transmissionType !== 'CVT' &&
            transmissionType !== '手排變速箱' && transmissionType !== '自排變速箱');

    // 如果車型未知，先檢查兩邊
    const targetAreas = vehicleTypeUnknown ? ['汽車', '機車'] : [vehicleType === '摩托車' ? '機車' : '汽車'];

    // 追蹤哪些症狀在哪些區域有匹配
    const symptomsByArea = { '汽車': [], '機車': [] };

    // 🔴 新增：追蹤變速箱類型匹配（用於判斷是否需要追問）
    const symptomsByTransmission = { '手排變速箱': [], '自排變速箱': [] };

    let detectedSymptom = null;

    // 🔴 完整症狀關鍵字對照表（台灣消費者常用語）
    // 根據 additive-guide.json 中所有 problem 生成
    const symptomAliases = {
        // ===== 引擎機油相關 =====
        '吃機油': ['吃機油', '吃雞油', '機油消耗', '耗機油', '燒機油', '機油減少', '機油不見', '一直加機油', '機油耗很快', '機油消耗過高'],
        '乳化': ['乳化', '乳黃色', '油泥', '黃色油泥', '機油蓋有泥', '奶油狀', '美乃滋', '油水混合', '機油乳化'],
        '漏油': ['漏油', '滲油', '油封漏', '引擎漏油', '底部漏油', '有油漬', '地上有油', '停車有油', '油封老化'],

        // ===== 引擎運轉相關 =====
        '怠速抖動': ['怠速抖', '怠速不穩', '抖動', '發抖', '震動', '引擎抖', '車身抖', 'idle抖', '紅燈抖', '停紅燈抖'],
        '啟動困難': ['啟動困難', '難發動', '發不動', '不好發', '冷車難發', '打不著', '轉不動', '啟動慢', '發車困難', '不好啟動'],
        '引擎過熱': ['過熱', '水溫高', '溫度高', '引擎熱', '冒煙', '沸騰', '水滾', '水箱滾', '過熱警示'],
        '缸壓不足': ['缸壓', '缸壓不足', '壓縮', '沒力', '動力不足', '加速無力', '爬坡沒力', '馬力下降', '性能衰退', '缸壓流失'],
        '積碳': ['積碳', '積炭', '卡碳', '燃油積碳', '燃燒不完全', '噴油嘴髒', '進氣門積碳', '活塞環積碳'],

        // ===== 引擎異音相關 =====
        '液壓頂桿異音': ['達達聲', '汽門聲', '頂桿聲', '搭搭聲', '敲擊聲', '引擎敲缸', '金屬聲', '氣門舉桿', '液壓頂桿'],
        '異音': ['異音', '噪音', '怪聲', '有聲音', '聲音大', '聲音怪', '怠速異音'],

        // ===== 冷卻系統相關 =====
        '漏水': ['漏水', '水箱漏', '冷卻水漏', '水不見', '冷卻液減少', '水箱破', '水管漏', '冷卻水減少', '冷卻液外漏'],
        '冷卻系統有油': ['冷卻系統有油', '水箱有油', '冷卻水有機油', '油水混合'],

        // ===== 排放相關 =====
        '黑煙': ['黑煙', '冒黑煙', '排氣黑', '廢氣黑', '噴黑煙', '排放黑煙'],
        '排放超標': ['驗車不過', '排放超標', '廢氣檢測', '環保不過', '驗排氣', '廢氣排放', '檢驗不合格'],
        'DPF': ['dpf', '柴油微粒', '再生', '濾芯堵塞', 'dpf燈亮', '再生頻繁', 'dpf再生'],

        // ===== 柴油專用 =====
        '柴油菌': ['柴油菌', '細菌', '膠化', '真菌', '柴油變質', '油品變質', '燃油膠化'],
        '抗凝固': ['結蠟', '凝固', '冬季', '低溫', '柴油結凍', '油路堵'],

        // ===== 汽油專用 =====
        '代鉛劑': ['代鉛', '含鉛', '老式引擎', '老爺車', '古董車', '需要含鉛汽油'],
        '燃油老化': ['放太久', '油品變質', '燃油老化', '久放', '季節性', '長期停放', '燃油變質'],

        // ===== 變速箱相關（手排/自排通用）=====
        '換檔': ['換檔', '換擋', '入檔', '打檔', '變速箱', '排檔', '檔位', '變速箱問題'],
        '換檔延遲': ['換檔延遲', '頓挫', '延遲換檔', '換檔慢', '升檔慢', '降檔慢', '換檔遲鈍', '換檔不順'],
        '換檔噪音': ['換檔噪音', '換檔異音', '打檔有聲', '換檔有聲', '入檔有聲', '檔位聲音', '變速箱聲音'],
        '入檔困難': ['入檔困難', '難入檔', '打不進去', '卡檔', '難打檔', '檔位卡', '進檔困難', '掛不進去', '換檔困難'],
        '負載異音': ['負載異音', '負載時有噪音', '加速有聲', '出力有聲', '催油門有聲'],
        '軸承異音': ['軸承聲', '軸承異音', '軸承磨損', '軸承磨損異音', '齒輪聲'],
        '變速箱漏油': ['變速箱漏', 'at漏油', 'mt漏油', '排檔漏油', '油封漏油'],

        // ===== 方向機相關 =====
        '方向機': ['方向機', '轉向', '動力方向', '方向盤', '打方向', '方向機系統'],
        '轉向異音': ['轉向有聲', '轉向異音', '打方向有聲', '方向盤聲音', '轉彎有聲'],
        '方向機漏油': ['方向機漏', '方向機漏油', '動力方向漏', 'ps漏油'],
        '轉向抖動': ['方向盤抖', '轉向抖', '轉向抖動', '打方向抖'],

        // ===== 預防保養相關 =====
        '性能優化': ['性能', '動力', '馬力', '加速', '優化', '提升性能'],
        '燃油系統清潔': ['油路清潔', '噴油嘴清潔', '化油器清潔', '燃油清潔'],
        '防鏽保護': ['防鏽', '防腐', '防腐蝕'],
        '冷啟動保護': ['冷啟動', '冷車', '冬天', '低溫啟動'],
        '油封保養': ['油封', '油封保養', '預防漏油'],
        '水箱止漏': ['水箱止漏', '水箱預防', '冷卻止漏'],
        '新車磨合': ['磨合', '新車', '跑合', '磨合期'],

        // ===== 機車專用 =====
        '機車吃機油': ['吃機油', '機油消耗', '耗機油', '燒機油'],
        '機車換檔': ['換檔', '打檔', '入檔', '檔車換檔', '換檔過程異音'],

        // ===== 其他 =====
        '老鼠': ['老鼠', '貓', '小動物', '咬破', '躲藏', '老鼠咬', '動物咬', '線被咬', '管子咬破', '引擎室有老鼠']
    };

    for (const item of additiveGuide) {
        const problem = (item.problem || '').toLowerCase();

        // 檢查症狀別名是否匹配
        let isMatched = false;
        let matchedSymptomKey = null;
        for (const [symptom, aliases] of Object.entries(symptomAliases)) {
            if (problem.includes(symptom.toLowerCase())) {
                if (aliases.some(alias => lowerMessage.includes(alias.toLowerCase()))) {
                    isMatched = true;
                    matchedSymptomKey = symptom;
                    break;
                }
            }
        }

        // 直接關鍵字匹配（取問題的前6個字）
        if (!isMatched && problem.length >= 4) {
            const keywords = problem.split(/[導致,，()（）]/).filter(k => k.length >= 2);
            if (keywords.some(kw => lowerMessage.includes(kw.trim()))) {
                isMatched = true;
                matchedSymptomKey = keywords[0];
            }
        }

        if (isMatched) {
            // 記錄偵測到的症狀
            if (!detectedSymptom) detectedSymptom = matchedSymptomKey;

            // 記錄此症狀在哪個區域有匹配
            const itemArea = item.area || '汽車';
            if (!symptomsByArea[itemArea]) symptomsByArea[itemArea] = [];

            // 🔴 車型未知時：記錄所有區域的匹配，稍後判斷是否需要追問
            if (vehicleTypeUnknown) {
                symptomsByArea[itemArea].push({
                    problem: item.problem,
                    explanation: item.explanation,
                    solutions: item.solutions || [],
                    type: item.type,
                    area: itemArea,
                    hasProduct: item.hasProduct !== false
                });
                continue; // 繼續收集，稍後判斷
            }

            // 車型已知：只匹配目標區域
            const targetArea = vehicleType === '摩托車' ? '機車' : '汽車';
            if (item.type !== '通用' && itemArea !== targetArea) continue;

            // 🔴 檢查是否為變速箱相關症狀
            const isTransmissionRelated = item.type === '手排變速箱' || item.type === '自排變速箱';

            // 🔴 如果是變速箱相關且變速箱類型未知，記錄到 symptomsByTransmission
            if (isTransmissionRelated && transmissionTypeUnknown) {
                const transmissionKey = item.type; // '手排變速箱' or '自排變速箱'
                symptomsByTransmission[transmissionKey].push({
                    problem: item.problem,
                    explanation: item.explanation,
                    solutions: item.solutions || [],
                    type: item.type,
                    hasProduct: item.hasProduct !== false
                });
                continue; // 繼續收集，稍後判斷是否需要追問變速箱類型
            }

            // 🔴 如果是變速箱相關且變速箱類型已知，只匹配對應的變速箱類型
            if (isTransmissionRelated && !transmissionTypeUnknown) {
                const normalizedTransmission = transmissionType.includes('手排') ? '手排變速箱' : '自排變速箱';
                if (item.type !== normalizedTransmission) continue;
            }

            // 如果有指定 fuelType，只匹配對應的燃油類型（排除變速箱項目）
            if (fuelType && !isTransmissionRelated) {
                const itemFuelType = item.type;
                if (fuelType === '汽油' && itemFuelType !== '汽油引擎' && itemFuelType !== '通用') {
                    continue;
                }
                if (fuelType === '柴油' && itemFuelType !== '柴油引擎' && itemFuelType !== '通用') {
                    continue;
                }
            }

            // 🔴 新增：將 SKU 對應到產品名稱
            const solutionsWithNames = (item.solutions || []).map(sku => ({
                sku: sku,
                name: skuToProduct[sku] || sku
            }));

            const matchResult = {
                problem: item.problem,
                explanation: item.explanation,
                solutions: item.solutions || [],
                solutionsWithNames: solutionsWithNames,
                type: item.type,
                hasProduct: item.hasProduct !== false
            };

            if (item.hasProduct === false) {
                noProductMatched.push(matchResult);
            } else {
                matched.push(matchResult);
            }
        }
    }

    // 🔴 車型未知時：判斷是否需要追問
    if (vehicleTypeUnknown) {
        const carMatches = symptomsByArea['汽車'] || [];
        const bikeMatches = symptomsByArea['機車'] || [];

        // 如果同一症狀在汽車和機車都有匹配，且解決方案不同 → 需要追問
        if (carMatches.length > 0 && bikeMatches.length > 0) {
            console.log(`${LOG_TAGS.ANALYZE} 症狀「${detectedSymptom}」在汽車和機車都有匹配，需要追問車型`);
            return {
                items: [],
                needsVehicleType: true,
                needsTransmissionType: false,
                detectedSymptom: detectedSymptom,
                carOptions: carMatches.slice(0, 3),
                bikeOptions: bikeMatches.slice(0, 3)
            };
        }

        // 如果只在一個區域有匹配，直接使用該區域的結果
        if (carMatches.length > 0) {
            matched.push(...carMatches.filter(m => m.hasProduct));
            noProductMatched.push(...carMatches.filter(m => !m.hasProduct));
        } else if (bikeMatches.length > 0) {
            matched.push(...bikeMatches.filter(m => m.hasProduct));
            noProductMatched.push(...bikeMatches.filter(m => !m.hasProduct));
        }
    }

    // 🔴 變速箱類型未知時：判斷是否需要追問（手排/自排）
    const manualMatches = symptomsByTransmission['手排變速箱'] || [];
    const autoMatches = symptomsByTransmission['自排變速箱'] || [];

    if (manualMatches.length > 0 || autoMatches.length > 0) {
        // 如果手排和自排都有匹配，需要追問
        if (manualMatches.length > 0 && autoMatches.length > 0) {
            console.log(`${LOG_TAGS.ANALYZE} 變速箱症狀「${detectedSymptom}」在手排和自排都有匹配，需要追問變速箱類型`);
            return {
                items: [],
                needsVehicleType: false,
                needsTransmissionType: true,
                detectedSymptom: detectedSymptom,
                manualOptions: manualMatches.slice(0, 3),
                autoOptions: autoMatches.slice(0, 3)
            };
        }

        // 如果只有一種變速箱類型有匹配，直接使用該結果
        if (manualMatches.length > 0) {
            matched.push(...manualMatches.filter(m => m.hasProduct));
            noProductMatched.push(...manualMatches.filter(m => !m.hasProduct));
        } else if (autoMatches.length > 0) {
            matched.push(...autoMatches.filter(m => m.hasProduct));
            noProductMatched.push(...autoMatches.filter(m => !m.hasProduct));
        }
    }

    // 返回結果
    const result = matched.slice(0, 3);

    if (noProductMatched.length > 0 && matched.length === 0) {
        console.log(`${LOG_TAGS.ANALYZE} AdditiveGuide matched ${noProductMatched.length} items with hasProduct=false`);
        return {
            items: noProductMatched.slice(0, 3),
            needsVehicleType: false,
            needsTransmissionType: false,
            detectedSymptom: detectedSymptom
        };
    }

    return {
        items: result,
        needsVehicleType: false,
        needsTransmissionType: false,
        detectedSymptom: detectedSymptom
    };
}

/**
 * 根據 AI 分析結果生成 Wix 查詢
 * v2.2: 按 productCategory 分流搜尋，避免類別間關鍵字污染
 */
function generateWixQueries(analysis) {
    const queries = [];
    const vehicles = analysis.vehicles || [];
    const productCategory = analysis.productCategory;

    // 從知識庫讀取搜尋資料（RAG 架構）
    const oilOnlyKeywords = getOilOnlyKeywords();
    const categoryToSort = getCategoryToSort();

    /**
     * 檢查關鍵字是否為機油專用
     */
    function isOilOnlyKeyword(kw) {
        const lowerKw = kw.toLowerCase();
        return oilOnlyKeywords.some(ok => lowerKw.includes(ok));
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

        // === 變速箱油專用搜尋（按認證搜尋 cert 欄位）===
        else if (productCategory === '變速箱油') {
            // 先按 sort 分類
            queries.push({ field: 'sort', value: '變速箱', limit: 30, method: 'contains' });

            // 按認證搜尋 cert 欄位（AI 推論的認證）
            const certs = vehicle.certifications || [];
            for (const cert of certs) {
                queries.push({ field: 'cert', value: cert, limit: 20, method: 'contains' });
                queries.push({ field: 'title', value: cert, limit: 20, method: 'contains' });
                // 認證變體搜尋（移除空格）
                const certNoSpace = cert.replace(/\s+/g, '');
                if (certNoSpace !== cert) {
                    queries.push({ field: 'cert', value: certNoSpace, limit: 20, method: 'contains' });
                }
            }

            // 通用關鍵字搜尋
            queries.push({ field: 'title', value: 'ATF', limit: 30, method: 'contains' });
            queries.push({ field: 'title', value: 'Top Tec', limit: 20, method: 'contains' });
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

    console.log(`${LOG_TAGS.ANALYZE} Generated ${uniqueQueries.length} Wix queries for category: ${productCategory}`);
    return uniqueQueries;
}

/**
 * 從知識庫動態生成 AI 分析規則提示詞
 * P0 優化：使用統一的 motorcycle-rules 服務
 * @returns {string} 分析規則提示詞
 */
function buildAnalysisPromptRules() {
    const rules = aiAnalysisRules;
    if (!rules || Object.keys(rules).length === 0) {
        // 如果知識庫未載入，使用統一的摩托車規則
        return buildJasoRulesPrompt() + buildSearchKeywordRulesPrompt();
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
⚠️ **重要：只有在用戶明確詢問添加劑或描述車輛症狀時才套用此規則！**
⚠️ **如果用戶只是問機油推薦（如「跑山推薦哪款機油」），禁止主動提及添加劑！**

當用戶確實需要添加劑時：
- 柴油車 → 優先推薦 Diesel 系列添加劑
- 激烈操駕/跑山/賽道 → 推薦 Engine Flush 清積碳、MoS2 抗磨損
- 長途旅行 → 推薦 Oil Additive 機油添加劑保護引擎
- 高里程/老車 → 推薦 Oil Leak Stop 止漏、Valve Clean 汽門清潔
- 嚴重症狀 → 優先推薦 Pro-Line 系列（強效）

【⚠️ 添加劑追問規則 - 智慧判斷！】
知識庫添加劑按「area」(汽車/機車) 和「type」(汽油引擎/柴油引擎/變速箱) 分類。

**追問原則：**
1. **已知車型** → 從對話歷史繼承 area 和 type，不重複追問！
   - 例：前面說「2018 Elantra 汽油」→ 直接用 area=汽車、type=汽油引擎
2. **同症狀不同引擎解法相同** → 不追問燃油類型
   - 例：「活塞環吃機油」汽油柴油都用 LM1019，不問燃油類型
3. **同症狀不同引擎解法不同** → 需追問燃油類型
   - 例：「怠速抖動」汽油用 LM5129，柴油用 LM2504，需確認
4. **只有汽車有此症狀** → 直接當汽車處理
   - 例：「自排換檔延遲」→ 機車沒自排，直接推薦汽車添加劑
5. **只有機車有此症狀** → 直接當機車處理
6. **系統無對應產品時** → 誠實告知「目前沒有對應的解決產品」
   - 例：「代鉛劑」「方向機異音」等 hasProduct=false 的項目
   - ⛔ 禁止幻覺生成假產品！
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

// CommonJS 導出 - 同時導出 handler（API）和 analyzeUserQuery（供 rag-pipeline 呼叫）
module.exports = handler;
module.exports.analyzeUserQuery = analyzeUserQuery;
