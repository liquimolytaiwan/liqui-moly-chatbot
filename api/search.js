/**
 * LIQUI MOLY Chatbot - Vercel Serverless Function
 * 統一產品搜尋邏輯（完整版）
 * 
 * 功能：
 * - 完整 Title Expansion（含多 SKU 匹配）
 * - 多車型分類輸出
 * - 症狀格式化說明
 * - 產品快取機制
 * - 認證兼容性搜尋（GF-7A → GF-6A 等）
 */

import fs from 'fs';
import path from 'path';

const WIX_API_URL = 'https://www.liqui-moly-tw.com/_functions';
const PRODUCT_BASE_URL = 'https://www.liqui-moly-tw.com/products/';

// 產品快取 (30 分鐘過期)
let productsCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 分鐘

// 載入認證兼容表
let certCompatibility = null;
try {
    const refPath = path.join(process.cwd(), 'data', 'knowledge', 'search-reference.json');
    const searchRef = JSON.parse(fs.readFileSync(refPath, 'utf-8'));
    certCompatibility = searchRef.certification_compatibility || null;
    console.log('[Search] Certification compatibility table loaded');
} catch (e) {
    console.warn('[Search] Failed to load certification compatibility:', e.message);
}

// CORS headers
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
};

export default async function handler(req, res) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        Object.keys(corsHeaders).forEach(key => res.setHeader(key, corsHeaders[key]));
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { message, searchInfo } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Missing message parameter' });
        }

        // 取得產品列表 (使用快取)
        const products = await getProducts();

        // Debug: 輸出 searchInfo 內容
        console.log('[Search] Received searchInfo:', JSON.stringify(searchInfo || {}, null, 2));

        if (!products || products.length === 0) {
            Object.keys(corsHeaders).forEach(key => res.setHeader(key, corsHeaders[key]));
            return res.status(200).json({
                success: true,
                productContext: '目前沒有產品資料'
            });
        }

        // 執行完整版搜尋
        const productContext = searchProducts(products, message, searchInfo);

        Object.keys(corsHeaders).forEach(key => res.setHeader(key, corsHeaders[key]));
        return res.status(200).json({
            success: true,
            productContext
        });

    } catch (error) {
        console.error('Search API error:', error);
        Object.keys(corsHeaders).forEach(key => res.setHeader(key, corsHeaders[key]));
        return res.status(500).json({ success: false, error: error.message });
    }
}

// ============================================
// 從 Wix 取得產品列表 (使用快取)
// ============================================
async function getProducts() {
    const now = Date.now();

    // 檢查快取是否有效
    if (productsCache && (now - cacheTimestamp) < CACHE_DURATION) {
        console.log('[Search] Using cached products:', productsCache.length);
        return productsCache;
    }

    try {
        console.log('[Search] Fetching products from Wix...');
        const response = await fetch(`${WIX_API_URL}/products`);
        const data = await response.json();

        if (data.success && data.products) {
            productsCache = data.products;
            cacheTimestamp = now;
            console.log('[Search] Fetched and cached products:', productsCache.length);
            return productsCache;
        }
    } catch (e) {
        console.error('[Search] Failed to fetch products:', e);
    }

    return productsCache || [];
}

// ============================================
// 完整版搜尋邏輯（移植自 Wix searchProducts）
// ============================================

// ============================================
// 認證搜尋（含升級兼容機制）
// ============================================
/**
 * 根據認證和黏度進行交集搜尋，支援認證升級
 * @param {Array} products - 產品列表
 * @param {string} requestedCert - 用戶請求的認證 (如 "GF-6A")
 * @param {string} viscosity - 可選的黏度 (如 "5W-30")
 * @returns {Object} { products, requestedCert, usedCert, isUpgrade, certNotice }
 */
