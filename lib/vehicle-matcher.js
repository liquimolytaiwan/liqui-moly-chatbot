/**
 * LIQUI MOLY Chatbot - 統一車型匹配服務
 *
 * P0 優化：整合原本分散在 4 個檔案中的車型檢測邏輯
 * - intent-classifier.js: detectVehicleType()
 * - analyze.js: enhanceWithKnowledgeBase() 中的車型匹配
 * - knowledge-retriever.js: findVehicleByMessage()
 * - search.js: 摩托車規格過濾
 *
 * 設計原則：
 * 1. 單一職責：所有車型檢測邏輯集中於此
 * 2. 向後兼容：保持與原有 API 相容
 * 3. 效能優化：快取車型資料，避免重複載入
 */

const { loadJSON } = require('./knowledge-cache');

// 快取車型規格（避免重複載入）
let vehicleSpecsCache = null;
let metadataCache = null;

/**
 * 取得車型規格資料（帶快取）
 */
function getVehicleSpecs() {
    if (!vehicleSpecsCache) {
        vehicleSpecsCache = loadJSON('vehicle-specs.json') || {};
        metadataCache = vehicleSpecsCache._metadata || {};
        console.log('[VehicleMatcher] Vehicle specs loaded and cached');
    }
    return vehicleSpecsCache;
}

/**
 * 取得 metadata（帶快取）
 */
function getMetadata() {
    if (!metadataCache) {
        getVehicleSpecs();
    }
    return metadataCache;
}

// ============================================
// 核心匹配結果結構
// ============================================

/**
 * 建立空的匹配結果
 * @returns {Object} 車型匹配結果結構
 */
function createEmptyMatchResult() {
    return {
        matched: false,
        vehicleType: null,        // '汽車' | '摩托車' | '船舶' | '自行車'
        vehicleSubType: null,     // '速克達' | '檔車' | '重機' | null
        vehicleBrand: null,       // 品牌名稱
        vehicleModel: null,       // 車型名稱
        isMotorcycle: false,
        isScooter: false,
        isElectricVehicle: false,
        strokeType: null,         // '2T' | '4T' | null
        fuelType: null,           // '汽油' | '柴油' | '油電' | '純電'
        certifications: [],       // 認證列表
        viscosity: null,          // 建議黏度
        recommendedSKU: [],       // 建議產品 SKU
        searchKeywords: [],       // 搜尋關鍵字
        detectedKeywords: [],     // 偵測到的關鍵字
        matchSource: null,        // 'alias' | 'keyword' | 'brand' | 'model'
        spec: null,               // 完整規格物件
        note: null                // 備註
    };
}

// ============================================
// 主要匹配函式
// ============================================

/**
 * 統一的車型匹配入口
 * 整合所有車型檢測邏輯
 *
 * @param {string} message - 用戶訊息
 * @param {string} historyText - 對話歷史文字（可選）
 * @returns {Object} 車型匹配結果
 */
function matchVehicle(message, historyText = '') {
    const result = createEmptyMatchResult();
    const lowerMessage = message.toLowerCase();
    const combinedText = `${lowerMessage} ${historyText.toLowerCase()}`;
    const normalizedText = combinedText.replace(/-/g, '').replace(/\s/g, '');

    // 1. 優先：精確別名匹配（從 vehicle-specs.json）
    const aliasMatch = matchByAlias(lowerMessage);
    if (aliasMatch.matched) {
        Object.assign(result, aliasMatch);
        console.log(`[VehicleMatcher] Alias match: ${result.vehicleBrand} ${result.vehicleModel}`);
        return result;
    }

    // 2. 次優先：歷史訊息中的別名匹配
    if (historyText) {
        const historyAliasMatch = matchByAlias(historyText.toLowerCase());
        if (historyAliasMatch.matched) {
            Object.assign(result, historyAliasMatch);
            result.matchSource = 'history_alias';
            console.log(`[VehicleMatcher] History alias match: ${result.vehicleBrand} ${result.vehicleModel}`);
            return result;
        }
    }

    // 3. 關鍵字匹配（通用車型識別）
    const keywordMatch = matchByKeywords(combinedText, normalizedText);
    Object.assign(result, keywordMatch);

    // 4. 電動車偵測
    detectElectricVehicle(lowerMessage, result);

    // 5. 預設值處理
    if (!result.vehicleType) {
        result.vehicleType = '汽車';
    }

    if (result.matched) {
        console.log(`[VehicleMatcher] Keyword match: ${result.vehicleType} (${result.detectedKeywords.join(', ')})`);
    }

    return result;
}

/**
 * 透過別名精確匹配車型
 * 對應原本 knowledge-retriever.js 的 findVehicleByMessage()
 *
 * @param {string} text - 搜尋文字（已轉小寫）
 * @returns {Object} 匹配結果
 */
