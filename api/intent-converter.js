/**
 * LIQUI MOLY Chatbot - RAG Intent Converter
 * 將 analyze.js 的 AI 分析結果轉換為 intent 格式
 * 
 * 用於「AI 優先、規則備援」混合架構
 */

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
    const productCategory = aiResult.productCategory || '機油';
    const isMotorcycle = vehicle.vehicleType === '摩托車';

    // 判斷意圖類型
    let intentType = 'product_recommendation';
    if (!aiResult.needsProductRecommendation) {
        intentType = 'general_inquiry';
    }

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
        needsTemplates: ['product_recommendation'],
        specialScenario: specialScenario,
        detectedKeywords: aiResult.searchKeywords || [],

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
 * @param {string} vehicleName - 車輛全名
 * @returns {string|null} - 品牌名稱
 */
function extractBrandFromVehicleName(vehicleName) {
    if (!vehicleName) return null;

    const lowerName = vehicleName.toLowerCase();

    // 常見品牌對照
    const brands = {
        'ford': 'Ford',
        'toyota': 'Toyota',
        'honda': 'Honda',
        'mazda': 'Mazda',
        'nissan': 'Nissan',
        'subaru': 'Subaru',
        'hyundai': 'Hyundai',
        'kia': 'Kia',
        'bmw': 'BMW',
        'mercedes': 'Mercedes-Benz',
        'benz': 'Mercedes-Benz',
        'audi': 'Audi',
        'volkswagen': 'VW',
        'vw': 'VW',
        'volvo': 'Volvo',
        'lexus': 'Lexus',
        'mitsubishi': 'Mitsubishi',
        'suzuki': 'Suzuki',
        'yamaha': 'Yamaha',
        'kawasaki': 'Kawasaki',
        'ducati': 'Ducati',
        'harley': 'Harley-Davidson',
        'ktm': 'KTM',
        'triumph': 'Triumph',
        'sym': 'SYM',
        'kymco': 'KYMCO',
        '光陽': 'KYMCO',
        '三陽': 'SYM',
        'gogoro': 'Gogoro'
    };

    for (const [key, brand] of Object.entries(brands)) {
        if (lowerName.includes(key)) {
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
        return false;
    }

    return true;
}

/**
 * 用規則增強 AI 分析結果（補充 AI 無法識別的意圖類型）
 * @param {Object} intent - 已轉換的 intent 物件
 * @param {string} message - 用戶原始訊息
 * @returns {Object} - 增強後的 intent
 */
function enhanceIntentWithRules(intent, message) {
    if (!intent || !message) return intent;

    const lowerMessage = message.toLowerCase();

    // === 防偽驗證 ===
    const authKeywords = ['真假', '正品', '假貨', '仿冒', '驗證', '防偽', '真的', '假的', '真品', '辨別真偽', '水貨', '公司貨', '平行輸入', '原廠貨'];
    for (const kw of authKeywords) {
        if (lowerMessage.includes(kw)) {
            intent.type = 'authentication';
            intent.needsTemplates = ['authentication'];
            console.log('[IntentConverter] Enhanced: authentication detected via keyword:', kw);
            return intent;
        }
    }

    // === 價格查詢 ===
    const priceKeywords = ['多少錢', '價格', '售價', '價位', '報價'];
    for (const kw of priceKeywords) {
        if (lowerMessage.includes(kw)) {
            intent.type = 'price_inquiry';
            intent.needsTemplates = ['price_inquiry'];
            console.log('[IntentConverter] Enhanced: price_inquiry detected via keyword:', kw);
            return intent;
        }
    }

    // === 購買查詢 ===
    const purchaseKeywords = ['哪裡買', '店家', '經銷商', '門市', '實體店', '購買', '想買', '怎麼買', '附近'];
    for (const kw of purchaseKeywords) {
        if (lowerMessage.includes(kw)) {
            intent.type = 'purchase_inquiry';
            intent.needsTemplates = ['purchase_inquiry'];
            console.log('[IntentConverter] Enhanced: purchase_inquiry detected via keyword:', kw);
            return intent;
        }
    }

    // === 合作洽詢 ===
    const cooperationKeywords = ['合作', '經銷', '代理', '進貨', '批發', '贊助', 'kol', '網紅'];
    for (const kw of cooperationKeywords) {
        if (lowerMessage.includes(kw)) {
            intent.type = 'cooperation_inquiry';
            intent.needsTemplates = ['cooperation_inquiry'];
            console.log('[IntentConverter] Enhanced: cooperation_inquiry detected via keyword:', kw);
            return intent;
        }
    }

    return intent;
}

module.exports = {
    convertAIResultToIntent,
    extractBrandFromVehicleName,
    isValidAIResult,
    enhanceIntentWithRules
};
