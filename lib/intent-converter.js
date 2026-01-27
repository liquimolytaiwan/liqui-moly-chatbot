/**
 * LIQUI MOLY Chatbot - RAG Intent Converter
 * 將 analyze.js 的 AI 分析結果轉換為 intent 格式
 *
 * 用於「AI 優先、規則備援」混合架構
 * v1.1: 從 intent-keywords.json 載入關鍵字，減少硬編碼
 * v1.2: 優化 - 模組級快取避免重複載入
 */

const { loadJSON } = require('./knowledge-cache');

// ============================================
// 模組級快取 - 避免同檔案內重複載入
// ============================================
let _intentKeywordsCache = null;

/**
 * 取得 intent-keywords.json（帶模組級快取）
 */
function getIntentKeywords() {
    if (!_intentKeywordsCache) {
        _intentKeywordsCache = loadJSON('intent-keywords.json') || {};
    }
    return _intentKeywordsCache;
}

/**
 * 將 AI 分析結果轉換為 intent 格式
 * @param {Object} aiResult - analyze.js 的 AI 分析結果
 * @returns {Object} - 標準 intent 格式
 */
function convertAIResultToIntent(aiResult) {
    if (!aiResult) {
        return null;
    }

    const vehicle = aiResult.vehicles?.[0] || {};

    // 🔧 修改：不預設產品類別，若用戶未指定則需追問
    // 原本：needsProduct ? '機油' : null
    // 現在：保持 AI 返回的 productCategory，不自動預設
    const needsProduct = aiResult.needsProductRecommendation ||
        aiResult.intentType === 'product_recommendation' ||
        aiResult.intentType === 'price_inquiry';
    const productCategory = aiResult.productCategory || null;

    // 如果需要產品推薦但沒指定類別，標記需追問
    const needsProductCategoryQuestion = needsProduct && !productCategory;

    const isMotorcycle = vehicle.vehicleType === '摩托車';

    // 判斷意圖類型（優先使用 AI 返回的 intentType）
    let intentType = aiResult.intentType;

    // 如果 AI 沒有設定 intentType，進行備援判斷
    if (!intentType) {
        if (aiResult.needsProductRecommendation) {
            intentType = 'product_recommendation';
        } else {
            // 預設為一般諮詢（包含「只提供車型但沒說需求」的情況）
            intentType = 'general_inquiry';
        }
    }

    // 根據 intentType 設定 needsTemplates
    const intentToTemplate = {
        'authentication': ['authentication'],
        'price_inquiry': ['price_inquiry'],
        'purchase_inquiry': ['purchase_inquiry'],
        'cooperation_inquiry': ['cooperation_inquiry'],
        'product_recommendation': ['product_recommendation'],
        'general_inquiry': []
    };
    const needsTemplates = intentToTemplate[intentType] || ['product_recommendation'];

    // 判斷特殊情境
    let specialScenario = null;
    if (vehicle.isElectricVehicle) {
        specialScenario = isMotorcycle ? 'pure_ev_motorcycle' : 'pure_ev_car';
    }
    // 檢查 Harley
    const vehicleName = (vehicle.vehicleName || '').toLowerCase();
    if (vehicleName.includes('harley') || vehicleName.includes('哈雷')) {
        specialScenario = 'harley';
    }

    // 建構 intent 物件
    const intent = {
        type: intentType,
        vehicleType: vehicle.vehicleType || null,  // 不預設，讓 AI 判斷是否追問
        vehicleModel: vehicle.vehicleName || null,
        vehicleBrand: extractBrandFromVehicleName(vehicle.vehicleName),
        productCategory: productCategory,
        isElectricVehicle: vehicle.isElectricVehicle || false,
        isMotorcycle: isMotorcycle,
        isMultiVehicle: aiResult.isMultiVehicleQuery || false,
        needsSpecs: productCategory === '機油' && !isMotorcycle,
        needsSymptoms: productCategory === '添加劑',
        needsTemplates: needsTemplates,
        specialScenario: specialScenario,
        detectedKeywords: aiResult.searchKeywords || [],

        // ⚡ 新增：提取 needsMoreInfo 到 intent 顶层
        needsMoreInfo: aiResult.needsMoreInfo || [],

        // 🔧 新增：標記需追問產品類別
        needsProductCategoryQuestion: needsProductCategoryQuestion,

        // 🚨 關鍵修復：傳遞 needsProductRecommendation 標記
        needsProductRecommendation: needsProduct,

        // 🚨 SKU 查詢標記
        isSKUQuery: aiResult.isSKUQuery || false,
        queriedSKU: aiResult.queriedSKU || null,

        // 保留 AI 分析的完整資訊供後續使用
        _aiAnalysis: aiResult
    };

    // 處理認證資訊
    if (vehicle.certifications && vehicle.certifications.length > 0) {
        intent.certifications = vehicle.certifications;
    }

    // 處理黏度資訊
    if (vehicle.viscosity) {
        intent.viscosity = vehicle.viscosity;
    }

    // 處理症狀匹配
    if (aiResult.symptomMatched) {
        intent.symptomMatched = aiResult.symptomMatched;
    }

    // 處理添加劑指南匹配
    if (aiResult.additiveGuideMatch) {
        intent.additiveGuideMatch = aiResult.additiveGuideMatch;
    }

    // 處理 Wix 查詢（如果已生成）
    if (aiResult.wixQueries) {
        intent.wixQueries = aiResult.wixQueries;
    }

    // 處理燃料類型
    if (vehicle.fuelType) {
        intent.fuelType = vehicle.fuelType;
    }

    // 處理衝程類型（4T/2T）
    if (vehicle.strokeType) {
        intent.strokeType = vehicle.strokeType;
    }

    // 處理使用場景
    intent.usageScenario = aiResult.usageScenario || null;  // 不預設

    // 處理全合成推薦等級
    intent.recommendSynthetic = aiResult.recommendSynthetic || 'any';

    console.log('[IntentConverter] Converted AI result to intent:', JSON.stringify(intent, null, 2));
    return intent;
}