function searchWithCertUpgrade(products, requestedCert, viscosity = null) {
    if (!requestedCert || !certCompatibility) {
        return { products: [], requestedCert, usedCert: null, isUpgrade: false, certNotice: null };
    }

    const normalizedRequest = requestedCert.toUpperCase().replace(/[-\s]/g, '');
    console.log(`[CertSearch] Searching for: ${requestedCert}${viscosity ? ` + ${viscosity}` : ''}`);

    // 搜尋產品的輔助函式
    const searchProducts = (certPattern, visc = null) => {
        return products.filter(p => {
            if (!p.cert) return false;
            const certValue = p.cert.toUpperCase().replace(/[-\s]/g, '');
            const certMatch = certValue.includes(certPattern);
            if (!certMatch) return false;

            // 如果有黏度條件，還要匹配黏度
            if (visc) {
                const word2 = (p.word2 || '').toUpperCase().replace('-', '');
                const targetVisc = visc.toUpperCase().replace('-', '');
                if (!word2.includes(targetVisc)) return false;
            }
            return true;
        });
    };

    // 1. 先精確搜尋用戶請求的認證
    let results = searchProducts(normalizedRequest, viscosity);
    if (results.length > 0) {
        console.log(`[CertSearch] Found ${results.length} products with exact cert: ${requestedCert}`);
        return {
            products: results,
            requestedCert,
            usedCert: requestedCert,
            isUpgrade: false,
            certNotice: null
        };
    }

    // 2. 查找升級認證
    console.log(`[CertSearch] No exact match, looking for upgrade certification...`);

    // 遍歷所有認證標準（ILSAC, API, JASO）
    for (const [standard, upgrades] of Object.entries(certCompatibility)) {
        if (standard === '_description') continue;

        // 遍歷每個升級認證
        for (const [upgradeCert, compatibleWith] of Object.entries(upgrades)) {
            const normalizedUpgrade = upgradeCert.toUpperCase().replace(/[-\s]/g, '');

            // 檢查用戶請求的認證是否在兼容列表中
            const isCompatible = compatibleWith.some(c =>
                c.toUpperCase().replace(/[-\s]/g, '') === normalizedRequest
            );

            if (isCompatible) {
                // 嘗試用升級認證搜尋
                results = searchProducts(normalizedUpgrade, viscosity);
                if (results.length > 0) {
                    console.log(`[CertSearch] Found ${results.length} products with upgrade cert: ${upgradeCert} (compatible with ${requestedCert})`);
                    return {
                        products: results,
                        requestedCert,
                        usedCert: upgradeCert,
                        isUpgrade: true,
                        certNotice: `目前無 ${requestedCert} 認證產品，以下是 ${upgradeCert} 認證產品（向後兼容 ${requestedCert}）`
                    };
                }
            }
        }
    }

    // 3. 都沒有結果
    console.log(`[CertSearch] No products found for ${requestedCert} or compatible upgrades`);
    return {
        products: [],
        requestedCert,
        usedCert: null,
        isUpgrade: false,
        certNotice: `目前沒有符合 ${requestedCert}${viscosity ? ` + ${viscosity}` : ''} 的產品`
    };
}
function searchProducts(products, query, searchInfo) {
    try {
        let allResults = [];
        const seenIds = new Set();
        const productCategory = searchInfo?.productCategory || '機油';

        // ============================================
        // 0. 認證搜尋優先處理（當用戶明確詢問認證時）
        // ============================================
        const certSearchRequest = searchInfo?.certificationSearch;
        if (certSearchRequest && certSearchRequest.requestedCert) {
            console.log('[Search] Certification search mode activated:', JSON.stringify(certSearchRequest));

            const certResult = searchWithCertUpgrade(
                products,
                certSearchRequest.requestedCert,
                certSearchRequest.viscosity || null
            );

            if (certResult.products.length > 0) {
                // 將認證搜尋結果加入
                for (const p of certResult.products.slice(0, 30)) {
                    if (p.id && !seenIds.has(p.id)) {
                        seenIds.add(p.id);
                        allResults.push(p);
                    }
                }

                // 傳遞認證通知給格式化函式
                const formattedResult = formatProducts(allResults, {
                    ...searchInfo,
                    certNotice: certResult.certNotice,
                    usedCert: certResult.usedCert,
                    isUpgrade: certResult.isUpgrade,
                    requestedCert: certResult.requestedCert
                });
                return formattedResult;
            } else {
                // 無結果時，返回明確的無結果訊息
                return `## ⚠️ 查無符合條件的產品

${certResult.certNotice || `目前沒有符合 ${certSearchRequest.requestedCert} 認證的產品`}

請確認：
1. 認證名稱是否正確（如 ILSAC GF-6A、API SP 等）
2. 是否可接受更高等級的兼容認證`;
            }
        }

        // 0.5 用戶定義的明確搜尋規則 (User Defined Rules) - 只針對機油
        const vehicleInfo = searchInfo?.vehicles?.[0];
        if (vehicleInfo && vehicleInfo.vehicleType === '摩托車' && productCategory === '機油') {
            console.log('[Search] Using User Defined Motorcycle Rules (Oil):', JSON.stringify(vehicleInfo));

            // 先檢查有多少 Motorbike 產品
            const motorbikeProducts = products.filter(p => p.title && p.title.toLowerCase().includes('motorbike'));
            console.log(`[Search] Total Motorbike products in DB: ${motorbikeProducts.length}`);

            // Debug: 列出前 5 個 Motorbike 產品的 cert 欄位格式
            const certSamples = motorbikeProducts.slice(0, 5).map(p => ({ title: p.title?.substring(0, 50), cert: p.cert, word2: p.word2 }));
            console.log('[Search] Motorbike cert samples:', JSON.stringify(certSamples));

            const matches = products.filter(p => {
                // Rule 1: Title must contain "Motorbike" (Case Insensitive)
                if (!p.title || !p.title.toLowerCase().includes('motorbike')) return false;

                // Rule 2: Classification (JASO) via "cert" field - 放寬匹配條件
                const cert = (p.cert || '').toUpperCase().replace(/[-\s]/g, ''); // 移除連字號和空格
                const title = (p.title || '').toUpperCase();

                if (vehicleInfo.vehicleSubType === '速克達' || (vehicleInfo.certifications && vehicleInfo.certifications.includes('JASO MB'))) {
                    // 速克達/JASO MB：多種格式匹配
                    const hasMB = cert.includes('JASOMB') || cert.includes('MB') || title.includes('SCOOTER');
                    // 排除 MA2/MA 產品（這些是給檔車的）
                    const hasMA = cert.includes('JASOMA2') || cert.includes('JASOMA') || (cert.includes('MA') && !cert.includes('MB'));
                    if (hasMA && !hasMB) return false;  // 有 MA 沒有 MB → 不要
                    if (!hasMB && !title.includes('SCOOTER')) return false;  // 沒有 MB 也不是 Scooter 標題 → 不要
                } else {
                    // 檔車/重機/一般摩托車 (預設 JASO MA/MA2)
                    if (vehicleInfo.certifications && (vehicleInfo.certifications.includes('JASO MA2') || vehicleInfo.certifications.includes('JASO MA'))) {
                        const hasMA = cert.includes('JASOMA2') || cert.includes('JASOMA') || cert.includes('MA2') || cert.includes('MA');
                        if (!hasMA) return false;
                    }
                }

                // Rule 3: Viscosity via "word2" field - 放寬匹配
                if (vehicleInfo.viscosity) {
                    const word2 = (p.word2 || '').toUpperCase().replace('-', '');
                    const targetViscosity = vehicleInfo.viscosity.toUpperCase().replace('-', '');
                    // 簡單包含匹配 (e.g., matching "10W40" in word2)
                    if (!word2.includes(targetViscosity)) return false;
                }

                return true;
            });

            console.log(`[Search] User Rules matched ${matches.length} products`);
            if (matches.length > 0) {
                // Debug: 列出匹配到的產品
                console.log('[Search] Matched products:', matches.slice(0, 3).map(p => p.title));

                // 全合成優先排序（跑山/賽道場景）
                const recommendSynthetic = searchInfo?.recommendSynthetic;
                if (recommendSynthetic === 'full' && matches.length > 1) {
                    console.log('[Search] Applying synthetic priority sorting for User Rules (full synthetic first)');
                    matches.sort((a, b) => {
                        const aScore = getSyntheticScore(a.title);
                        const bScore = getSyntheticScore(b.title);
                        return bScore - aScore; // 降冪排序，全合成優先
                    });
                    console.log('[Search] After sorting:', matches.slice(0, 3).map(p => p.title));
                }

                return formatProducts(matches.slice(0, 30), searchInfo);
            } else {
                console.log('[Search] User Rules matched 0 products, falling back to query search');
            }
        }

        // 1. 執行 Vercel 傳來的搜尋指令
        const queries = searchInfo?.wixQueries || [];

        if (queries.length > 0) {
            for (const task of queries) {
                try {
                    let matchedProducts = products.filter(p => {
                        const fieldValue = p[task.field];
                        if (!fieldValue) return false;

                        const value = String(fieldValue).toLowerCase();
                        const searchValue = String(task.value).toLowerCase();

                        if (task.method === 'contains') {
                            return value.includes(searchValue);
                        } else if (task.method === 'eq') {
                            return value === searchValue;
                        }
                        return false;
                    });

                    // 附加條件 (andContains)
                    if (task.andContains) {
                        matchedProducts = matchedProducts.filter(p => {
                            const fieldValue = p[task.andContains.field];
                            if (!fieldValue) return false;
                            return String(fieldValue).toLowerCase().includes(task.andContains.value.toLowerCase());
                        });
                    }

                    // 標題過濾 (filterTitle)
                    if (task.filterTitle && Array.isArray(task.filterTitle)) {
                        matchedProducts = matchedProducts.filter(p =>
                            p.title && task.filterTitle.some(keyword => p.title.includes(keyword))
                        );
                    }

                    // 容量篩選 (filterSize)
                    if (task.filterSize) {
                        const sizeKeyword = task.filterSize.toLowerCase();
                        matchedProducts = matchedProducts.filter(p =>
                            p.size && p.size.toLowerCase().includes(sizeKeyword)
                        );
                    }

                    // 加入結果
                    for (const p of matchedProducts.slice(0, task.limit || 20)) {
                        if (p.id && !seenIds.has(p.id)) {
                            seenIds.add(p.id);
                            allResults.push(p);
                        }
                    }
                } catch (taskError) {
                    console.error(`[Search] Task error [${task.value}]:`, taskError);
                }
            }
        }

        // 2. Fallback 搜尋（如果沒有結果）- 擴大搜尋欄位範圍
        if (allResults.length === 0) {
            console.log('[Search] No results from wixQueries, using fallback search');
            const keywords = searchInfo?.searchKeywords || [query];
            console.log('[Search] Fallback keywords:', keywords);

            for (const kw of keywords.slice(0, 4)) {
                if (!kw) continue;
                const kwLower = kw.toLowerCase();

                // 判斷關鍵字類型並對應到正確欄位
                const isSkuKeyword = /^LM\d{4,5}$/i.test(kw);
                const isViscosity = /^\d+W-?\d+$/i.test(kw);

                const matches = products.filter(p => {
                    // SKU 精確匹配 partno
                    if (isSkuKeyword && p.partno) {
                        return p.partno.toUpperCase() === kw.toUpperCase();
                    }
                    // 黏度優先匹配 word2
                    if (isViscosity && p.word2) {
                        if (p.word2.toLowerCase().includes(kwLower)) return true;
                    }
                    // 全欄位搜尋：title, sort, partno, content, word1, word2
                    const titleMatch = p.title && p.title.toLowerCase().includes(kwLower);
                    const sortMatch = p.sort && p.sort.toLowerCase().includes(kwLower);
                    const partnoMatch = p.partno && p.partno.toLowerCase().includes(kwLower);
                    const contentMatch = p.content && p.content.toLowerCase().includes(kwLower);
                    const word1Match = p.word1 && p.word1.toLowerCase().includes(kwLower);
                    const word2Match = p.word2 && p.word2.toLowerCase().includes(kwLower);
                    return titleMatch || sortMatch || partnoMatch || contentMatch || word1Match || word2Match;
                });

                for (const p of matches.slice(0, 10)) {
                    if (p.id && !seenIds.has(p.id)) {
                        seenIds.add(p.id);
                        allResults.push(p);
                    }
                }
            }
            console.log(`[Search] Fallback found ${allResults.length} products`);
        }

        // 3. Title Expansion（完整版，含多 SKU 匹配）
        if (allResults.length > 0 && allResults.length <= 20) {
            // 從 query 中提取 SKU
            const skuPattern = /(?:LM|lm)[- ]?(\d{4,5})|(?<!\d)(\d{5})(?!\d)/g;
            const allSkuMatches = [...query.matchAll(skuPattern)];
            let titlesToExpand = [];

            if (allSkuMatches.length > 0) {
                for (const skuMatch of allSkuMatches) {
                    const skuNum = skuMatch[1] || skuMatch[2];
                    const fullSku = `LM${skuNum}`;
                    const skuProduct = allResults.find(p => p.partno === fullSku);
                    if (skuProduct && skuProduct.title && !titlesToExpand.includes(skuProduct.title)) {
                        titlesToExpand.push(skuProduct.title);
                    }
                }
            }

            // 擴展同標題產品
            for (const exactTitle of titlesToExpand) {
                const sameTitle = products.filter(p => p.title === exactTitle);
                for (const p of sameTitle) {
                    if (p.id && !seenIds.has(p.id)) {
                        seenIds.add(p.id);
                        allResults.push(p);
                    }
                }
            }
        }

        // 4. 多車型處理
        const vehicles = searchInfo?.vehicles || [];
        const isMultiVehicle = searchInfo?.isMultiVehicleQuery || vehicles.length > 1;
        const vehicleType = searchInfo?.vehicleType;

        if (isMultiVehicle && productCategory === '機油') {
            const hasMotorcycle = vehicles.some(v => v.vehicleType === '摩托車');
            const hasCar = vehicles.some(v => v.vehicleType === '汽車');

            if (hasMotorcycle && hasCar) {
                // 分別過濾
                const motorcycleProducts = allResults.filter(p => {
                    const title = (p.title || '').toLowerCase();
                    const sort = (p.sort || '').toLowerCase();
                    return title.includes('motorbike') || sort.includes('摩托車');
                });

                const carProducts = allResults.filter(p => {
                    const title = (p.title || '').toLowerCase();
                    const sort = (p.sort || '').toLowerCase();
                    return !title.includes('motorbike') && !sort.includes('摩托車') && sort.includes('機油');
                });

                console.log(`[Search] Multi-Vehicle: Motorcycle=${motorcycleProducts.length}, Car=${carProducts.length}`);

                if (motorcycleProducts.length > 0 || carProducts.length > 0) {
                    return formatMultiVehicleProducts(motorcycleProducts.slice(0, 15), carProducts.slice(0, 15));
                }
            }
        }

        // 5. 單一車型摩托車過濾（含 JASO 認證過濾）
        if (vehicleType === '摩托車' && productCategory === '機油') {
            const vehicleSubType = searchInfo?.vehicles?.[0]?.vehicleSubType;
            const certifications = searchInfo?.vehicles?.[0]?.certifications || [];
            const isScooter = vehicleSubType === '速克達' || certifications.includes('JASO MB');

            const filteredResults = allResults.filter(p => {
                const title = (p.title || '').toLowerCase();
                const sort = (p.sort || '').toLowerCase();
                const cert = (p.cert || '').toUpperCase().replace(/[-\s]/g, '');

                // 必須是摩托車產品
                const isMotorbikeProduct = title.includes('motorbike') || sort.includes('摩托車') || sort.includes('motorbike') || sort.includes('scooter');
                if (!isMotorbikeProduct) return false;

                // JASO 認證過濾
                if (isScooter) {
                    // 速克達：優先 JASO MB，排除純 MA/MA2 產品
                    const hasMB = cert.includes('JASOMB') || cert.includes('MB') || title.includes('scooter');
                    const hasOnlyMA = (cert.includes('JASOMA2') || cert.includes('JASOMA')) && !hasMB;
                    if (hasOnlyMA) return false;  // 排除只有 MA 沒有 MB 的產品
                }
                // 如果是檔車且有 MA2 認證要求，這裡不做額外過濾（fallback 保留所有摩托車產品）

                return true;
            });
            console.log(`[Search] Motorcycle filter (isScooter=${isScooter}): ${allResults.length} -> ${filteredResults.length}`);
            if (filteredResults.length > 0) {
                // 在 return 前執行全合成優先排序
                const recommendSynthetic = searchInfo?.recommendSynthetic;
                if (recommendSynthetic === 'full' && filteredResults.length > 1) {
                    console.log('[Search] Applying synthetic priority sorting for motorcycle (full synthetic first)');
                    filteredResults.sort((a, b) => {
                        const aScore = getSyntheticScore(a.title);
                        const bScore = getSyntheticScore(b.title);
                        return bScore - aScore; // 降冪排序，全合成優先
                    });
                }
                return formatProducts(filteredResults.slice(0, 30), searchInfo);
            }
        }

        // 6. SKU 優先排序
        if (allResults.length > 0) {
            const skuPattern = /(?:LM|lm)[- ]?(\d{4,5})|(?<!\d)(\d{5})(?!\d)/g;
            const allSkuMatches = [...query.matchAll(skuPattern)];

            if (allSkuMatches.length > 0) {
                let allSkuProducts = [];
                let allMatchedTitles = new Set();

                for (const skuMatch of allSkuMatches) {
                    const skuNum = skuMatch[1] || skuMatch[2];
                    const fullSku = `LM${skuNum}`;
                    const skuProduct = allResults.find(p => p.partno === fullSku);

                    if (skuProduct && skuProduct.title) {
                        allMatchedTitles.add(skuProduct.title);
                        const sameTitle = allResults.filter(p => p.title === skuProduct.title);
                        allSkuProducts = allSkuProducts.concat(sameTitle);
                    }
                }

                if (allSkuProducts.length > 0) {
                    const skuProductsUnique = [...new Map(allSkuProducts.map(p => [p.id, p])).values()];
                    const others = allResults.filter(p => !allMatchedTitles.has(p.title)).slice(0, 5);
                    const prioritized = [...skuProductsUnique, ...others];
                    return formatProducts(prioritized.slice(0, 20), searchInfo);
                }
            }
        }

        // 7. 全合成優先排序與強制過濾 (Updated Logic)
        const recommendSynthetic = searchInfo?.recommendSynthetic;
        if (recommendSynthetic === 'full') {
            const fullSyntheticProducts = allResults.filter(p => getSyntheticScore(p.title) === 3);

            if (fullSyntheticProducts.length > 0) {
                console.log(`[Search] Strict filter applied: Only showing fully synthetic products (${fullSyntheticProducts.length} items)`);
                // 強制只顯示全合成產品，並按分數排序 (雖然都是 3 分，但保留排序邏輯以防未來擴充)
                fullSyntheticProducts.sort((a, b) => getSyntheticScore(b.title) - getSyntheticScore(a.title));
                return formatProducts(fullSyntheticProducts.slice(0, 20), searchInfo);
            } else {
                console.log('[Search] Strict filter returned 0 items, fallback to sorting only (Full Synthetic priority)');
                // 若找不到全合成，則退回原列表但優先排序
                allResults.sort((a, b) => getSyntheticScore(b.title) - getSyntheticScore(a.title));
            }
        }

        // 7.5 添加劑優先排序（根據症狀嚴重度、燃料類型和使用場景）
        const symptomSeverity = searchInfo?.symptomSeverity;
        const fuelTypeForAdditive = searchInfo?.fuelType || searchInfo?.vehicles?.[0]?.fuelType;
        const usageScenario = searchInfo?.usageScenario;

        // ⭐ 優先處理：如果 additiveGuideMatch 有指定解決方案產品，將這些產品提到最前面
        const additiveGuideMatch = searchInfo?.additiveGuideMatch;
        if (additiveGuideMatch?.matched && additiveGuideMatch?.items?.length > 0) {
            const solutionSkus = [];
            for (const item of additiveGuideMatch.items) {
                if (item.solutions && Array.isArray(item.solutions)) {
                    solutionSkus.push(...item.solutions);
                }
            }
            if (solutionSkus.length > 0) {
                console.log('[Search] AdditiveGuideMatch solution SKUs:', solutionSkus);

                // 將解決方案產品提到最前面
                const solutionProducts = [];
                const otherProducts = [];

                for (const p of allResults) {
                    const partno = (p.partno || '').toUpperCase();
                    if (solutionSkus.some(sku => sku.toUpperCase() === partno)) {
                        solutionProducts.push(p);
                    } else {
                        otherProducts.push(p);
                    }
                }

                // 如果解決方案產品不在 allResults 中，嘗試從全產品列表搜尋
                if (solutionProducts.length < solutionSkus.length) {
                    for (const sku of solutionSkus) {
                        const found = products.find(p => (p.partno || '').toUpperCase() === sku.toUpperCase());
                        if (found && !solutionProducts.some(sp => sp.id === found.id)) {
                            solutionProducts.push(found);
                        }
                    }
                }

                console.log('[Search] Solution products found:', solutionProducts.map(p => p.partno));

                // 重組結果：解決方案產品在前
                allResults = [...solutionProducts, ...otherProducts];
            }
        }

        if ((productCategory === '添加劑' || productCategory === '化學品') && allResults.length > 2) {
            console.log(`[Search] Applying additive priority sorting (severity=${symptomSeverity}, fuel=${fuelTypeForAdditive}, scenario=${usageScenario})`);
            allResults.sort((a, b) => {
                const aScore = getAdditivePriorityScore(a, symptomSeverity, fuelTypeForAdditive, usageScenario);
                const bScore = getAdditivePriorityScore(b, symptomSeverity, fuelTypeForAdditive, usageScenario);

                // Debug: 輸出前幾個產品的評分
                if (Math.random() < 0.1) { // 抽樣 log 避免洗版，或是只在前幾次 log
                    // console.log(`[Score] ${a.partno}: ${aScore}, ${b.partno}: ${bScore}`);
                }

                return bScore - aScore; // 降冪排序
            });

            // 輸出排序後的前 3 名產品名稱和分數，用於驗證
            console.log('[Search] Top 3 additives after sort:', allResults.slice(0, 3).map(p => ({
                sku: p.partno,
                title: p.title,
                score: getAdditivePriorityScore(p, symptomSeverity, fuelTypeForAdditive, usageScenario)
            })));
        }

        // 8. 最終 Fallback：如果完全沒有結果，返回對應類別的產品樣本
        if (allResults.length === 0 && products.length > 0) {
            console.log('[Search] All strategies failed, returning sample products');

            let sampleProducts = [];
            const vehicleType = searchInfo?.vehicleType;

            // 產品類別與 sort 欄位對應表
            const categoryToSort = {
                '機油': vehicleType === '摩托車' ? '【摩托車】機油' : '【汽車】機油',
                '添加劑': vehicleType === '摩托車' ? '【摩托車】添加劑' : '【汽車】添加劑',
                '變速箱油': '【汽車】變速箱',
                '煞車系統': '煞車系統',
                '冷卻系統': '冷卻系統',
                '空調系統': '【汽車】空調系統',
                '化學品': '化學品系列',
                '美容': '車輛美容系列',
                '香氛': '車輛美容系列',
                '自行車': '自行車系列',
                '船舶': '船舶系列',
                '商用車': '商用車系列',
                'PRO-LINE': 'PRO-LINE 專業系列',
                '其他油品_摩托車': '【摩托車】其他油品',
                '人車養護_摩托車': '【摩托車】人車養護'
            };

            // 根據 productCategory 取得對應的 sort 值
            const sortValue = categoryToSort[productCategory];

            if (sortValue) {
                sampleProducts = products.filter(p =>
                    p.sort && p.sort.includes(sortValue.replace('【', '').replace('】', ''))
                ).slice(0, 20);
                console.log(`[Search] Fallback by sort "${sortValue}": found ${sampleProducts.length} products`);
            }

            // 如果使用 sort 沒找到，嘗試使用標題關鍵字搜尋
            if (sampleProducts.length === 0) {
                const categoryKeywords = {
                    '變速箱油': ['atf', 'gear', '變速箱', 'transmission'],
                    '煞車系統': ['brake', 'dot', '煞車'],
                    '冷卻系統': ['coolant', 'antifreeze', '冷卻', '水箱'],
                    '美容': ['wash', 'wax', '洗車', '美容', '鍍膜'],
                    '自行車': ['bike', 'bicycle', '自行車'],
                    '船舶': ['marine', 'outboard', '船']
                };

                const keywords = categoryKeywords[productCategory] || [];
                if (keywords.length > 0) {
                    sampleProducts = products.filter(p => {
                        const title = (p.title || '').toLowerCase();
                        const sort = (p.sort || '').toLowerCase();
                        return keywords.some(kw => title.includes(kw) || sort.includes(kw));
                    }).slice(0, 20);
                    console.log(`[Search] Fallback by keywords: found ${sampleProducts.length} products`);
                }
            }

            // 如果還是沒有，返回前 20 個產品
            if (sampleProducts.length === 0) {
                sampleProducts = products.slice(0, 20);
            }

            for (const p of sampleProducts) {
                if (p.id && !seenIds.has(p.id)) {
                    seenIds.add(p.id);
                    allResults.push(p);
                }
            }
            console.log(`[Search] Final fallback: ${allResults.length} products`);
        }

        // 9. 一般格式化輸出（限制 15 個產品，節省 Token）
        if (allResults.length > 0) {
            return formatProducts(allResults.slice(0, 15), searchInfo);
        }

        return '目前沒有匹配的產品資料';

    } catch (error) {
        console.error('[Search] Global error:', error);
        return '搜尋產品時發生錯誤';
    }
}

