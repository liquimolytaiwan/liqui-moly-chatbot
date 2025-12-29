/**
 * LIQUI MOLY Chatbot - RAG 知識檢索器
 * 根據意圖動態載入相關知識
 * 
 * P1 優化：使用統一的 knowledge-cache 模組
 */

const { loadJSON } = require('./knowledge-cache');


/**
 * 根據意圖檢索知識
 * @param {Object} intent - 意圖分析結果
 * @returns {Object} - 檢索到的知識
 */
async function retrieveKnowledge(intent) {
    const knowledge = {
        core: null,
        vehicleSpec: null,
        certification: null,
        symptoms: null,
        templates: {},
        rules: {},
        specialScenario: null
    };

    // 1. 永遠載入核心身份（精簡版）
    knowledge.core = loadJSON('core-identity.json');

    // 2. 載入 AI 分析與繼承規則
    knowledge.rules.analysis = loadJSON('ai-analysis-rules.json');

    // 3. 根據需求載入車型規格
    if (intent.needsSpecs && intent.vehicleBrand) {
        knowledge.vehicleSpec = getVehicleSpec(intent.vehicleBrand, intent.vehicleModel);
    }

    // 4. 根據產品類別載入相關認證
    if (intent.productCategory === '機油') {
        knowledge.certification = getCertificationForVehicle(intent);
    }

    // 5. 症狀映射（從 additive-guide.json 讀取）
    if (intent.needsSymptoms) {
        knowledge.symptoms = loadJSON('additive-guide.json');
    }

    // 6. 載入回覆範本
    const templates = loadJSON('response-templates.json');
    for (const templateKey of intent.needsTemplates) {
        if (templates && templates[templateKey]) {
            knowledge.templates[templateKey] = templates[templateKey];
        }
    }

    // 7. 特殊情境
    if (intent.specialScenario) {
        knowledge.specialScenario = getSpecialScenarioData(intent.specialScenario);
    }

    // 8. 載入統一 URL
    knowledge.urls = loadJSON('urls.json');

    console.log('[KnowledgeRetriever] Retrieved knowledge keys:', Object.keys(knowledge).filter(k => knowledge[k] !== null));
    return knowledge;
}

/**
 * 取得車型規格
 */
function getVehicleSpec(brand, model) {
    const allSpecs = loadJSON('vehicle-specs.json');
    if (!allSpecs) return null;

    const brandSpecs = allSpecs[brand];
    if (!brandSpecs) return null;

    if (model) {
        // 精確匹配
        for (const [modelName, specs] of Object.entries(brandSpecs)) {
            if (modelName.toLowerCase().includes(model.toLowerCase()) ||
                model.toLowerCase().includes(modelName.toLowerCase())) {
                return { brand, model: modelName, specs };
            }
        }
    }

    // 返回品牌所有車型供 AI 選擇
    return { brand, allModels: brandSpecs };
}

/**
 * 根據用戶訊息智慧匹配車型規格
 * 使用 aliases 欄位進行模糊匹配
 * @param {string} message - 用戶訊息
 * @returns {Object|null} - 匹配到的車型規格
 */
function findVehicleByMessage(message) {
    const allSpecs = loadJSON('vehicle-specs.json');
    if (!allSpecs) return null;

    const lowerMessage = message.toLowerCase();

    // 遍歷所有品牌和車型
    for (const [brand, models] of Object.entries(allSpecs)) {
        // 跳過 _metadata 等非車型資料
        if (brand.startsWith('_')) continue;
        if (!models || typeof models !== 'object') continue;

        for (const [modelName, specs] of Object.entries(models)) {
            // 確保 specs 是陣列才進行迭代
            if (!Array.isArray(specs)) continue;

            for (const spec of specs) {
                // 檢查 aliases
                if (spec.aliases && Array.isArray(spec.aliases)) {
                    for (const alias of spec.aliases) {
                        if (lowerMessage.includes(alias.toLowerCase())) {
                            console.log(`[KnowledgeRetriever] Matched vehicle: ${brand} ${modelName} via alias "${alias}"`);
                            return {
                                brand,
                                model: modelName,
                                spec,
                                matchedAlias: alias
                            };
                        }
                    }
                }
            }
        }
    }

    return null;
}


/**
 * 取得車輛適用的認證
 */
function getCertificationForVehicle(intent) {
    const vehicleSpecs = loadJSON('vehicle-specs.json');
    if (!vehicleSpecs || !vehicleSpecs._metadata) return null;

    const metadata = vehicleSpecs._metadata;
    const result = {};

    // Ford 特殊處理
    if (intent.vehicleBrand === 'Ford' && metadata.special_certifications?.ford) {
        result.ford = metadata.special_certifications.ford;
    }

    // JASO 規則
    if (intent.isMotorcycle && metadata.jaso_rules) {
        result.jaso = metadata.jaso_rules;
    }

    return Object.keys(result).length > 0 ? result : null;
}

/**
 * 取得特殊情境資料
 */
function getSpecialScenarioData(scenario) {
    const vehicleSpecs = loadJSON('vehicle-specs.json');
    const scenarios = vehicleSpecs?._metadata?.special_scenarios;
    if (!scenarios) return null;

    if (scenario === 'pure_ev_motorcycle' || scenario === 'pure_ev_car') {
        return scenarios.pure_ev;
    }

    return null;
}

module.exports = {
    retrieveKnowledge,
    loadJSON,
    findVehicleByMessage
};
