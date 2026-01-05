/**
 * LIQUI MOLY Chatbot - RAG 知識檢索器
 * 根據意圖動態載入相關知識
 *
 * P0 優化：使用統一服務模組
 * - vehicle-matcher.js: 車型匹配（取代 findVehicleByMessage）
 * - certification-matcher.js: 認證匹配（取代 getCertificationForVehicle）
 * - constants.js: 統一常數
 */

const { loadJSON } = require('./knowledge-cache');
const { getVehicleSpec } = require('./vehicle-matcher');
const { getCertificationForVehicle, getJasoCertification } = require('./certification-matcher');
const { LOG_TAGS, PRODUCT_CATEGORIES } = require('./constants');


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
        specialScenario: null,
        antiHallucination: null  // 新增：反幻覺規則
    };

    // 1. 永遠載入核心身份（精簡版）
    knowledge.core = loadJSON('core-identity.json');

    // 2. 載入 AI 分析與繼承規則
    knowledge.rules.analysis = loadJSON('ai-analysis-rules.json');

    // 3. 根據需求載入車型規格（使用統一服務）
    if (intent.needsSpecs && intent.vehicleBrand) {
        knowledge.vehicleSpec = getVehicleSpec(intent.vehicleBrand, intent.vehicleModel);
    }

    // 4. 根據產品類別載入相關認證（使用統一服務）
    if (intent.productCategory === PRODUCT_CATEGORIES.OIL) {
        knowledge.certification = getCertificationForVehicle(intent);

        // 摩托車額外載入 JASO 規則
        if (intent.isMotorcycle) {
            knowledge.jasoCert = getJasoCertification(intent.isScooter);
        }
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

    // 9. 載入反幻覺規則（Anti-Hallucination）
    knowledge.antiHallucination = loadJSON('anti-hallucination-rules.json');

    // 10. 非機油類別規格（按需載入）- 變速箱油、煞車系統、冷卻系統等
    const specialCategories = ['變速箱油', '煞車系統', '冷卻系統', '空調系統', '化學品', '美容', '香氛', '自行車'];
    if (intent.productCategory && specialCategories.includes(intent.productCategory)) {
        const categorySpecs = loadJSON('category-specs.json');
        if (categorySpecs && categorySpecs[intent.productCategory]) {
            knowledge.categorySpec = categorySpecs[intent.productCategory];
            console.log(`[KnowledgeRetriever] Loaded category spec for: ${intent.productCategory}`);
        }
    }

    console.log(`${LOG_TAGS.KNOWLEDGE} Retrieved knowledge keys:`, Object.keys(knowledge).filter(k => knowledge[k] !== null));
    return knowledge;
}

// findVehicleByMessage() 已廢棄，請直接使用 vehicle-matcher.matchVehicle()

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
    retrieveKnowledge
    // loadJSON 請從 knowledge-cache.js 導入
    // findVehicleByMessage 已廢棄，請使用 vehicle-matcher.matchVehicle()
};