// ============================================
// 判斷產品基礎油等級（用於全合成優先排序）
// ============================================
function getSyntheticScore(title) {
    if (!title) return 0;
    const titleLower = title.toLowerCase();

    // 嚴格全合成（3分）：僅限 Synthoil, Race, Fully Synthetic
    if (titleLower.includes('synthoil') ||
        titleLower.includes('race') ||
        titleLower.includes('fully synthetic') ||
        titleLower.includes('fully-synthetic') ||
        titleLower.includes('全合成')) {
        return 3;
    }

    // 合成技術/半合成（2分）：Top Tec, Special Tec, Leichtlauf
    if (titleLower.includes('top tec') ||
        titleLower.includes('special tec') ||
        titleLower.includes('leichtlauf') ||
        titleLower.includes('synthetic technology') ||
        titleLower.includes('合成')) {
        return 2;
    }

    // 合成技術/半合成（次優先）
    if (titleLower.includes('合成') ||
        titleLower.includes('street') ||
        titleLower.includes('formula')) {
        return 2;
    }

    // 礦物油（最低優先）
    if (titleLower.includes('mineral') ||
        titleLower.includes('礦物')) {
        return 1;
    }

    // 無法判斷，給預設分數
    return 1.5;
}

// ============================================
// 判斷添加劑優先級（用於症狀嚴重度和使用場景排序）
// ============================================
// ============================================
// 判斷添加劑優先級（用於症狀嚴重度和使用場景排序）
// ============================================
function getAdditivePriorityScore(product, symptomSeverity, fuelType, usageScenario) {
    if (!product) return 0;
    const title = product.title || '';
    const partno = product.partno || '';
    const titleLower = title.toLowerCase();
    let score = 1;

    // 柴油車 + Diesel 產品 = 加分
    if (fuelType === '柴油' && titleLower.includes('diesel')) {
        score += 2;
    }

    // 嚴重症狀 + Pro-Line 產品 = 加分
    if (symptomSeverity === 'severe') {
        if (titleLower.includes('pro-line') || titleLower.includes('proline')) {
            score += 3;  // Pro-Line 最高優先
        } else {
            score += 1;  // 其他產品稍微加分
        }
    }

    // 中度症狀
    if (symptomSeverity === 'moderate') {
        if (titleLower.includes('pro-line') || titleLower.includes('proline')) {
            score += 2;
        }
    }

    // 使用場景排序（跑山/激烈操駕 → 性能提升類優先）
    if (usageScenario === '跑山' || usageScenario === '下賽道') {
        // LM7820 Speed Shooter 性能提升 (檢查標題或料號)
        if (titleLower.includes('speed') || titleLower.includes('7820') || partno.includes('7820')) {
            score += 3;  // 跑山場景最優先 (LM7820)
        }
        // 性能相關產品
        if (titleLower.includes('race') || titleLower.includes('boost') || titleLower.includes('octane')) {
            score += 2;
        }
    }

    // 長途旅行 → 清潔保養類優先
    if (usageScenario === '長途旅行') {
        if (titleLower.includes('shooter') || titleLower.includes('clean') || titleLower.includes('7822') || partno.includes('7822')) {
            score += 2;  // 清潔類優先 (LM7822)
        }
        if (titleLower.includes('stabilizer') || titleLower.includes('21600') || partno.includes('21600')) {
            score += 1.5;  // 穩定劑也適合長途
        }
    }

    // Engine Flush 清積碳產品
    if (titleLower.includes('flush') || titleLower.includes('clean')) {
        score += 0.5;
    }

    return score;
}

