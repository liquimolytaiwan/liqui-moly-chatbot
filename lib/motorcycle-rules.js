/**
 * LIQUI MOLY Chatbot - 統一摩托車規則引擎
 *
 * P0 優化：整合原本分散在 4 個檔案中的摩托車/JASO 規則
 *
 * RAG 架構重構：
 * - 所有車型資料從 ai-analysis-rules.json 動態讀取
 * - 不再硬編碼車型列表
 * - 支援知識庫熱更新
 *
 * 設計原則：
 * 1. 單一職責：所有摩托車相關邏輯集中於此
 * 2. RAG 架構：從知識庫按需讀取資料
 * 3. 可擴展：新增車型只需更新 JSON
 */

const { loadJSON } = require('./knowledge-cache');
const { getScooterCertScore } = require('./certification-matcher');

// 快取
let aiAnalysisRulesCache = null;

/**
 * 取得 AI 分析規則（帶快取）
 */
function getAiAnalysisRules() {
    if (!aiAnalysisRulesCache) {
        aiAnalysisRulesCache = loadJSON('ai-analysis-rules.json') || {};
    }
    return aiAnalysisRulesCache;
}

// ============================================
// 資料存取函式（從知識庫讀取）
// ============================================

/**
 * 取得速克達車型列表（從知識庫）
 * @returns {Array<string>}
 */
function getScooterModels() {
    const rules = getAiAnalysisRules();
    return rules.scooter_identification?.models || [];
}

/**
 * 取得速克達品牌列表（從知識庫）
 * @returns {Array<string>}
 */
function getScooterBrands() {
    const rules = getAiAnalysisRules();
    return rules.scooter_identification?.brands || [];
}

/**
 * 取得檔車品牌列表（從知識庫）
 * @returns {Array<string>}
 */
function getManualMotorcycleBrands() {
    const rules = getAiAnalysisRules();
    return rules.motorcycle_identification?.brands || [];
}

/**
 * 取得檔車系列關鍵字（從知識庫）
 * @returns {Array<string>}
 */
function getManualMotorcycleSeries() {
    const rules = getAiAnalysisRules();
    return rules.motorcycle_identification?.series || [];
}

// ============================================
// 核心判斷函式
// ============================================

/**
 * 判斷是否為速克達
 *
 * @param {Object|string} input - 車型資訊物件或車型名稱字串
 * @returns {boolean}
 */
function isScooter(input) {
    if (!input) return false;

    let textToCheck = '';

    if (typeof input === 'string') {
        textToCheck = input.toLowerCase();
    } else if (typeof input === 'object') {
        // 直接標記
        if (input.vehicleSubType === '速克達') return true;
        if (input.isScooter === true) return true;

        // 認證判斷
        const certs = input.certifications || [];
        if (certs.includes('JASO MB')) return true;

        // 車型名稱判斷
        textToCheck = (input.vehicleModel || input.vehicleName || '').toLowerCase();
    }

    // 檢查速克達車型列表（從知識庫讀取）
    const scooterModels = getScooterModels();
    return scooterModels.some(model => textToCheck.includes(model.toLowerCase()));
}

/**
 * 判斷是否為檔車/重機
 *
 * @param {Object|string} input - 車型資訊物件或車型名稱字串
 * @returns {boolean}
 */
function isManualMotorcycle(input) {
    if (!input) return false;

    let textToCheck = '';
    let brandToCheck = '';

    if (typeof input === 'string') {
        textToCheck = input.toLowerCase();
    } else if (typeof input === 'object') {
        // 直接標記
        if (input.vehicleSubType === '檔車' || input.vehicleSubType === '重機') return true;

        // 認證判斷
        const certs = input.certifications || [];
        if (certs.includes('JASO MA2') || certs.includes('JASO MA')) return true;

        textToCheck = (input.vehicleModel || input.vehicleName || '').toLowerCase();
        brandToCheck = (input.vehicleBrand || '').toLowerCase();
    }

    // 排除速克達
    if (isScooter(input)) return false;

    // 檢查檔車品牌（從知識庫讀取）
    const manualBrands = getManualMotorcycleBrands();
    if (brandToCheck && manualBrands.some(b => brandToCheck.includes(b.toLowerCase()))) {
        return true;
    }

    // 檢查檔車系列關鍵字（從知識庫讀取）
    const manualSeries = getManualMotorcycleSeries();
    return manualSeries.some(series => textToCheck.includes(series.toLowerCase()));
}