function matchByAlias(text) {
    const result = createEmptyMatchResult();
    const allSpecs = getVehicleSpecs();

    for (const [brand, models] of Object.entries(allSpecs)) {
        // 跳過 _metadata 等非車型資料
        if (brand.startsWith('_')) continue;
        if (!models || typeof models !== 'object') continue;

        for (const [modelName, specs] of Object.entries(models)) {
            // 跳過 _note 等非車型資料
            if (modelName.startsWith('_')) continue;
            // 確保 specs 是陣列
            if (!Array.isArray(specs)) continue;

            for (const spec of specs) {
                // 檢查 aliases
                if (spec.aliases && Array.isArray(spec.aliases)) {
                    for (const alias of spec.aliases) {
                        if (text.includes(alias.toLowerCase())) {
                            result.matched = true;
                            result.vehicleBrand = brand;
                            result.vehicleModel = modelName;
                            result.matchSource = 'alias';
                            result.spec = spec;

                            // 判斷車型類型
                            if (spec.type === '速克達') {
                                result.vehicleType = '摩托車';
                                result.vehicleSubType = '速克達';
                                result.isMotorcycle = true;
                                result.isScooter = true;
                                result.strokeType = '4T';
                            } else if (brand === 'Harley-Davidson' ||
                                ['Honda', 'Yamaha', 'Kawasaki', 'Suzuki', 'Ducati', 'KTM', 'Triumph', 'BMW', 'Aprilia'].includes(brand) &&
                                !spec.type?.includes('速克達')) {
                                result.vehicleType = '摩托車';
                                result.vehicleSubType = '檔車';
                                result.isMotorcycle = true;
                                result.strokeType = '4T';
                            } else {
                                result.vehicleType = '汽車';
                            }

                            // 複製規格資訊
                            if (spec.certification) {
                                result.certifications = Array.isArray(spec.certification)
                                    ? spec.certification
                                    : [spec.certification];
                            }
                            if (spec.viscosity) {
                                result.viscosity = spec.viscosity;
                            }
                            if (spec.recommendedSKU) {
                                result.recommendedSKU = Array.isArray(spec.recommendedSKU)
                                    ? spec.recommendedSKU
                                    : [spec.recommendedSKU];
                            }
                            if (spec.searchKeywords) {
                                result.searchKeywords = spec.searchKeywords;
                            }
                            if (spec.fuel) {
                                result.fuelType = spec.fuel;
                            }
                            if (spec.note) {
                                result.note = spec.note;
                            }

                            result.detectedKeywords.push(alias);
                            return result;
                        }
                    }
                }
            }
        }
    }

    return result;
}

/**
 * 透過關鍵字匹配車型類型
 * 對應原本 intent-classifier.js 的 detectVehicleType()
 *
 * @param {string} text - 搜尋文字（已轉小寫）
 * @param {string} normalizedText - 正規化文字（移除連字號和空格）
 * @returns {Object} 匹配結果
 */
