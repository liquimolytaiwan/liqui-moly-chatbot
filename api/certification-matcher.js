/**
 * LIQUI MOLY Chatbot - 統一認證匹配服務
 *
 * P0 優化：整合原本分散在 3 個檔案中的認證匹配邏輯
 * - knowledge-retriever.js: getCertificationForVehicle()
 * - search.js: searchWithCertUpgrade()
 * - search.js: JASO 認證過濾
 *
 * 設計原則：
 * 1. 單一職責：所有認證相關邏輯集中於此
 * 2. 向後兼容：支援認證升級機制
 * 3. 效能優化：快取認證對照表
 */

const { loadJSON } = require('./knowledge-cache');

// 快取
let certCompatibilityCache = null;
let vehicleSpecsCache = null;

/**
 * 取得認證兼容對照表（帶快取）
 */
function getCertCompatibility() {
    if (!certCompatibilityCache) {
        const searchRef = loadJSON('search-reference.json') || {};
        certCompatibilityCache = searchRef.certification_compatibility || {};
        console.log('[CertMatcher] Certification compatibility table loaded');
    }
    return certCompatibilityCache;
}

/**
 * 取得車型規格（帶快取）
 */
function getVehicleSpecs() {
    if (!vehicleSpecsCache) {
        vehicleSpecsCache = loadJSON('vehicle-specs.json') || {};
    }
    return vehicleSpecsCache;
}

// ============================================
// 認證匹配結果結構
// ============================================

/**
 * 建立認證匹配結果
 * @returns {Object}
 */
function createCertMatchResult() {
    return {
        matched: false,
        products: [],
        requestedCert: null,
        usedCert: null,
        isUpgrade: false,
        certNotice: null,
        compatibleCerts: []
    };
}

// ============================================
// 核心匹配函式
// ============================================

/**
 * 認證搜尋（含升級兼容機制）
 * 整合原本 search.js 的 searchWithCertUpgrade()
 *
 * @param {Array} products - 產品列表
 * @param {string} requestedCert - 用戶請求的認證 (如 "GF-6A")
 * @param {string} viscosity - 可選的黏度 (如 "5W-30")
 * @returns {Object} 匹配結果
 */
function searchWithCertUpgrade(products, requestedCert, viscosity = null) {
    const result = createCertMatchResult();
    result.requestedCert = requestedCert;

    if (!requestedCert) {
        return result;
    }

    const certCompatibility = getCertCompatibility();
    const normalizedRequest = normalizeCert(requestedCert);

    console.log(`[CertMatcher] Searching for: ${requestedCert}${viscosity ? ` + ${viscosity}` : ''}`);

    // 1. 先精確搜尋用戶請求的認證
    let matches = filterProductsByCert(products, normalizedRequest, viscosity);
    if (matches.length > 0) {
        console.log(`[CertMatcher] Found ${matches.length} products with exact cert: ${requestedCert}`);
        result.matched = true;
        result.products = matches;
        result.usedCert = requestedCert;
        return result;
    }

    // 2. 查找升級認證
    console.log(`[CertMatcher] No exact match, looking for upgrade certification...`);

    // 遍歷所有認證標準（ILSAC, API, JASO）
    for (const [standard, upgrades] of Object.entries(certCompatibility)) {
        if (standard === '_description') continue;

        // 遍歷每個升級認證
        for (const [upgradeCert, compatibleWith] of Object.entries(upgrades)) {
            const normalizedUpgrade = normalizeCert(upgradeCert);

            // 檢查用戶請求的認證是否在兼容列表中
            const isCompatible = compatibleWith.some(c =>
                normalizeCert(c) === normalizedRequest
            );

            if (isCompatible) {
                // 嘗試用升級認證搜尋
                matches = filterProductsByCert(products, normalizedUpgrade, viscosity);
                if (matches.length > 0) {
                    console.log(`[CertMatcher] Found ${matches.length} products with upgrade cert: ${upgradeCert} (compatible with ${requestedCert})`);
                    result.matched = true;
                    result.products = matches;
                    result.usedCert = upgradeCert;
                    result.isUpgrade = true;
                    result.certNotice = `目前無 ${requestedCert} 認證產品，以下是 ${upgradeCert} 認證產品（向後兼容 ${requestedCert}）`;
                    return result;
                }
            }
        }
    }

    // 3. 都沒有結果
    console.log(`[CertMatcher] No products found for ${requestedCert} or compatible upgrades`);
    result.certNotice = `目前沒有符合 ${requestedCert}${viscosity ? ` + ${viscosity}` : ''} 的產品`;
    return result;
}

