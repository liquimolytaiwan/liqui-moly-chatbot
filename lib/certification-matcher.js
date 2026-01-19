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

// ============================================
// API/ILSAC 認證優先級（越新越好，向後兼容）
// ============================================
// 日韓系車大多使用 API/ILSAC 認證，新認證向後兼容舊認證
// SQ > SP > SN > SM > SL (汽油引擎)
// CK > CJ > CI > CH (柴油引擎)
const API_GASOLINE_PRIORITY = ['SQ', 'SP', 'SN', 'SM', 'SL', 'SJ'];  // 最新到最舊
const API_DIESEL_PRIORITY = ['CK', 'CJ', 'CI', 'CH', 'CG'];
// ILSAC 優先級：注意要讓較長的字串優先匹配（GF6A/GF6B 在 GF6 之前）
const ILSAC_PRIORITY = ['GF7A', 'GF7B', 'GF7', 'GF6A', 'GF6B', 'GF6', 'GF5', 'GF4'];  // 正規化後

// 歐系車 OEM 認證（需精確匹配，不可隨意升級）
const OEM_CERT_PATTERNS = [
    /VW\s*\d{3}\s*\d{2}/i,           // VW 504 00, VW 508 00
    /BMW\s*LL[-\s]?\d{2}/i,          // BMW LL-01, BMW LL-04
    /MB\s*\d{3}\.\d+/i,              // MB 229.5, MB 229.51
    /PORSCHE\s*[A-Z]\d+/i,           // Porsche A40
    /DEXOS\s*\d/i,                   // Dexos 1, Dexos 2
    /FORD\s*WSS[-\s]?M2C/i           // Ford WSS-M2C
];

/**
 * 判斷認證是否為 OEM 認證（歐系車廠認證）
 * OEM 認證需要精確匹配，不可隨意升級降級
 * @param {string} cert - 認證字串
 * @returns {boolean}
 */
function isOEMCertification(cert) {
    if (!cert) return false;
    return OEM_CERT_PATTERNS.some(pattern => pattern.test(cert));
}

/**
 * 判斷認證是否為 API/ILSAC 認證（日韓系車常用）
 * API/ILSAC 認證新版向後兼容舊版，可升級推薦
 * @param {string} cert - 認證字串
 * @returns {boolean}
 */
function isAPICertification(cert) {
    if (!cert) return false;
    const upper = cert.toUpperCase();
    // API SN, API SP, ILSAC GF-6A 等
    return /API\s*S[A-Z]/i.test(upper) ||
        /API\s*C[A-Z]/i.test(upper) ||
        /GF[-\s]?\d/i.test(upper) ||
        /ILSAC/i.test(upper);
}

/**
 * 取得 API 認證的優先級分數（越新分數越高）
 * @param {string} cert - 認證字串
 * @returns {number} 優先級分數（0 表示未找到）
 */
function getAPICertPriority(cert) {
    if (!cert) return 0;
    const normalized = normalizeCert(cert);

    // 使用正則表達式精確提取認證等級
    // API 汽油認證: API SN, API SP, API SQ 等
    const apiGasMatch = normalized.match(/API(S[A-Z])|(?:^|[^A-Z])(S[A-Z])(?:[^A-Z]|$)/);
    if (apiGasMatch) {
        const certLevel = (apiGasMatch[1] || apiGasMatch[2]);
        const idx = API_GASOLINE_PRIORITY.indexOf(certLevel);
        if (idx >= 0) {
            return API_GASOLINE_PRIORITY.length - idx;  // SQ=6, SP=5, SN=4...
        }
    }

    // API 柴油認證: API CK, API CJ 等
    const apiDieselMatch = normalized.match(/API(C[A-Z])|(?:^|[^A-Z])(C[A-Z])(?:[^A-Z]|$)/);
    if (apiDieselMatch) {
        const certLevel = (apiDieselMatch[1] || apiDieselMatch[2]);
        const idx = API_DIESEL_PRIORITY.indexOf(certLevel);
        if (idx >= 0) {
            return API_DIESEL_PRIORITY.length - idx;
        }
    }

    // ILSAC 認證: GF-6A, GF-7A 等 (先檢查較長的變體)
    const ilsacMatch = normalized.match(/GF(\d+)([AB])?/);
    if (ilsacMatch) {
        const version = ilsacMatch[1];
        const variant = ilsacMatch[2] || '';
        const fullCert = `GF${version}${variant}`;

        const idx = ILSAC_PRIORITY.indexOf(fullCert);
        if (idx >= 0) {
            return ILSAC_PRIORITY.length - idx;
        }
        // 如果沒找到變體，嘗試不帶變體的版本
        const baseIdx = ILSAC_PRIORITY.indexOf(`GF${version}`);
        if (baseIdx >= 0) {
            return ILSAC_PRIORITY.length - baseIdx;
        }
    }

    return 0;
}

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
 * 🔧 P0 優化：支援認證別名匹配（如 BMW LL-01 = BMW Longlife-01）
 *
 * @param {Array} products - 產品列表
 * @param {string} certPattern - 正規化的認證字串
 * @param {string} viscosity - 黏度（可選）
 * @returns {Array} 匹配的產品
 */
