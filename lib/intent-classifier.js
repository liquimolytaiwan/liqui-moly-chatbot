/**
 * LIQUI MOLY Chatbot - RAG 意圖分類器
 * 快速判斷用戶問題類型，決定需要載入哪些知識
 *
 * P0 優化：使用統一服務模組
 * - vehicle-matcher.js: 車型匹配
 * - motorcycle-rules.js: 摩托車規則
 * - constants.js: 統一常數
 */

const { loadJSON } = require('./knowledge-cache');
const { matchVehicle, getMetadata } = require('./vehicle-matcher');
const { isScooter } = require('./motorcycle-rules');
const { LOG_TAGS, INTENT_TYPES, PRODUCT_CATEGORIES } = require('./constants');

// 載入分類規則（使用統一快取）
let classificationRules = {};
let specialScenarios = {};

try {
    const metadata = getMetadata();
    classificationRules = metadata;
    specialScenarios = metadata.special_scenarios || {};
    console.log(`${LOG_TAGS.INTENT} Rules loaded via vehicle-matcher`);
} catch (e) {
    console.warn(`${LOG_TAGS.INTENT} Failed to load rules:`, e.message);
}

/**
 * 分類用戶意圖
 * @param {string} message - 用戶訊息
 * @param {Array} conversationHistory - 對話歷史
 * @returns {Object} - 意圖分析結果
 */
function classifyIntent(message, conversationHistory = []) {
    const lowerMessage = message.toLowerCase();
    const historyText = conversationHistory.map(m => m.content).join(' ').toLowerCase();
    const combinedText = `${lowerMessage} ${historyText}`;

    const intent = {
        type: INTENT_TYPES.GENERAL_INQUIRY,  // 預設類型
        vehicleType: null,
        vehicleModel: null,
        vehicleBrand: null,
        productCategory: null,
        isElectricVehicle: false,
        isMotorcycle: false,
        isScooter: false,
        isMultiVehicle: false,
        needsSpecs: false,
        needsSymptoms: false,
        needsTemplates: [],
        specialScenario: null,
        detectedKeywords: [],
        certifications: [],
        viscosity: null
    };

    // === 1. 車型偵測（使用統一服務）===
    const vehicleMatch = matchVehicle(message, historyText);
    if (vehicleMatch.matched) {
        intent.vehicleType = vehicleMatch.vehicleType;
        intent.vehicleModel = vehicleMatch.vehicleModel;
        intent.vehicleBrand = vehicleMatch.vehicleBrand;
        intent.isMotorcycle = vehicleMatch.isMotorcycle;
        intent.isScooter = vehicleMatch.isScooter;
        intent.isElectricVehicle = vehicleMatch.isElectricVehicle;
        intent.detectedKeywords = vehicleMatch.detectedKeywords;
        intent.certifications = vehicleMatch.certifications;
        intent.viscosity = vehicleMatch.viscosity;

        // 如果有完整規格，標記需要規格
        if (vehicleMatch.spec) {
            intent.needsSpecs = true;
        }
    } else {
        // Fallback: 使用原有邏輯（向後兼容）
        detectVehicleType(combinedText, intent);
        detectElectricVehicle(lowerMessage, intent);
    }

    // === 2. 產品類別偵測 ===
    detectProductCategory(lowerMessage, intent);

    // === 3. 意圖類型偵測 ===
    detectIntentType(lowerMessage, intent);

    // === 4. 特殊情境偵測 ===
    detectSpecialScenario(lowerMessage, intent);

    // === 5. 決定需要載入的知識 ===
    determineRequiredKnowledge(intent);

    console.log(`${LOG_TAGS.INTENT} Result:`, JSON.stringify(intent, null, 2));
    return intent;
}

/**
 * 偵測車型類型
 */
function detectVehicleType(text, intent) {
    const vehicleTypes = classificationRules.vehicle_types || {};

    // 檢查摩托車
    const motorcycleData = vehicleTypes.motorcycle || {};
    const motorcycleKeywords = motorcycleData.keywords || [];
    const motorcycleModels = motorcycleData.specific_models || {};

    // 檢查摩托車關鍵字
    for (const kw of motorcycleKeywords) {
        if (text.includes(kw.toLowerCase())) {
            intent.vehicleType = '摩托車';
            intent.isMotorcycle = true;
            intent.detectedKeywords.push(kw);
            break;
        }
    }

    // 檢查具體摩托車車型
    for (const [brand, models] of Object.entries(motorcycleModels)) {
        for (const model of models) {
            const modelLower = model.toLowerCase().replace(/-/g, '');
            const textNormalized = text.replace(/-/g, '').replace(/\s/g, '');
            if (textNormalized.includes(modelLower)) {
                intent.vehicleType = '摩托車';
                intent.isMotorcycle = true;
                intent.vehicleBrand = brand;
                intent.vehicleModel = model;
                intent.detectedKeywords.push(model);
                return;
            }
        }
    }

    // 檢查汽車
    const carData = vehicleTypes.car || {};
    const carKeywords = carData.keywords || [];
    const carBrands = carData.specific_brands || [];

    for (const kw of carKeywords) {
        if (text.includes(kw.toLowerCase())) {
            intent.vehicleType = '汽車';
            intent.detectedKeywords.push(kw);
            break;
        }
    }

    for (const brand of carBrands) {
        if (text.includes(brand.toLowerCase())) {
            intent.vehicleType = '汽車';
            intent.vehicleBrand = brand;
            intent.detectedKeywords.push(brand);
            break;
        }
    }

    // 檢查船舶
    const marineKeywords = vehicleTypes.marine?.keywords || [];
    for (const kw of marineKeywords) {
        if (text.includes(kw.toLowerCase())) {
            intent.vehicleType = '船舶';
            intent.detectedKeywords.push(kw);
            break;
        }
    }

    // 檢查自行車
    const bicycleKeywords = vehicleTypes.bicycle?.keywords || [];
    for (const kw of bicycleKeywords) {
        if (text.includes(kw.toLowerCase())) {
            intent.vehicleType = '自行車';
            intent.detectedKeywords.push(kw);
            break;
        }
    }

    // 預設為汽車
    if (!intent.vehicleType) {
        intent.vehicleType = '汽車';
    }
}