/**
 * 從車輛名稱中提取品牌
 * 從 intent-keywords.json 載入品牌對照表
 * @param {string} vehicleName - 車輛全名
 * @returns {string|null} - 品牌名稱
 */
function extractBrandFromVehicleName(vehicleName) {
    if (!vehicleName) return null;

    const lowerName = vehicleName.toLowerCase();

    // 使用模組級快取取得品牌對照表
    const intentKeywordsData = getIntentKeywords();
    const brandMappings = intentKeywordsData?.vehicle_brands?.mappings || {};

    for (const [key, brand] of Object.entries(brandMappings)) {
        if (lowerName.includes(key.toLowerCase())) {
            return brand;
        }
    }

    return null;
}

/**
 * 驗證 AI 分析結果是否有效
 * @param {Object} aiResult - AI 分析結果
 * @returns {boolean} - 是否有效
 */
function isValidAIResult(aiResult) {
    if (!aiResult) return false;

    // 必須有 vehicles 陣列
    if (!aiResult.vehicles || !Array.isArray(aiResult.vehicles)) {
        return false;
    }

    // 至少要有一個車輛或產品類別
    if (aiResult.vehicles.length === 0 && !aiResult.productCategory) {
        // ⚡ 修正：如果有 searchKeywords（如用戶直接查詢 SKU）或有 intentType，也視為有效
        if (aiResult.searchKeywords && aiResult.searchKeywords.length > 0) {
            console.log('[isValidAIResult] No vehicle/category but has searchKeywords, treating as valid');
            return true;
        }
        if (aiResult.intentType && aiResult.intentType !== 'product_recommendation') {
            console.log('[isValidAIResult] Non-product intent type, treating as valid:', aiResult.intentType);
            return true;
        }
        return false;
    }

    return true;
}


/**
 * 用規則增強 AI 分析結果（補充 AI 無法識別的意圖類型）
 * 從 intent-keywords.json 動態載入關鍵字
 * @param {Object} intent - 已轉換的 intent 物件
 * @param {string} message - 用戶原始訊息
 * @returns {Object} - 增強後的 intent
 */
function enhanceIntentWithRules(intent, message) {
    if (!intent || !message) return intent;

    const lowerMessage = message.toLowerCase();

    // 使用模組級快取取得意圖關鍵字
    const intentKeywordsData = getIntentKeywords();
    const intentKeywords = intentKeywordsData?.intent_keywords || {};

    // 依優先順序檢查各類意圖（與 intent-classifier.js 統一）
    // 優先順序：authentication > cooperation > purchase > price
    const intentOrder = ['authentication', 'cooperation_inquiry', 'purchase_inquiry', 'price_inquiry'];

    for (const intentType of intentOrder) {
        const config = intentKeywords[intentType];
        if (!config || !config.keywords) continue;

        for (const kw of config.keywords) {
            if (lowerMessage.includes(kw.toLowerCase())) {
                intent.type = intentType;
                intent.needsTemplates = [config.template || intentType];
                console.log(`[IntentConverter] Enhanced: ${intentType} detected via keyword:`, kw);
                return intent;
            }
        }
    }

    return intent;
}