// ============================================
// 格式化產品資料（完整版）
// ============================================
function formatProducts(products, searchInfo = null) {
    if (!products || products.length === 0) {
        return '目前沒有匹配的產品資料';
    }

    const productCategory = searchInfo?.productCategory || '產品';
    const isAdditive = productCategory === '添加劑';
    const additiveMatch = searchInfo?.additiveGuideMatch;

    // 強烈警告，防止 AI 編造
    let context = `## ⚠️⚠️⚠️ 重要警告 ⚠️⚠️⚠️

**以下是唯一可以推薦的產品。禁止使用任何不在此列表中的產品編號！**
`;

    // 認證搜尋通知（升級認證說明）
    const certNotice = searchInfo?.certNotice;
    const isUpgrade = searchInfo?.isUpgrade;
    const requestedCert = searchInfo?.requestedCert;
    const usedCert = searchInfo?.usedCert;

    if (certNotice) {
        context += `
## 📋 認證搜尋結果

**用戶詢問:** ${requestedCert} 認證
**實際結果:** ${usedCert || '無'} ${isUpgrade ? '(升級認證，向後兼容)' : '(精確匹配)'}

> ⚠️ ${certNotice}

**回覆要求:**
1. 向用戶說明目前無 ${requestedCert} 認證產品
2. 解釋 ${usedCert} 是更新一代的認證，向後兼容 ${requestedCert}
3. 推薦以下產品

`;
    }

    // 加入產品類別提示和推薦依據
    if (isAdditive) {
        context += `
## 🚨 本次詢問是「添加劑」推薦，不是機油！
`;
        // 如果有匹配到的症狀，顯示說明
        if (additiveMatch && additiveMatch.items && additiveMatch.items.length > 0) {
            context += `
### 📋 症狀分析與推薦依據
用戶描述的問題匹配到以下症狀，請根據說明向用戶解釋推薦原因：

`;
            for (const item of additiveMatch.items) {
                context += `**症狀：${item.problem}**
🔍 原因說明：${item.explanation}
💊 推薦產品：${item.solutions.join(', ')}

`;
            }
            context += `**回覆要求：**
1. 先說明可能的原因（參考上述「原因說明」）
2. 再推薦對應的產品
3. 解釋產品如何解決這個問題

`;
        } else {
            context += `**用戶詢問的是症狀問題，請推薦添加劑產品！**

`;
        }
    } else if (productCategory === '機油') {
        context += `
### 📋 機油推薦依據
**回覆要求：**
1. 說明推薦的黏度依據
2. 說明認證依據
3. 列出推薦產品

⚠️ **認證準確性要求**：
- 回覆時必須使用產品「認證/規格」欄位中顯示的**確切內容**
- 例如：產品顯示 "API SQ, ILSAC GF-7A" 則說 "API SQ, ILSAC GF-7A"
- **禁止**用其他認證名稱替代（如把 SQ 說成 SP）

`;
    } else if (productCategory === '變速箱油') {
        context += `
### 📋 變速箱油推薦依據
**回覆要求：**
1. 說明車型對應的變速箱類型（自排/手排/CVT/DSG 等）
2. 說明適用的規格或認證（如 Dexron VI、ATF+4 等）
3. 列出推薦產品

`;
    } else if (productCategory === '煞車系統' || productCategory === '冷卻系統') {
        context += `
### 📋 ${productCategory}產品推薦
**回覆要求：**
1. 確認車型資訊（如有繼承）
2. 推薦適合的產品

`;
    } else if (productCategory === '美容' || productCategory === '香氛' || productCategory === '自行車') {
        context += `
### 📋 ${productCategory}產品直接推薦
**🛒 購買方式：**
此類產品可直接在 **CarMall 車魔商城** 購買：https://www.carmall.com.tw/
宜福工業官方直營，品質有保障！

**回覆要求：**
1. 直接推薦適合的產品
2. 提供產品連結
3. 補充說明可在 CarMall 車魔商城購買

`;
    } else {
        context += `
### 📋 ${productCategory}產品推薦

`;
    }

    context += `---

## 可用${productCategory}資料庫

`;

    products.forEach((p, i) => {
        const pid = p.partno || p.partNo || p.Partno || p.PartNo || p.sku || p.SKU;
        let url = p.productPageUrl || 'https://www.liqui-moly-tw.com/products/';

        if (pid) {
            url = `${PRODUCT_BASE_URL}${pid.toLowerCase()}`;
        } else if (p.title) {
            const match = p.title.match(/(?:LM|lm)?[- ]?(\d{4,5})/);
            if (match) {
                url = `${PRODUCT_BASE_URL}lm${match[1]}`;
            }
        }

        context += `### ${i + 1}. ${p.title || '未命名產品'}
- 產品編號: ${pid || 'N/A'}
- 容量/尺寸: ${p.size || 'N/A'}
- 系列/次分類: ${p.word1 || 'N/A'}
- 黏度: ${p.word2 || 'N/A'}
- 認證/規格: ${p.cert || 'N/A'}
- 分類: ${p.sort || 'N/A'}
- 建議售價: ${p.price || '請洽店家詢價'}
- 產品連結: ${url}
- 產品說明: ${p.content || 'N/A'}

`;
    });

    return context;
}