/**
 * 根據認證和黏度過濾產品
 *
 * @param {Array} products - 產品列表
 * @param {string} certPattern - 正規化的認證字串
 * @param {string} viscosity - 黏度（可選）
 * @returns {Array} 匹配的產品
 */
function filterProductsByCert(products, certPattern, viscosity = null) {
    return products.filter(p => {
        if (!p.cert) return false;

        const certValue = normalizeCert(p.cert);
        const certMatch = certValue.includes(certPattern);
        if (!certMatch) return false;

        // 如果有黏度條件，還要匹配黏度
        if (viscosity) {
            const word2 = normalizeViscosity(p.word2 || '');
            const targetVisc = normalizeViscosity(viscosity);
            if (!word2.includes(targetVisc)) return false;
        }
        return true;
    });
}

/**
 * 取得車輛適用的認證
 * 整合原本 knowledge-retriever.js 的 getCertificationForVehicle()
 *
 * @param {Object} vehicleInfo - 車型資訊（可包含 vehicleBrand, isMotorcycle 等）
 * @returns {Object|null} 認證資訊
 */
function getCertificationForVehicle(vehicleInfo) {
    if (!vehicleInfo) return null;

    const vehicleSpecs = getVehicleSpecs();
    if (!vehicleSpecs || !vehicleSpecs._metadata) return null;

    const metadata = vehicleSpecs._metadata;
    const result = {};

    // Ford 特殊處理
    if (vehicleInfo.vehicleBrand === 'Ford' && metadata.special_certifications?.ford) {
        result.ford = metadata.special_certifications.ford;
    }

    // JASO 規則
    if (vehicleInfo.isMotorcycle && metadata.jaso_rules) {
        result.jaso = metadata.jaso_rules;
    }

    return Object.keys(result).length > 0 ? result : null;
}

/**
 * 取得 JASO 認證（根據摩托車類型）
 *
 * @param {boolean} isScooter - 是否為速克達
 * @returns {Object} JASO 認證資訊
 */
function getJasoCertification(isScooter) {
    if (isScooter) {
        return {
            certification: 'JASO MB',
            reason: '速克達無濕式離合器',
            searchKeywords: ['Scooter', 'JASO MB']
        };
    } else {
        return {
            certification: 'JASO MA2',
            reason: '檔車/重機有濕式離合器',
            searchKeywords: ['Street', 'Race', 'JASO MA2', 'JASO MA']
        };
    }
}

/**
 * 檢查產品是否符合 JASO 認證要求
 * 整合原本 search.js 中的 JASO 過濾邏輯
 *
 * @param {Object} product - 產品資料
 * @param {boolean} isScooter - 是否為速克達
 * @returns {Object} { matches: boolean, reason: string }
 */
function checkJasoCertification(product, isScooter) {
    if (!product) {
        return { matches: false, reason: '產品資料為空' };
    }

    const cert = normalizeCert(product.cert || '');
    const title = (product.title || '').toUpperCase();

    if (isScooter) {
        // 速克達：優先 JASO MB，排除純 MA/MA2 產品
        const hasMB = cert.includes('JASOMB') || cert.includes('MB') || title.includes('SCOOTER');
        const hasOnlyMA = (cert.includes('JASOMA2') || cert.includes('JASOMA')) && !hasMB;

        if (hasOnlyMA) {
            return { matches: false, reason: '此產品僅適用於檔車（JASO MA/MA2），不適合速克達' };
        }
        if (!hasMB && !title.includes('SCOOTER')) {
            return { matches: false, reason: '速克達需要 JASO MB 認證產品' };
        }
        return { matches: true, reason: 'JASO MB 認證適合速克達' };
    } else {
        // 檔車/重機：需要 JASO MA/MA2
        const hasMA = cert.includes('JASOMA2') || cert.includes('JASOMA') || cert.includes('MA2') || cert.includes('MA');
        if (!hasMA) {
            return { matches: false, reason: '檔車/重機需要 JASO MA/MA2 認證產品' };
        }
        return { matches: true, reason: 'JASO MA/MA2 認證適合檔車/重機' };
    }
}

// filterMotorcycleProducts 已移至 motorcycle-rules.js，請從該模組導入

/**
 * 取得認證的兼容認證列表
 *
 * @param {string} cert - 認證名稱
 * @returns {Array<string>} 兼容認證列表
 */
