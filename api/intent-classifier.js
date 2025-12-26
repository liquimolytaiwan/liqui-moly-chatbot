/**
 * LIQUI MOLY Chatbot - RAG 意圖分類器
 * 快速判斷用戶問題類型，決定需要載入哪些知識
 */

const fs = require('fs');
const path = require('path');

// 載入分類規則
let classificationRules = {};
let specialScenarios = {};

try {
    const specsPath = path.join(process.cwd(), 'data', 'knowledge', 'vehicle-specs.json');
    const vehicleSpecs = JSON.parse(fs.readFileSync(specsPath, 'utf-8'));

    if (vehicleSpecs._metadata) {
        classificationRules = vehicleSpecs._metadata;
        specialScenarios = vehicleSpecs._metadata.special_scenarios || {};
    }

    console.log('[IntentClassifier] Rules loaded from vehicle-specs.json');
} catch (e) {
    console.warn('[IntentClassifier] Failed to load rules:', e.message);
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
        type: 'general_inquiry',  // 預設類型
        vehicleType: null,
        vehicleModel: null,
        vehicleBrand: null,
        productCategory: null,
        isElectricVehicle: false,
        isMotorcycle: false,
        isMultiVehicle: false,
        needsSpecs: false,
        needsSymptoms: false,
        needsTemplates: [],
        specialScenario: null,
        detectedKeywords: []
    };

    // === 1. 車型偵測 ===
    detectVehicleType(combinedText, intent);

    // === 2. 電動車偵測 ===
    detectElectricVehicle(lowerMessage, intent);

    // === 3. 產品類別偵測 ===
    detectProductCategory(lowerMessage, intent);

    // === 4. 意圖類型偵測 ===
    detectIntentType(lowerMessage, intent);

    // === 5. 特殊情境偵測 ===
    detectSpecialScenario(lowerMessage, intent);

    // === 6. 決定需要載入的知識 ===
    determineRequiredKnowledge(intent);

    console.log('[IntentClassifier] Result:', JSON.stringify(intent, null, 2));
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

    // 預設為機油
    if (!intent.productCategory) {
        intent.productCategory = '機油';
    }
}

/**
 * 偵測意圖類型
 */
function detectIntentType(text, intent) {
    // 購買相關
    const purchaseKeywords = ['哪裡買', '店家', '經銷商', '門市', '實體店', '購買', '想買', '怎麼買', '附近'];
    for (const kw of purchaseKeywords) {
        if (text.includes(kw)) {
            intent.type = 'purchase_inquiry';
            intent.needsTemplates.push('purchase_inquiry');
            return;
        }
    }

    // 合作洽詢
    const cooperationKeywords = ['合作', '經銷', '代理', '進貨', '批發', '贊助', 'KOL', '網紅'];
    for (const kw of cooperationKeywords) {
        if (text.includes(kw)) {
            intent.type = 'cooperation_inquiry';
            intent.needsTemplates.push('cooperation_inquiry');
            return;
        }
    }

    // 價格查詢
    const priceKeywords = ['多少錢', '價格', '售價', '價位'];
    for (const kw of priceKeywords) {
        if (text.includes(kw)) {
            intent.type = 'price_inquiry';
            intent.needsTemplates.push('price_inquiry');
            return;
        }
    }

    // 防偽驗證
    const authKeywords = ['真假', '正品', '假貨', '仿冒', '驗證', '防偽'];
    for (const kw of authKeywords) {
        if (text.includes(kw)) {
            intent.type = 'authentication';
            intent.needsTemplates.push('authentication');
            return;
        }
    }

    // 產品推薦（預設）
    intent.type = 'product_recommendation';
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
    if (intent.type === 'product_recommendation' &&
        intent.vehicleType === '汽車' &&
        intent.productCategory === '機油') {
        intent.needsSpecs = true;
    }

    // 症狀映射
    if (intent.productCategory === '添加劑') {
        intent.needsSymptoms = true;
    }
}

module.exports = {
    classifyIntent
};
