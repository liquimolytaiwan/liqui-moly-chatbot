/**
 * LIQUI MOLY Chatbot - RAG 知識檢索器
 * 根據意圖動態載入相關知識
 */

const fs = require('fs');
const path = require('path');

// 知識庫快取
const knowledgeCache = {};

/**
 * 載入 JSON 檔案
 */
function loadJSON(filename) {
    const cacheKey = filename;
    if (knowledgeCache[cacheKey]) {
        return knowledgeCache[cacheKey];
    }

    try {
        const filePath = path.join(process.cwd(), 'data', 'knowledge', filename);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        knowledgeCache[cacheKey] = data;
        return data;
    } catch (e) {
        console.warn(`[KnowledgeRetriever] Failed to load ${filename}:`, e.message);
        return null;
    }
}

/**
 * 載入規則 JSON
 */
function loadRule(filename) {
    try {
        const filePath = path.join(process.cwd(), 'data', 'knowledge', 'rules', filename);
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
        console.warn(`[KnowledgeRetriever] Failed to load rule ${filename}:`, e.message);
        return null;
    }
}

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

    // 2. 載入對話規則
    knowledge.rules.conversation = loadRule('conversation-rules.json');

    // 3. 根據需求載入車型規格
    if (intent.needsSpecs && intent.vehicleBrand) {
        knowledge.vehicleSpec = getVehicleSpec(intent.vehicleBrand, intent.vehicleModel);
    }

    // 4. 根據產品類別載入相關認證
    if (intent.productCategory === '機油') {
        knowledge.certification = getCertificationForVehicle(intent);
    }

    // 5. 症狀映射
    if (intent.needsSymptoms) {
        knowledge.symptoms = loadJSON('symptoms.json');
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
 * 取得車輛適用的認證
 */
function getCertificationForVehicle(intent) {
    const certData = loadJSON('certifications.json');
    if (!certData || !certData.certifications) return null;

    const result = {};

    // Ford 特殊處理
    if (intent.vehicleBrand === 'Ford') {
        result.ford = certData.certifications.ford;
    }

    // 歐系車
    if (['BMW', 'Mercedes-Benz', 'Volvo', 'VW', 'Audi'].includes(intent.vehicleBrand)) {
        result.european = certData.certifications.european;
    }

    // 日韓系車
    if (['Toyota', 'Lexus', 'Honda', 'Nissan', 'Mazda', 'Hyundai', 'Kia'].includes(intent.vehicleBrand)) {
        result.asian = certData.certifications.asian;
    }

    // 機車
    if (intent.isMotorcycle) {
        result.motorcycle = certData.certifications.motorcycle;
    }

    return Object.keys(result).length > 0 ? result : null;
}

/**
 * 取得特殊情境資料
 */
function getSpecialScenarioData(scenario) {
    const scenarios = loadRule('special-scenarios.json');
    if (!scenarios) return null;

    switch (scenario) {
        case 'pure_ev_motorcycle':
            return scenarios.electric_vehicle?.pure_ev_motorcycles;
        case 'pure_ev_car':
            return scenarios.electric_vehicle?.pure_ev_cars;
        case 'hybrid':
            return scenarios.electric_vehicle?.hybrid;
        case 'high_mileage':
            return scenarios.high_mileage;
        case 'harley':
            return scenarios.motorcycle_types?.harley;
        default:
            return null;
    }
}

module.exports = {
    retrieveKnowledge,
    loadJSON,
    loadRule
};