function filterProductsByCert(products, certPattern, viscosity = null) {
    // 取得搜尋認證的所有變體（縮寫和完整名稱）
    const searchVariants = getCertVariants(certPattern);
    console.log(`[CertMatcher] Searching cert variants: ${searchVariants.join(', ')}`);

    return products.filter(p => {
        if (!p.cert) return false;

        // 取得產品認證的所有變體
        const productVariants = getCertVariants(p.cert);

        // 任一搜尋變體匹配任一產品變體即可
        const certMatch = searchVariants.some(searchVar =>
            productVariants.some(prodVar => prodVar.includes(searchVar))
        );
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
 * 認證優先搜尋（黏度降級機制）
 * 當認證+黏度無結果時，優先保證認證正確，放寬黏度要求
 *
 * 搜尋優先級：
 * 1. 精確匹配（認證 + 黏度）
 * 2. 認證匹配（忽略黏度）- 降級
 * 3. 認證升級（使用兼容的更高等級認證）
 *
 * @param {Array} products - 產品列表
 * @param {string} requestedCert - 需求認證 (如 "VW 508 00")
 * @param {string} requestedViscosity - 需求黏度 (如 "5W-20")
 * @returns {Object} { products, fallbackUsed, fallbackType, notice, usedCert, requestedViscosity }
 */
function searchWithViscosityFallback(products, requestedCert, requestedViscosity) {
    const result = {
        products: [],
        fallbackUsed: false,
        fallbackType: null,  // 'viscosity' | 'cert_upgrade' | null
        notice: null,
        usedCert: requestedCert,
        requestedViscosity: requestedViscosity
    };

    if (!requestedCert) {
        return result;
    }

    const normalizedCert = normalizeCert(requestedCert);
    console.log(`[CertMatcher] ViscosityFallback: Searching for ${requestedCert}${requestedViscosity ? ` + ${requestedViscosity}` : ''}`);

    // Step 1: 精確搜尋（認證 + 黏度）
    if (requestedViscosity) {
        let matches = filterProductsByCert(products, normalizedCert, requestedViscosity);
        if (matches.length > 0) {
            console.log(`[CertMatcher] Exact match: ${matches.length} products with ${requestedCert} + ${requestedViscosity}`);
            result.products = matches;
            return result;
        }
    }

    // Step 2: 降級搜尋（只匹配認證，忽略黏度）
    let matches = filterProductsByCert(products, normalizedCert, null);
    if (matches.length > 0) {
        console.log(`[CertMatcher] Viscosity fallback: ${matches.length} products with ${requestedCert} (any viscosity)`);
        result.products = matches;
        result.fallbackUsed = true;
        result.fallbackType = 'viscosity';
        if (requestedViscosity) {
            result.notice = `目前沒有同時符合 ${requestedCert} 認證且黏度為 ${requestedViscosity} 的產品。\n以下推薦符合 ${requestedCert} 認證的其他黏度產品，這些產品符合原廠認證要求：`;
        }
        return result;
    }

    // Step 3: 嘗試認證升級（使用現有的 searchWithCertUpgrade 邏輯）
    const upgradeResult = searchWithCertUpgrade(products, requestedCert, null);
    if (upgradeResult.products.length > 0) {
        result.products = upgradeResult.products;
        result.fallbackUsed = true;
        result.fallbackType = 'cert_upgrade';
        result.usedCert = upgradeResult.usedCert;
        result.notice = upgradeResult.certNotice;
        return result;
    }

    // Step 4: 無結果
    console.log(`[CertMatcher] No products found for ${requestedCert}`);
    result.notice = `目前沒有符合 ${requestedCert} 認證的產品`;
    return result;
}

/**
 * 🌟 認證優先搜尋（智慧推薦）
 *
 * 根據認證類型採用不同策略：
 * - API/ILSAC 認證（日韓系車）：優先推薦最新認證產品（SQ > SP > SN）
 * - OEM 認證（歐系車）：嚴格精確匹配，不可隨意升級
 *
 * @param {Array} products - 產品列表
 * @param {string} requestedCert - 需求認證 (如 "API SN", "VW 508 00")
 * @param {string} requestedViscosity - 需求黏度 (如 "5W-30")
 * @returns {Object} 搜尋結果
 */
function searchWithCertPriority(products, requestedCert, requestedViscosity) {
    const result = {
        products: [],
        fallbackUsed: false,
        fallbackType: null,  // 'cert_upgrade' | 'viscosity' | null
        notice: null,
        usedCert: requestedCert,
        requestedViscosity: requestedViscosity,
        certStrategy: null   // 'oem_exact' | 'api_newest' | null
    };

    if (!requestedCert) {
        return result;
    }

    console.log(`[CertMatcher] CertPriority search: ${requestedCert}${requestedViscosity ? ` + ${requestedViscosity}` : ''}`);

    // 判斷認證類型
    const isOEM = isOEMCertification(requestedCert);
    const isAPI = isAPICertification(requestedCert);

    console.log(`[CertMatcher] Cert type: ${isOEM ? 'OEM (exact match)' : isAPI ? 'API/ILSAC (newest first)' : 'Unknown'}`);

    if (isOEM) {
        // ==========================================
        // 歐系車 OEM 認證：嚴格精確匹配
        // ==========================================
        const oemResult = searchWithViscosityFallback(products, requestedCert, requestedViscosity);
        // 將 certStrategy 加入結果
        return {
            ...oemResult,
            certStrategy: 'oem_exact'
        };

    } else if (isAPI) {
        // ==========================================
        // 日韓系車 API/ILSAC 認證：最新認證優先
        // ==========================================
        result.certStrategy = 'api_newest';

        // Step 1: 收集所有符合黏度的產品（如果有指定黏度）
        let candidateProducts = products;
        if (requestedViscosity) {
            candidateProducts = products.filter(p => {
                const word2 = normalizeViscosity(p.word2 || '');
                const targetVisc = normalizeViscosity(requestedViscosity);
                return word2.includes(targetVisc);
            });
            console.log(`[CertMatcher] Filtered by viscosity ${requestedViscosity}: ${candidateProducts.length} products`);
        }

        // Step 2: 篩選有 API/ILSAC 認證的產品
        const apiProducts = candidateProducts.filter(p => {
            if (!p.cert) return false;
            return isAPICertification(p.cert);
        });

        if (apiProducts.length === 0) {
            console.log(`[CertMatcher] No API/ILSAC certified products found`);
            // 回退到一般搜尋
            return searchWithViscosityFallback(products, requestedCert, requestedViscosity);
        }

        // Step 3: 按認證優先級排序（最新認證排最前）
        const sortedProducts = apiProducts.sort((a, b) => {
            const priorityA = getAPICertPriority(a.cert);
            const priorityB = getAPICertPriority(b.cert);
            return priorityB - priorityA;  // 降序：最新認證排最前
        });

        // Step 4: 檢查是否有比請求認證更新的產品
        const requestedPriority = getAPICertPriority(requestedCert);
        const topProductPriority = getAPICertPriority(sortedProducts[0]?.cert);

        console.log(`[CertMatcher] Requested cert priority: ${requestedPriority}, Top product priority: ${topProductPriority}`);

        if (topProductPriority > requestedPriority) {
            // 有更新的認證產品！
            result.products = sortedProducts;
            result.fallbackUsed = true;
            result.fallbackType = 'cert_upgrade';

            // 找出最新認證名稱
            const newestCert = extractAPICertName(sortedProducts[0].cert);
            result.usedCert = newestCert;
            result.notice = `您查詢的 ${requestedCert} 認證已有更新版本。以下推薦符合最新 ${newestCert} 認證的產品（向後兼容 ${requestedCert}）：`;

            console.log(`[CertMatcher] Upgraded to ${newestCert}: ${sortedProducts.length} products`);
            return result;

        } else {
            // 沒有更新的，返回符合請求認證的產品
            const exactMatches = sortedProducts.filter(p => {
                const normalized = normalizeCert(p.cert);
                const requestedNorm = normalizeCert(requestedCert);
                return normalized.includes(requestedNorm);
            });

            if (exactMatches.length > 0) {
                result.products = exactMatches;
                console.log(`[CertMatcher] Exact match for ${requestedCert}: ${exactMatches.length} products`);
                return result;
            }

            // 沒有精確匹配，返回所有排序後的產品
            result.products = sortedProducts;
            return result;
        }

    } else {
        // ==========================================
        // 未知認證類型：使用原有搜尋邏輯
        // ==========================================
        const unknownResult = searchWithViscosityFallback(products, requestedCert, requestedViscosity);
        return {
            ...unknownResult,
            certStrategy: 'unknown'
        };
    }
}

/**
 * 從認證字串中提取 API 認證名稱
 * @param {string} cert - 認證字串
 * @returns {string} API 認證名稱
 */
function extractAPICertName(cert) {
    if (!cert) return '';

    // 嘗試提取 API 認證
    const apiMatch = cert.match(/API\s*(S[A-Z]|C[A-Z])/i);
    if (apiMatch) {
        return `API ${apiMatch[1].toUpperCase()}`;
    }

    // 嘗試提取 ILSAC 認證
    const ilsacMatch = cert.match(/(?:ILSAC\s*)?GF[-\s]?(\d+[AB]?)/i);
    if (ilsacMatch) {
        return `ILSAC GF-${ilsacMatch[1].toUpperCase()}`;
    }

    return cert;
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
// 認證別名映射表（常見縮寫 -> 資料庫名稱）
// ============================================
const CERT_ALIASES = {
    // BMW 認證別名
    'LL01': 'LONGLIFE01',
    'LL04': 'LONGLIFE04',
    'LL12FE': 'LONGLIFE12FE',
    'LL14FE': 'LONGLIFE14FE',
    'LL17FE': 'LONGLIFE17FE',
    // VW/AUDI 認證別名（如有需要可擴充）
    // 'LongLife': 'LONGLIFE',  // 反向映射（如果用戶輸入全名）
};

// 反向映射（資料庫名稱 -> 縮寫）用於搜尋時嘗試兩種格式
const CERT_ALIASES_REVERSE = {
    'LONGLIFE01': 'LL01',
    'LONGLIFE04': 'LL04',
    'LONGLIFE12FE': 'LL12FE',
    'LONGLIFE14FE': 'LL14FE',
    'LONGLIFE17FE': 'LL17FE',
};

// ============================================
// 輔助函式
// ============================================

/**
 * 正規化認證字串（移除連字號、空格，轉大寫，並應用別名映射）
 * @param {string} cert
 * @param {boolean} expandAlias - 是否將縮寫展開為完整名稱（預設 true）
 * @returns {string}
 */
function normalizeCert(cert, expandAlias = true) {
    if (!cert) return '';
    let normalized = cert.toUpperCase().replace(/[-\s]/g, '');

    // 應用別名映射（將縮寫轉換為完整名稱）
    if (expandAlias) {
        for (const [alias, fullName] of Object.entries(CERT_ALIASES)) {
            // 直接替換別名為完整名稱（例如 LL01 -> LONGLIFE01）
            // 使用 word boundary 確保精確匹配
            if (normalized.includes(alias)) {
                normalized = normalized.replace(alias, fullName);
            }
        }
    }

    return normalized;
}

/**
 * 取得認證的所有可能變體（用於搜尋時嘗試多種格式）
 * @param {string} cert - 認證字串
 * @returns {string[]} 所有可能的正規化變體
 */
function getCertVariants(cert) {
    if (!cert) return [];

    const baseNormalized = cert.toUpperCase().replace(/[-\s]/g, '');
    const variants = new Set([baseNormalized]);

    // 嘗試展開別名
    const expanded = normalizeCert(cert, true);
    variants.add(expanded);

    // 嘗試反向映射（如果輸入的是完整名稱，也嘗試縮寫）
    for (const [fullName, alias] of Object.entries(CERT_ALIASES_REVERSE)) {
        if (baseNormalized.includes(fullName)) {
            variants.add(baseNormalized.replace(fullName, alias));
        }
    }

    return [...variants];
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
    searchWithViscosityFallback,  // 認證優先、黏度降級搜尋
    searchWithCertPriority,       // 🌟 智慧認證搜尋（API最新優先 / OEM精確匹配）
    getCertificationForVehicle,
    getJasoCertification,
    checkJasoCertification,
    // filterMotorcycleProducts 已移至 motorcycle-rules.js

    // 兼容性查詢
    getCompatibleCerts,
    isCertCompatible,

    // 認證類型判斷
    isOEMCertification,           // 判斷是否為歐系 OEM 認證
    isAPICertification,           // 判斷是否為 API/ILSAC 認證
    getAPICertPriority,           // 取得 API 認證優先級分數

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