function matchByKeywords(text, normalizedText) {
    const result = createEmptyMatchResult();
    const metadata = getMetadata();
    const vehicleTypes = metadata.vehicle_types || {};

    // === 1. 摩托車關鍵字檢測 ===
    const motorcycleData = vehicleTypes.motorcycle || {};
    const motorcycleKeywords = motorcycleData.keywords || [
        '摩托車', '機車', '重機', '檔車', '速克達', '二輪', 'motorcycle', 'motorbike', 'scooter'
    ];
    const motorcycleModels = motorcycleData.specific_models || {};

    // 檢查摩托車關鍵字
    for (const kw of motorcycleKeywords) {
        if (text.includes(kw.toLowerCase())) {
            result.matched = true;
            result.vehicleType = '摩托車';
            result.isMotorcycle = true;
            result.detectedKeywords.push(kw);
            result.matchSource = 'keyword';
            break;
        }
    }

    // 檢查具體摩托車車型
    for (const [brand, models] of Object.entries(motorcycleModels)) {
        for (const model of models) {
            const modelLower = model.toLowerCase().replace(/-/g, '');
            if (normalizedText.includes(modelLower)) {
                result.matched = true;
                result.vehicleType = '摩托車';
                result.isMotorcycle = true;
                result.vehicleBrand = brand;
                result.vehicleModel = model;
                result.detectedKeywords.push(model);
                result.matchSource = 'model';
                break;
            }
        }
        if (result.vehicleBrand) break;
    }

    // 偵測速克達子類型
    const scooterKeywords = ['速克達', 'scooter', '勁戰', 'drg', 'jet', 'krv', 'force', 'smax', '曼巴', 'mmbcu', 'tigra', 'racing', '雷霆'];
    for (const kw of scooterKeywords) {
        if (text.includes(kw.toLowerCase())) {
            result.isScooter = true;
            result.vehicleSubType = '速克達';
            if (!result.detectedKeywords.includes(kw)) {
                result.detectedKeywords.push(kw);
            }
            break;
        }
    }

    // 偵測檔車/重機子類型
    const manualBikeKeywords = ['檔車', '重機', 'harley', '哈雷', 'ninja', 'cbr', 'r1', 'r6', 'mt-', 'z900', 'z1000', 'panigale', 'monster'];
    if (!result.isScooter) {
        for (const kw of manualBikeKeywords) {
            if (text.includes(kw.toLowerCase())) {
                result.vehicleSubType = '檔車';
                if (!result.detectedKeywords.includes(kw)) {
                    result.detectedKeywords.push(kw);
                }
                break;
            }
        }
    }

    // 如果已確認是摩托車，直接返回
    if (result.isMotorcycle) {
        return result;
    }

    // === 2. 汽車關鍵字檢測 ===
    const carData = vehicleTypes.car || {};
    const carKeywords = carData.keywords || ['汽車', '車', 'car', 'auto'];
    const carBrands = carData.specific_brands || [
        'Toyota', 'Honda', 'Mazda', 'Nissan', 'Subaru', 'Mitsubishi', 'Suzuki',
        'BMW', 'Benz', 'Mercedes', 'Audi', 'VW', 'Volkswagen', 'Porsche', 'Volvo',
        'Ford', 'Chevrolet', 'Hyundai', 'Kia', 'Lexus', 'Infiniti'
    ];

    for (const kw of carKeywords) {
        if (text.includes(kw.toLowerCase())) {
            result.matched = true;
            result.vehicleType = '汽車';
            result.detectedKeywords.push(kw);
            result.matchSource = 'keyword';
            break;
        }
    }

    for (const brand of carBrands) {
        if (text.includes(brand.toLowerCase())) {
            result.matched = true;
            result.vehicleType = '汽車';
            result.vehicleBrand = brand;
            result.detectedKeywords.push(brand);
            result.matchSource = 'brand';
            break;
        }
    }

    // === 3. 船舶關鍵字檢測 ===
    const marineKeywords = vehicleTypes.marine?.keywords || ['船', 'marine', 'outboard', '船外機', '遊艇'];
    for (const kw of marineKeywords) {
        if (text.includes(kw.toLowerCase())) {
            result.matched = true;
            result.vehicleType = '船舶';
            result.detectedKeywords.push(kw);
            result.matchSource = 'keyword';
            break;
        }
    }

    // === 4. 自行車關鍵字檢測 ===
    const bicycleKeywords = vehicleTypes.bicycle?.keywords || ['自行車', 'bicycle', 'bike', '腳踏車', '單車'];
    for (const kw of bicycleKeywords) {
        if (text.includes(kw.toLowerCase())) {
            result.matched = true;
            result.vehicleType = '自行車';
            result.detectedKeywords.push(kw);
            result.matchSource = 'keyword';
            break;
        }
    }

    return result;
}

/**
 * 電動車偵測
 * 對應原本 intent-classifier.js 的 detectElectricVehicle()
 *
 * @param {string} text - 搜尋文字（已轉小寫）
 * @param {Object} result - 匹配結果（會被修改）
 */
function detectElectricVehicle(text, result) {
    const metadata = getMetadata();
    const evData = metadata.special_scenarios?.electric_vehicle || {};

    // 純電機車
    const evMotorcycleKeywords = evData.pure_ev_motorcycles?.keywords ||
        ['gogoro', 'ionex', 'emoving', 'eready', '電動機車', '電動車'];
    for (const kw of evMotorcycleKeywords) {
        if (text.includes(kw.toLowerCase())) {
            result.isElectricVehicle = true;
            result.vehicleType = '摩托車';
            result.vehicleSubType = '純電';
            result.isMotorcycle = true;
            result.detectedKeywords.push(kw);
            return;
        }
    }

    // 純電汽車
    const evCarKeywords = evData.pure_ev_cars?.keywords ||
        ['tesla', 'byd', 'taycan', '電動車', 'ev', 'model 3', 'model y', 'model s'];
    for (const kw of evCarKeywords) {
        if (text.includes(kw.toLowerCase())) {
            result.isElectricVehicle = true;
            result.vehicleType = '汽車';
            result.vehicleSubType = '純電';
            result.detectedKeywords.push(kw);
            return;
        }
    }

    // 油電混合
    const hybridKeywords = evData.hybrid?.keywords || ['油電', 'hybrid', 'phev', 'prius'];
    for (const kw of hybridKeywords) {
        if (text.includes(kw.toLowerCase())) {
            result.fuelType = '油電';
            result.detectedKeywords.push(kw);
            return;
        }
    }
}