/**
 * 偵測電動車
 */
function detectElectricVehicle(text, intent) {
    const evData = specialScenarios.electric_vehicle || {};

    // 純電機車
    const evMotorcycleKeywords = evData.pure_ev_motorcycles?.keywords || [];
    for (const kw of evMotorcycleKeywords) {
        if (text.includes(kw.toLowerCase())) {
            intent.isElectricVehicle = true;
            intent.specialScenario = 'pure_ev_motorcycle';
            return;
        }
    }

    // 純電汽車
    const evCarKeywords = evData.pure_ev_cars?.keywords || [];
    for (const kw of evCarKeywords) {
        if (text.includes(kw.toLowerCase())) {
            intent.isElectricVehicle = true;
            intent.specialScenario = 'pure_ev_car';
            return;
        }
    }

    // 油電混合（仍需機油）
    const hybridKeywords = evData.hybrid?.keywords || [];
    for (const kw of hybridKeywords) {
        if (text.includes(kw.toLowerCase())) {
            intent.specialScenario = 'hybrid';
            return;
        }
    }
}

/**
 * 偵測產品類別
 * 🔧 修改：不預設為機油，若用戶未指定產品類別則保持 null，由 AI 追問
 */
function detectProductCategory(text, intent) {
    const categories = classificationRules.product_categories || {};

    for (const [category, data] of Object.entries(categories)) {
        const keywords = data.keywords || [];
        for (const kw of keywords) {
            if (text.includes(kw.toLowerCase())) {
                intent.productCategory = category;
                intent.detectedKeywords.push(kw);
                return;
            }
        }
    }

    // 🔧 修改：不預設為機油，讓 AI 追問需要推薦哪類產品
    // 原本：intent.productCategory = '機油';
    // 現在：保持 null，由後續流程決定是否追問
}

/**
 * 偵測意圖類型
 * 從 intent-keywords.json 動態載入關鍵字
 */
function detectIntentType(text, intent) {
    // 從知識庫載入意圖關鍵字
    const intentKeywordsData = loadJSON('intent-keywords.json');
    const intentKeywords = intentKeywordsData?.intent_keywords || {};

    // 依優先順序檢查各類意圖（與 intent-converter.js 統一）
    // 優先順序說明：authentication > cooperation > purchase > price
    // - authentication: 帳號相關最優先（避免誤判為其他意圖）
    // - cooperation: 合作洽詢優先於購買（避免店家查詢誤導）
    // - purchase: 購買地點查詢
    // - price: 價格查詢最後（最常與產品推薦混合）
    const intentOrder = ['authentication', 'cooperation_inquiry', 'purchase_inquiry', 'price_inquiry'];

    for (const intentType of intentOrder) {
        const config = intentKeywords[intentType];
        if (!config || !config.keywords) continue;

        for (const kw of config.keywords) {
            if (text.includes(kw.toLowerCase())) {
                intent.type = intentType;
                intent.needsTemplates.push(config.template || intentType);
                return;
            }
        }
    }

    // 預設為產品推薦
    intent.type = INTENT_TYPES.PRODUCT_RECOMMENDATION;
    intent.needsTemplates.push('product_recommendation');
}

/**
 * 偵測特殊情境
 */
function detectSpecialScenario(text, intent) {
    // 高里程車
    const highMileageKeywords = specialScenarios.high_mileage?.trigger?.keywords || [];
    for (const kw of highMileageKeywords) {
        if (text.includes(kw)) {
            intent.specialScenario = 'high_mileage';
            return;
        }
    }

    // Harley
    const harleyKeywords = specialScenarios.motorcycle_types?.harley?.keywords || [];
    for (const kw of harleyKeywords) {
        if (text.includes(kw.toLowerCase())) {
            intent.specialScenario = 'harley';
            intent.vehicleType = '摩托車';
            intent.isMotorcycle = true;
            return;
        }
    }
}

/**
 * 決定需要載入的知識
 */
function determineRequiredKnowledge(intent) {
    // 車型規格
    if (intent.type === INTENT_TYPES.PRODUCT_RECOMMENDATION &&
        intent.vehicleType === '汽車' &&
        intent.productCategory === PRODUCT_CATEGORIES.OIL) {
        intent.needsSpecs = true;
    }

    // 症狀映射
    if (intent.productCategory === PRODUCT_CATEGORIES.ADDITIVE) {
        intent.needsSymptoms = true;
    }

    // 摩托車規格
    if (intent.isMotorcycle && intent.productCategory === PRODUCT_CATEGORIES.OIL) {
        intent.needsSpecs = true;
    }
}

module.exports = {
    classifyIntent
};