/**
 * 將檢索到的知識應用到意圖中（RAG 核心邏輯：用硬知識修正 AI 推論）
 * @param {Object} intent - 意圖物件
 * @param {Object} knowledge - 檢索到的知識物件
 */
function applyKnowledgeToIntent(intent, knowledge) {
    if (!intent || !knowledge || !knowledge.vehicleSpec) return intent;

    // 處理可能的結構差異（直接 Array 或 {specs: Array}）
    let specs = Array.isArray(knowledge.vehicleSpec) ? knowledge.vehicleSpec : knowledge.vehicleSpec?.specs;
    if (!specs || !Array.isArray(specs) || specs.length === 0) return intent;

    console.log('[IntentConverter] Knowledge found for vehicle, attempting to apply...');

    // 1. 年份過濾
    const vehicleName = intent.vehicleModel || '';
    const yearMatch = vehicleName.match(/(20[0-9]{2})/);
    const userYear = yearMatch ? parseInt(yearMatch[1]) : null;

    let candidateSpecs = specs;

    if (userYear) {
        const yearFiltered = specs.filter(s => {
            if (!s.years || s.years === '全年式') return true;

            // 處理 "2019+" 格式
            if (s.years.includes('+')) {
                const startYear = parseInt(s.years);
                return userYear >= startYear;
            }
            // 處理 "2015-2018" 格式
            if (s.years.includes('-')) {
                const [start, end] = s.years.split('-').map(y => parseInt(y));
                return userYear >= start && userYear <= (end || 9999);
            }
            // 處理單一年份
            return parseInt(s.years) === userYear;
        });

        if (yearFiltered.length > 0) {
            candidateSpecs = yearFiltered;
            console.log(`[IntentConverter] Year filtered (${userYear}): ${specs.length} -> ${candidateSpecs.length} specs`);
        }
    }

    // 2. 燃油類型匹配
    // 嘗試根據燃油類型匹配規格
    let matchedSpec = null;
    const aiFuelType = intent.fuelType; // "汽油" or "柴油"

    if (candidateSpecs.length === 1) {
        // 如果只剩一種規格，直接使用
        matchedSpec = candidateSpecs[0];
    } else if (aiFuelType) {
        // 根據 AI 識別的燃油類型進行匹配
        matchedSpec = candidateSpecs.find(s => s.fuel && (s.fuel.includes(aiFuelType) || (aiFuelType === '汽油' && !s.fuel.includes('柴油'))));
    } else {
        // 如果沒有燃油資訊，但所有候選規格都指向同一個認證（例如都是 948-B），那麼也可以大膽推論
        const allSameCert = candidateSpecs.every(s => JSON.stringify(s.certification) === JSON.stringify(candidateSpecs[0].certification));
        if (allSameCert) {
            matchedSpec = candidateSpecs[0];
            console.log('[IntentConverter] All candidates share same certification, applying safely.');
        }
    }

    if (matchedSpec) {
        console.log(`[IntentConverter] ✅ Applied knowledge: ${JSON.stringify(matchedSpec.certification)}`);

        // 更新 intent 屬性
        intent.certifications = matchedSpec.certification;
        intent.viscosity = matchedSpec.viscosity;
        intent.isKnowledgeBased = true; // 標記為基於知識庫

        // 同步更新 _aiAnalysis 中的車輛資訊（因為 search.js 使用此結構）
        if (intent._aiAnalysis && intent._aiAnalysis.vehicles && intent._aiAnalysis.vehicles[0]) {
            const vehicle = intent._aiAnalysis.vehicles[0];

            // 強制覆蓋 AI 推論的認證
            vehicle.certifications = matchedSpec.certification;
            vehicle.viscosity = matchedSpec.viscosity;

            // 如果 JSON 有推薦 SKU，加入 recommendedSKU
            if (matchedSpec.recommendedSKU) {
                vehicle.recommendedSKU = matchedSpec.recommendedSKU;
            }
        }
    } else {
        console.log('[IntentConverter] ⚠️ Knowledge exists but fuel type mismatch or ambiguous. Keeping AI inference.');
    }

    return intent;
}

module.exports = {
    convertAIResultToIntent,
    isValidAIResult,
    enhanceIntentWithRules,
    applyKnowledgeToIntent
};