// ============================================
// 輔助函式
// ============================================

/**
 * 取得車型規格（用於補充 AI 分析結果）
 *
 * @param {string} brand - 品牌
 * @param {string} model - 車型（可選）
 * @returns {Object|null} 車型規格
 */
function getVehicleSpec(brand, model = null) {
    const allSpecs = getVehicleSpecs();
    if (!allSpecs) return null;

    const brandSpecs = allSpecs[brand];
    if (!brandSpecs) return null;

    if (model) {
        // 收集所有匹配的車型規格
        const allMatchedSpecs = [];
        // 移除年份和品牌名稱以便匹配
        let cleanModel = model.toLowerCase().replace(/20[0-9]{2}/g, '');
        if (brand) {
            cleanModel = cleanModel.replace(brand.toLowerCase(), '');
        }
        cleanModel = cleanModel.trim();

        for (const [modelName, specs] of Object.entries(brandSpecs)) {
            if (modelName.startsWith('_')) continue;

            // 寬鬆匹配：名稱重疊
            const cleanModelName = modelName.toLowerCase();

            if (cleanModelName.includes(cleanModel) || cleanModel.includes(cleanModelName)) {
                // 將該車型下的所有規格（可能是不同引擎/年份）展開並加入
                if (Array.isArray(specs)) {
                    allMatchedSpecs.push(...specs);
                }
            }
        }

        if (allMatchedSpecs.length > 0) {
            return allMatchedSpecs; // 返回扁平化的規格陣列
        }
    }

    // 若沒指定 model 或找不到，暫不返回整包（避免誤用）
    return null;
}

/**
 * 判斷是否為速克達車型
 * 整合原本分散的速克達判斷邏輯
 *
 * @param {Object} vehicleInfo - 車型資訊
 * @returns {boolean}
 */
function isScooterVehicle(vehicleInfo) {
    if (!vehicleInfo) return false;

    // 直接標記
    if (vehicleInfo.vehicleSubType === '速克達') return true;
    if (vehicleInfo.isScooter) return true;

    // 認證判斷
    const certs = vehicleInfo.certifications || [];
    if (certs.includes('JASO MB')) return true;

    // 車型判斷
    const scooterModels = ['勁戰', 'drg', 'jet', 'krv', 'force', 'smax', '曼巴', 'mmbcu', 'tigra', 'racing', '雷霆', 'many', 'vino'];
    const modelName = (vehicleInfo.vehicleModel || vehicleInfo.vehicleName || '').toLowerCase();
    return scooterModels.some(m => modelName.includes(m));
}

/**
 * 判斷是否為摩托車產品（用於搜尋過濾）
 * 整合原本 search.js 中的判斷邏輯
 *
 * @param {Object} product - 產品資料
 * @returns {boolean}
 */
function isMotorcycleProduct(product) {
    if (!product) return false;
    const title = (product.title || '').toLowerCase();
    const sort = (product.sort || '').toLowerCase();
    return title.includes('motorbike') ||
        sort.includes('摩托車') ||
        sort.includes('motorbike') ||
        sort.includes('scooter');
}

/**
 * 取得摩托車品牌列表
 * @returns {Array<string>}
 */
function getMotorcycleBrands() {
    const metadata = getMetadata();
    return metadata.motorcycle_brands || [
        'Honda', 'Yamaha', 'Kawasaki', 'Suzuki', 'Ducati',
        'Harley-Davidson', 'KTM', 'Triumph', 'BMW', 'Aprilia'
    ];
}

/**
 * 取得速克達品牌列表
 * @returns {Array<string>}
 */
function getScooterBrands() {
    const metadata = getMetadata();
    return metadata.scooter_brands || ['SYM', 'YAMAHA', 'KYMCO', 'PGO', 'Aeon'];
}

/**
 * 清除快取（用於測試或強制重新載入）
 */
function clearCache() {
    vehicleSpecsCache = null;
    metadataCache = null;
    console.log('[VehicleMatcher] Cache cleared');
}

// ============================================
// 匯出
// ============================================
module.exports = {
    // 主要匹配函式
    matchVehicle,
    matchByAlias,
    matchByKeywords,

    // 輔助函式
    getVehicleSpec,
    isScooterVehicle,
    isMotorcycleProduct,
    getMotorcycleBrands,
    getScooterBrands,
    detectElectricVehicle,

    // 工具函式
    createEmptyMatchResult,
    getVehicleSpecs,
    getMetadata,
    clearCache
};