/**
 * 取得摩托車的 JASO 認證類型
 *
 * @param {Object|string} input - 車型資訊
 * @returns {Object} { certification: string, type: string, reason: string }
 */
function getJasoType(input) {
    const rules = getAiAnalysisRules();
    const jasoRules = rules.jaso_rules || {};

    if (isScooter(input)) {
        return {
            certification: jasoRules.scooter?.certification || 'JASO MB',
            type: 'scooter',
            reason: jasoRules.scooter?.reason || '速克達使用乾式離合器，需要 JASO MB 認證油品',
            searchKeywords: jasoRules.scooter?.searchKeywords || ['Scooter', 'JASO MB']
        };
    } else {
        return {
            certification: jasoRules.motorcycle?.certification || 'JASO MA2',
            type: 'manual',
            reason: jasoRules.motorcycle?.reason || '檔車/重機使用濕式離合器，需要 JASO MA/MA2 認證油品',
            searchKeywords: jasoRules.motorcycle?.searchKeywords || ['Street', 'Race', 'JASO MA2', 'JASO MA']
        };
    }
}

// ============================================
// 產品過濾函式
// ============================================

/**
 * 摩托車機油搜尋（User Defined Rules）
 * 整合原本 search.js 中的摩托車規則搜尋
 *
 * @param {Array} products - 產品列表
 * @param {Object} vehicleInfo - 車型資訊
 * @returns {Array} 匹配的產品
 */
function searchMotorcycleOil(products, vehicleInfo) {
    if (!products || !vehicleInfo) return [];

    const isScooterVehicle = isScooter(vehicleInfo);
    const viscosity = vehicleInfo.viscosity;

    console.log(`[MotorcycleRules] Searching oil for: ${isScooterVehicle ? '速克達' : '檔車/重機'}, viscosity: ${viscosity || 'any'}`);

    const matches = products.filter(p => {
        // Rule 1: Title must contain "Motorbike"
        if (!p.title || !p.title.toLowerCase().includes('motorbike')) return false;

        // Rule 2: JASO Classification
        const cert = (p.cert || '').toUpperCase().replace(/[-\s]/g, '');
        const title = (p.title || '').toUpperCase();

        if (isScooterVehicle) {
            // 速克達：優先 JASO MB，排除純 MA/MA2 產品
            const hasMB = cert.includes('JASOMB') || cert.includes('MB') || title.includes('SCOOTER');
            const hasMA = cert.includes('JASOMA2') || cert.includes('JASOMA') || (cert.includes('MA') && !cert.includes('MB'));
            if (hasMA && !hasMB) return false;  // 有 MA 沒有 MB → 不要
            if (!hasMB && !title.includes('SCOOTER')) return false;
        } else {
            // 檔車/重機：需要 JASO MA/MA2
            const hasMA = cert.includes('JASOMA2') || cert.includes('JASOMA') || cert.includes('MA2') || cert.includes('MA');
            if (!hasMA) return false;
        }

        // Rule 3: Viscosity matching
        if (viscosity) {
            const word2 = (p.word2 || '').toUpperCase().replace(/-/g, '');
            const targetViscosity = viscosity.toUpperCase().replace(/-/g, '');
            if (!word2.includes(targetViscosity)) return false;
        }

        return true;
    });

    console.log(`[MotorcycleRules] Matched ${matches.length} products`);
    return matches;
}