// ============================================
// 格式化多車型產品資料
// ============================================
function formatMultiVehicleProducts(motorcycleProducts, carProducts) {
    let context = `## ⚠️⚠️⚠️ 重要警告 ⚠️⚠️⚠️

**以下是唯一可以推薦的產品。禁止使用任何不在此列表中的產品編號！**

---

## 🏍️ 摩托車機油（標題含 Motorbike）

**以下產品專用於摩托車/重機/速克達，請推薦給摩托車用戶：**

`;

    if (motorcycleProducts.length > 0) {
        motorcycleProducts.forEach((p, i) => {
            const pid = p.partno || p.partNo || p.sku;
            const url = pid ? `${PRODUCT_BASE_URL}${pid.toLowerCase()}` : 'https://www.liqui-moly-tw.com/products/';

            context += `### ${i + 1}. ${p.title || '未命名產品'}
- 產品編號: ${pid || 'N/A'}
- 容量: ${p.size || 'N/A'}
- 黏度: ${p.word2 || 'N/A'}
- 認證: ${p.cert || 'N/A'}
- 產品連結: ${url}

`;
        });
    } else {
        context += `（無符合的摩托車機油產品）

`;
    }

    context += `---

## 🚗 汽車機油（不含 Motorbike）

**以下產品專用於汽車，請推薦給汽車用戶：**

`;

    if (carProducts.length > 0) {
        carProducts.forEach((p, i) => {
            const pid = p.partno || p.partNo || p.sku;
            const url = pid ? `${PRODUCT_BASE_URL}${pid.toLowerCase()}` : 'https://www.liqui-moly-tw.com/products/';

            context += `### ${i + 1}. ${p.title || '未命名產品'}
- 產品編號: ${pid || 'N/A'}
- 容量: ${p.size || 'N/A'}
- 黏度: ${p.word2 || 'N/A'}
- 認證: ${p.cert || 'N/A'}
- 產品連結: ${url}

`;
        });
    } else {
        context += `（無符合的汽車機油產品）

`;
    }

    context += `---

## ⚠️ 多車型推薦規則
- **摩托車/重機/速克達**：只能推薦上方「🏍️ 摩托車機油」區塊的產品
- **汽車**：只能推薦上方「🚗 汽車機油」區塊的產品
- 禁止混用！汽車不可推薦 Motorbike 產品，摩托車不可推薦汽車機油
`;

    return context;
}

// ============================================
// 匯出函式供直接呼叫（P0 優化：避免 HTTP 開銷）
// ============================================
export { searchProducts, getProducts };