function getCompatibleCerts(cert) {
    const certCompatibility = getCertCompatibility();
    const normalized = normalizeCert(cert);
    const compatible = [];

    for (const [standard, upgrades] of Object.entries(certCompatibility)) {
        if (standard === '_description') continue;

        for (const [upgradeCert, compatibleWith] of Object.entries(upgrades)) {
            if (normalizeCert(upgradeCert) === normalized) {
                compatible.push(...compatibleWith);
            }
            if (compatibleWith.some(c => normalizeCert(c) === normalized)) {
                compatible.push(upgradeCert);
            }
        }
    }

    return [...new Set(compatible)];
}

/**
 * 判斷認證是否相容
 *
 * @param {string} productCert - 產品認證
 * @param {string} requiredCert - 需求認證
 * @returns {boolean}
 */
function isCertCompatible(productCert, requiredCert) {
    if (!productCert || !requiredCert) return false;

    const normalizedProduct = normalizeCert(productCert);
    const normalizedRequired = normalizeCert(requiredCert);

    // 精確匹配
    if (normalizedProduct.includes(normalizedRequired)) return true;

    // 檢查升級兼容
    const certCompatibility = getCertCompatibility();
    for (const [standard, upgrades] of Object.entries(certCompatibility)) {
        if (standard === '_description') continue;

        for (const [upgradeCert, compatibleWith] of Object.entries(upgrades)) {
            const normalizedUpgrade = normalizeCert(upgradeCert);
            if (normalizedProduct.includes(normalizedUpgrade)) {
                // 產品有升級認證，檢查是否兼容需求認證
                if (compatibleWith.some(c => normalizeCert(c) === normalizedRequired)) {
                    return true;
                }
            }
        }
    }

    return false;
}

// ============================================
// 輔助函式
// ============================================

/**
 * 正規化認證字串（移除連字號、空格，轉大寫）
 * @param {string} cert
 * @returns {string}
 */
function normalizeCert(cert) {
    if (!cert) return '';
    return cert.toUpperCase().replace(/[-\s]/g, '');
}

/**
 * 正規化黏度字串
 * @param {string} viscosity
 * @returns {string}
 */
function normalizeViscosity(viscosity) {
    if (!viscosity) return '';
    return viscosity.toUpperCase().replace(/-/g, '');
}

/**
 * 從文字中偵測認證
 *
 * @param {string} text - 文字
 * @returns {Object|null} { cert: string, type: string }
 */
function detectCertification(text) {
    if (!text) return null;

    const certPatterns = [
        { pattern: /(?:ILSAC\s*)?GF[-\s]?(\d+[AB]?)/i, type: 'ILSAC', prefix: 'GF-' },
        { pattern: /API\s*(S[A-Z]|C[A-Z])/i, type: 'API', prefix: 'API ' },
        { pattern: /JASO\s*(MA2?|MB)/i, type: 'JASO', prefix: 'JASO ' },
        { pattern: /ACEA\s*([A-Z]\d)/i, type: 'ACEA', prefix: 'ACEA ' }
    ];

    for (const { pattern, type, prefix } of certPatterns) {
        const match = text.match(pattern);
        if (match) {
            return {
                cert: `${prefix}${match[1].toUpperCase()}`,
                type
            };
        }
    }

    return null;
}

/**
 * 速克達認證評分（用於排序）
 * MB > MA/MA2
 *
 * @param {string} cert - 認證字串
 * @returns {number} 分數
 */
function getScooterCertScore(cert) {
    if (!cert) return 5;
    const c = normalizeCert(cert);

    // JASO MB 最優先 (10分)
    if (c.includes('JASOMB') || c.includes('MB')) return 10;

    // JASO MA/MA2 較低優先 (1分)
    if (c.includes('JASOMA')) return 1;

    return 5;
}

/**
 * 清除快取
 */
function clearCache() {
    certCompatibilityCache = null;
    vehicleSpecsCache = null;
    console.log('[CertMatcher] Cache cleared');
}

// ============================================
// 匯出
// ============================================
module.exports = {
    // 核心匹配函式
    searchWithCertUpgrade,
    getCertificationForVehicle,
    getJasoCertification,
    checkJasoCertification,
    // filterMotorcycleProducts 已移至 motorcycle-rules.js

    // 兼容性查詢
    getCompatibleCerts,
    isCertCompatible,

    // 偵測與評分
    detectCertification,
    getScooterCertScore,

    // 輔助函式
    normalizeCert,
    normalizeViscosity,
    filterProductsByCert,

    // 工具
    createCertMatchResult,
    clearCache
};