/**
 * 摩托車產品過濾（通用）
 * 過濾非摩托車產品
 *
 * @param {Array} products - 產品列表
 * @param {Object} options - 選項 { isScooter, viscosity }
 * @returns {Array} 過濾後的產品
 */
function filterMotorcycleProducts(products, options = {}) {
    const { isScooter: isScooterFilter, viscosity } = options;

    return products.filter(p => {
        const title = (p.title || '').toLowerCase();
        const sort = (p.sort || '').toLowerCase();

        // 必須是摩托車產品
        const isMotorbikeProduct = title.includes('motorbike') ||
                                   sort.includes('摩托車') ||
                                   sort.includes('motorbike') ||
                                   sort.includes('scooter');
        if (!isMotorbikeProduct) return false;

        // JASO 認證過濾
        if (typeof isScooterFilter === 'boolean') {
            const cert = (p.cert || '').toUpperCase().replace(/[-\s]/g, '');

            if (isScooterFilter) {
                // 速克達：排除純 MA/MA2 產品
                const hasMB = cert.includes('JASOMB') || cert.includes('MB') || title.includes('scooter');
                const hasOnlyMA = (cert.includes('JASOMA2') || cert.includes('JASOMA')) && !hasMB;
                if (hasOnlyMA) return false;
            }
        }

        // 黏度過濾
        if (viscosity) {
            const word2 = (p.word2 || '').toUpperCase().replace(/-/g, '');
            const targetViscosity = viscosity.toUpperCase().replace(/-/g, '');
            if (!word2.includes(targetViscosity)) return false;
        }

        return true;
    });
}

// ============================================
// 評分與排序
// ============================================

/**
 * 取得產品的合成等級分數
 * 用於全合成優先排序
 *
 * @param {string} title - 產品標題
 * @returns {number} 分數 (3=全合成, 2=半合成, 1=礦物油)
 */
function getSyntheticScore(title) {
    if (!title) return 0;
    const titleLower = title.toLowerCase();

    // 嚴格全合成（3分）
    if (titleLower.includes('synthoil') ||
        titleLower.includes('race') ||
        titleLower.includes('fully synthetic') ||
        titleLower.includes('fully-synthetic') ||
        titleLower.includes('全合成')) {
        return 3;
    }

    // 合成技術/半合成（2分）
    if (titleLower.includes('top tec') ||
        titleLower.includes('special tec') ||
        titleLower.includes('leichtlauf') ||
        titleLower.includes('synthetic technology') ||
        titleLower.includes('合成') ||
        titleLower.includes('street') ||
        titleLower.includes('formula')) {
        return 2;
    }

    // 礦物油（1分）
    if (titleLower.includes('mineral') || titleLower.includes('礦物')) {
        return 1;
    }

    return 1.5; // 預設
}

/**
 * 摩托車產品排序
 *
 * @param {Array} products - 產品列表
 * @param {Object} options - 排序選項
 * @returns {Array} 排序後的產品
 */
function sortMotorcycleProducts(products, options = {}) {
    const { preferFullSynthetic, isScooter: scooterSort } = options;

    return [...products].sort((a, b) => {
        // 1. 全合成優先
        if (preferFullSynthetic) {
            const aScore = getSyntheticScore(a.title);
            const bScore = getSyntheticScore(b.title);
            if (aScore !== bScore) return bScore - aScore;
        }

        // 2. 速克達認證優先（MB > MA）
        if (scooterSort) {
            const aScore = getScooterCertScore(a.cert);
            const bScore = getScooterCertScore(b.cert);
            if (aScore !== bScore) return bScore - aScore;
        }

        return 0;
    });
}

// ============================================
// Prompt 生成
// ============================================

/**
 * 生成 JASO 規則 Prompt
 * 用於 AI 分析時的提示詞
 *
 * @returns {string}
 */
function buildJasoRulesPrompt() {
    const rules = getAiAnalysisRules();
    let prompt = '';

    // 速克達識別
    const scooter = rules.scooter_identification || {};
    const scooterModels = scooter.models || [];
    prompt += `
【⚠️ 台灣速克達識別 - 超級重要！】
- 速克達車款：${scooterModels.slice(0, 15).join('/')}
- 速克達特徵：${scooter.characteristics?.transmission || 'CVT自動變速'}、${scooter.characteristics?.clutch || '乾式離合器'}
- 速克達 → vehicleSubType = "速克達"，strokeType = "4T"
`;

    // JASO 規則
    const jaso = rules.jaso_rules || {};
    prompt += `
【⚠️ JASO 認證規則 - 非常重要！】
- **速克達(${jaso.scooter?.reason || '無濕式離合器'}) → ${jaso.scooter?.certification || 'JASO MB'} 認證**
- **檔車/重機(${jaso.motorcycle?.reason || '有濕式離合器'}) → ${jaso.motorcycle?.certification || 'JASO MA2'} 認證**
- 搜尋關鍵字：速克達要加 "Scooter" 或 "JASO MB"，檔車要加 "Street" 或 "Race" 或 "JASO MA2"
`;

    // 摩托車識別
    const moto = rules.motorcycle_identification || {};
    const motoBrands = moto.brands || [];
    const motoSeries = moto.series || [];
    prompt += `
【摩托車識別】
- 重機/檔車品牌：${motoBrands.slice(0, 8).join('、')}
- 重機/檔車系列：${motoSeries.slice(0, 10).join('/')}
- 摩托車機油：searchKeywords 必須包含 "Motorbike"
`;

    return prompt;
}

/**
 * 生成搜尋關鍵字規則 Prompt
 *
 * @returns {string}
 */
function buildSearchKeywordRulesPrompt() {
    const rules = getAiAnalysisRules();
    const skRules = rules.search_keyword_rules;

    if (!skRules) {
        return `
【searchKeywords 規則】
⚠️ 摩托車/速克達機油：searchKeywords 第一個必須是 "Motorbike"
⚠️ 速克達：加入 "Scooter" 或 "JASO MB"
⚠️ 檔車/重機：加入 "Street" 或 "Race" 或 "JASO MA2"
`;
    }

    let prompt = `
【searchKeywords 規則 - 非常重要！】
⚠️ 摩托車/速克達機油：searchKeywords 第一個必須是 "${skRules.motorcycle?.required?.[0] || 'Motorbike'}"
⚠️ 速克達：加入 "${(skRules.motorcycle?.scooter_additional || ['Scooter', 'JASO MB']).join('" 或 "')}"
⚠️ 檔車/重機：加入 "${(skRules.motorcycle?.manual_additional || ['Street', 'Race', 'JASO MA2']).join('" 或 "')}"
`;

    if (skRules.examples && skRules.examples.length > 0) {
        prompt += `
範例：`;
        for (const ex of skRules.examples.slice(0, 3)) {
            prompt += `
- ${ex.scenario} → searchKeywords: ${JSON.stringify(ex.keywords)}`;
        }
    }

    return prompt;
}

// ============================================
// 工具函式
// ============================================

/**
 * 清除快取
 */
function clearCache() {
    aiAnalysisRulesCache = null;
    console.log('[MotorcycleRules] Cache cleared');
}

// ============================================
// 匯出
// ============================================
module.exports = {
    // 核心判斷函式
    isScooter,
    isManualMotorcycle,
    getJasoType,

    // 產品搜尋與過濾
    searchMotorcycleOil,
    filterMotorcycleProducts,

    // 評分與排序
    getSyntheticScore,
    sortMotorcycleProducts,
    getScooterCertScore,

    // Prompt 生成
    buildJasoRulesPrompt,
    buildSearchKeywordRulesPrompt,

    // 資料存取（從知識庫讀取）
    getScooterModels,
    getScooterBrands,
    getManualMotorcycleBrands,
    getManualMotorcycleSeries,

    // 工具
    clearCache
};
